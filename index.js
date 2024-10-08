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

const now = new Date();

const isMondayToday = () => now.getDay() === 1;

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

const assembleMessage = (githubEvents, yesterdayEvents, todayEvents) => {
	const greeting = "Morning!";
	const bullet = "- "
	const tab = "\t";

	const previousDayName = isMondayToday() ? "Friday" : "Yesterday";

	const githubMessages = githubEvents.map(e => {
		const commitDetails = e.commits.map(c => `${tab}${bullet}${c}`).join("\n");
		if (e.type === "feature") {
			return `${bullet}Worked on ${e.tasks[0]}`;
		}
		if (e.type === "master") {
			return `${bullet}Released to prod ${e.tasks.join(", ")}`;
		}
		if (e.type === "staging") {
			return `${bullet}Released to Staging QA: ${e.tasks.join(", ")}`;
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

	const githubEvents = await github.listEvents(dateStart, dateEnd);

	const githubEventsByTask = mergeGithubEventsByTask(githubEvents);
	for (const taskId in githubEventsByTask) {
		const data = githubEventsByTask[taskId];
		console.log("data", JSON.stringify(data, null, 2));
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
		write a short but comprehensible one-line summary of the work done. Commit history: \n${data.commits.join("\n")}`;


		console.log("prompt", prompt);

		const x = await openAi.askGpt(prompt);
		console.log(x);
	}

	const authClient = await googleCalendar.authorizeGoogleOAuth();
	const yesterdayCalendarEvents = await googleCalendar.listEvents(authClient, dateStart, yesterdayEod);
	const todayCalendarEvents = await googleCalendar.listEvents(authClient, yesterdayEod, dateEnd);

	console.log("MESSAGE:\n");
	console.log(assembleMessage(githubEvents, yesterdayCalendarEvents, todayCalendarEvents));

	return;
	console.log("\nASKING GPT\n");

	const gptResponse = await openAi.askGpt(`This is a message Im going to post in the company's slack channel. Format it and add more details. '${assembleMessage(githubEvents, yesterdayCalendarEvents, todayCalendarEvents)}'`);
	console.log(gptResponse);

};


main();