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

const isMondayToday = () => now.getDay() === 1;

// const now = new Date('2024-10-10T00:00:00Z');
const now = new Date();

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
		if (e.type === "feature") {
			return `${bullet}Worked on ${e.taskId}\n${tab}${bullet}${e.gptSummary}`;
		}
		if (e.type === "master") {
			return `${bullet}Released to prod ${e.taskId}\n${tab}${bullet}${e.gptSummary}`;
		}
		if (e.type === "staging") {
			return `${bullet}Released to Staging QA: ${e.taskId}\n${tab}${bullet}${e.gptSummary}`;
		}
	}).join("\n");

	const yesterDayEventsMessage = yesterdayEvents.map(e => `${bullet}Attended ${e.description.trim()} meeting`).join("\n");
	const todayEventsMessage = todayEvents.map(e => `${bullet}Attend ${e.description.trim()} meeting`).join("\n");

	return `${greeting}\n${previousDayName}:\n${githubMessages}\n${yesterDayEventsMessage}\nToday:\n${todayEventsMessage}`;

};

const main = async () => {
	const dateStart = startOfDay(subDays(now, isMondayToday() ? 3 : 1));
	const yesterdayEod = endOfDay(subDays(now, 1));
	const dateEnd = endOfDay(now);

	console.log("Getting events from ", dateStart, "to", dateEnd);

	console.log("Working, please wait...");

	const githubEvents = await github.listEvents(dateStart, dateEnd);

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

		const linearTask = await linear.fetchTask(taskId);

		const prompt = `Given a task with the title "${linearTask.title}" 
		and the description "${linearTask.description}", and the following commit history of work done on it, 
		write a short but comprehensible one-line summary of the work done on these commits: \n${data.commits.join("\n")}`;

		const gptSummary = await openAi.askGpt(prompt);

		taskEvents.push({
			taskId,
			gptSummary,
			commits: data.commits,
			type
		});

	}

	// console.log("taskEvents", JSON.stringify(taskEvents, null, 2));

	const authClient = await googleCalendar.authorizeGoogleOAuth();
	const yesterdayCalendarEvents = await googleCalendar.listEvents(authClient, dateStart, yesterdayEod);
	const todayCalendarEvents = await googleCalendar.listEvents(authClient, yesterdayEod, dateEnd);

	const message = assembleMessage(taskEvents, yesterdayCalendarEvents, todayCalendarEvents);
	console.log("MESSAGE:\n");
	console.log(message);

	// return;
	console.log("\nASKING GPT\n");

	const gptResponse = await openAi.askGpt(`This is a message Im going to post in the company's slack channel. Format it and add more details. '${message}'`);
	console.log(gptResponse);

};


main();