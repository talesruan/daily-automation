const axios = require('axios');
const {subDays, startOfDay, endOfDay} = require('date-fns');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const github = require("./github.js");
const googleCalendar = require("./googleCalendar.js");
const openAi = require("./openAi.js");
const linear = require("./linear");
const terminal = require("./terminal");
const { exec } = require('child_process');

const isMondayToday = () => now.getDay() === 1;

const now = new Date('2024-10-05T00:00:00Z');
// const now = new Date();

const readBooleanConfig = (rawConfig) => {
	return rawConfig && rawConfig.toUpperCase() === "TRUE";
}

const integrations = {
	github: readBooleanConfig(process.env.ENABLE_GITHUB_INTEGRATION),
	linear: readBooleanConfig(process.env.ENABLE_LINEAR_INTEGRATION),
	openAi: readBooleanConfig(process.env.ENABLE_OPEN_AI_INTEGRATION),
	googleCalendar: readBooleanConfig(process.env.ENABLE_GOOGLE_CALENDAR_INTEGRATION),
};

const greenString = (string) => {
	return `\x1b[42m\x1b[97m${string}\x1b[0m`;
}

const redString = (string) => {
	return `\x1b[41m\x1b[97m${string}\x1b[0m`;
};

const mergeGithubEventsByTask = (events) => {
	const tasks = {};
	for (const event of events) {
		for (const taskId of event.tasks) {
			if (!tasks[taskId]) {
				tasks[taskId] = {commits: [], types: []};
			}
			tasks[taskId].commits.push(...event.commits);
			tasks[taskId].types.push(event.type);
		}
	}
	return tasks;
};

const assembleMessage = (taskEvents, yesterdayEvents, todayEvents) => {
	const greeting = "Morning!";
	const bullet = "- "
	const tab = "\t";

	const previousDayName = isMondayToday() ? "Friday" : "Yesterday";

	const githubMessages = taskEvents.map(e => {
		let typeDescription = ""
		if (e.type === "feature") {
			typeDescription = "Worked on";
		} else if (e.type === "master") {
			typeDescription = "Released to prod";
		} else if (e.type === "staging") {
			typeDescription = "Released to Staging QA";
		}
		const gptSummarySection = e.gptSummary ? `\n${tab}${bullet}${e.gptSummary}` : "";
		return `${bullet}${typeDescription} ${e.taskId} ${gptSummarySection}`;
	}).join("\n");

	const yesterDayEventsMessage = yesterdayEvents.map(e => `${bullet}Attended ${e.description.trim()} meeting`).join("\n");
	const todayEventsMessage = todayEvents.map(e => `${bullet}Attend ${e.description.trim()} meeting`).join("\n");

	return `${greeting}\n${previousDayName}:\n${githubMessages}\n${yesterDayEventsMessage}\nToday:\n${todayEventsMessage}`;
};

const logIntegrationStatus = (integrations) => {
	const on = greenString("  ON   ");
	const off =  redString("  OFF  ");
	console.log("Enabled integrations: ");
	for (const key in integrations) {
		const status = integrations[key];
		console.log(`${key.padEnd(15, " ")}${status ? on : off}`);
	}
};

const getCalendarEvents = async (dateStart, yesterdayEod, dateEnd) => {
	if (!integrations.googleCalendar) {
		return {
			yesterday: [],
			today: []
		}
	}
	const authClient = await googleCalendar.authorizeGoogleOAuth();
	const yesterdayCalendarEvents = await googleCalendar.listEvents(authClient, dateStart, yesterdayEod);
	const todayCalendarEvents = await googleCalendar.listEvents(authClient, yesterdayEod, dateEnd);
	return {
		yesterday: yesterdayCalendarEvents,
		today: todayCalendarEvents
	}
};

const checkEnvFile = async () => {
	if (fs.existsSync(".env")) return true;
	await terminal.waitWithMessage("Press ENTER to setup the .env file");
	fs.copyFileSync('.env.template', '.env');
	exec('code .env', (err) => {
		process.exit(1);
	});
	return false;
};

const getGptSummaryForTask = async (taskId, commits) => {
	if (!integrations.openAi) return "";
	let prompt;
	if (integrations.linear) {
		const linearTask = await linear.fetchTask(taskId);
		prompt = `Given a task with the title "${linearTask.title}" 
				and the description "${linearTask.description}", and the following commit history of work done on it, 
				write a short but comprehensible one-line summary of the work done on these commits: 
				${commits.join("\n")}`;
	} else {
		prompt = `Given the following commit history of work done on a certain task, 
				write a short but comprehensible one-line summary of the work done: 
				${commits.join("\n")}`;
	}
	return openAi.askGpt(prompt);
};

const main = async () => {
	if (!await checkEnvFile()) return;
	const dateStart = startOfDay(subDays(now, isMondayToday() ? 3 : 1));
	const yesterdayEod = endOfDay(subDays(now, 1));
	const dateEnd = endOfDay(now);

	logIntegrationStatus(integrations);

	if (!integrations.github && !integrations.googleCalendar) {
		console.log("Both Github and Google Calendar integrations are disabled. Please enable at least one to proceed.");
		process.exit(1);
	}

	console.log("Working, please wait...");

	const githubEvents = integrations.github ? await github.listEvents(dateStart, dateEnd) : [];
	const githubEventsByTask = mergeGithubEventsByTask(githubEvents);

	const taskEvents = [];
	for (const taskId in githubEventsByTask) {
		const data = githubEventsByTask[taskId];
		let type;
		if (data.types.includes("master")) {
			type = "master";
		} else if (data.types.includes("staging")) {
			type = "staging";
		} else {
			type = "feature";
		}

		taskEvents.push({
			taskId,
			gptSummary: await getGptSummaryForTask(taskId, data.commits),
			commits: data.commits,
			type
		});
	}

	const calendarEvents = await getCalendarEvents(dateStart, yesterdayEod, dateEnd);

	const message = assembleMessage(taskEvents, calendarEvents.yesterday, calendarEvents.today);
	console.log("Message:\n");
	console.log(message);

	if (integrations.openAi) {
		const gptResponse = await openAi.askGpt(`This is a message Im going to post in the company's slack channel. Format it and add more details. Keep the overall structure and separate the previous and current day sections  '${message}'`);
		console.log("\nGPT processed message:\n");
		console.log(gptResponse);
	}
};

main().then(() => process.exit(0)).catch(() => process.exit(1))