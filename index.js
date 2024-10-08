const axios = require('axios');
const {subDays, startOfDay, endOfDay} = require('date-fns');
const fs = require('fs');
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
require('dotenv').config();

const GITHUB_EMAIL = process.env.GITHUB_EMAIL;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const OPEN_AI_KEY = process.env.OPEN_AI_KEY;

const LINEAR_API_URL = "https://api.linear.app/graphql";

// Do not report these calendar events:
const EVENTS_BLACKLIST = process.env.EVENTS_BLACKLIST.split(',');

// If modifying these scopes, delete token.json.
const GOOGLE_TOKEN_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const GOOGLE_TOKEN_PATH = path.join(process.cwd(), 'token.json'); // user token saved here
const GOOGLE_CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json'); // app credentials saved here

const now = new Date();

const fetchGitHubEvents = async (username) => {
	const url = `https://api.github.com/users/${username}/events`;
	const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
	try {
		const response = await axios.get(url, { headers });
		return response.data;
	} catch (error) {
		console.error('Error fetching GitHub events:', error);
		throw error;
	}
};

const isPullRequest = (commitMessage) => {
	return commitMessage.includes("Merge pull request #");
};

const isMergeCommit = (commitMessage) => {
	return commitMessage.startsWith("Merge branch");
}

const getTaskListFromStringArray = (stringArray) => {
	const taskSet = new Set();
	for (const string of stringArray) {
		const matchedTasks = string.match(/ENG-\d+/gi);
		if (matchedTasks && matchedTasks.length > 0) {
			taskSet.add(...matchedTasks.map(task => task.toUpperCase()));
		}
	}
	return Array.from(taskSet);
};

const getTaskListFromString = (string) => {
	return getTaskListFromStringArray([string]);
};

const parseGithubEvent = (event) => {
	// if (event.type === "PullRequestReviewEvent" || event.type === "PullRequestEvent") {
	// // can use these to track PR reviews
	// 	return;
	// }

	if (event.type !== "PushEvent") {
		return;
	}
	if (!event.org || event.org.login !== GITHUB_ORG) {
		return;
	}
	console.log("event.payload", JSON.stringify(event, null, 2));
	const fullBranchRef = event.payload.ref;
	const branchName = fullBranchRef.replace(/^refs\/heads\//, '');
	const isMaster = branchName === "master" || branchName === "main";
	const isStaging = branchName === "staging";
	const isFeatureBranch = !isMaster && !isStaging;
	const commitMessages = event.payload.commits.filter(c => c.author.email === GITHUB_EMAIL).map(c => c.message);
	const descriptiveCommitMessages = commitMessages.filter(m => !isMergeCommit(m) && !isPullRequest(m));
	if (isFeatureBranch) {
		return {
			type: "feature",
			branchName,
			commits: commitMessages.filter(m => !isPullRequest(m)),
			tasks: getTaskListFromString(branchName)
		}
	}
	const lastCommit = event.payload.commits.at(-1);
	if (isMaster) {
		const prsMerged = commitMessages.filter(m => m.includes("Merge pull request #")).map(m => m.split("\n")[0]);
		const tasks = getTaskListFromStringArray(prsMerged);
		return {
			type: "master",
			branchName,
			commits: descriptiveCommitMessages,
			tasks
		}
	} else {
		// staging
		if (lastCommit.message.includes("Merge pull request #")) {
			const firstLine = lastCommit.message.split("\\").pop();
			const tasks = getTaskListFromString(firstLine);
			if (tasks.length > 0) {
				return {
					type: "staging",
					branchName,
					commits: descriptiveCommitMessages,
					tasks: [tasks[0]]
				}
			} else {
				// no task found
				const prNumber = lastCommit.message.match(/#(\d+)/)[1];
				console.log(`> Merged pull request #${prNumber} to the branch ${branchName}`);

				return {
					type: "staging",
					branchName,
					commits: descriptiveCommitMessages
				}
			}
		} else {
			throw new Error("Merge to staging without a PR");
		}
	}
}

const listGithubEvents = async (dateStart, dateEnd)=> {
	const githubEvents = await fetchGitHubEvents(GITHUB_USERNAME);
	const filteredEvents = githubEvents.filter(event => {
		const eventDate = new Date(event.created_at);
		return eventDate >= dateStart && eventDate <= dateEnd;
	});
	return filteredEvents.map(e => parseGithubEvent(e)).filter(e => !!e);
};


const fetchLinearTask = async (taskId) => {
	const query = `
    query {
      issue(id: "${taskId}") {
        id
        title
        description
        state {
          name
        }
        assignee {
          name
        }
        createdAt
        updatedAt
      }
    }
  `;

	try {
		const response = await axios.post(
			LINEAR_API_URL,
			{ query },
			{
				headers: {
					'Authorization': `${LINEAR_API_KEY}`,
					'Content-Type': 'application/json'
				}
			}
		);
		return response.data.data.issue;
	} catch (error) {
		console.error('Error fetching task details:', error);
		return null;
	}
};

/**
 * Reads previously authorized credentials from the save file.
 */
async function loadSavedGoogleCredentialsIfExist() {
	try {
		const content = await fs.promises.readFile(GOOGLE_TOKEN_PATH);
		const credentials = JSON.parse(content);
		return google.auth.fromJSON(credentials);
	} catch (err) {
		return null;
	}
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 */
async function saveGoogleCredentials(client) {
	console.log("CREDENTIALS_PATH", GOOGLE_CREDENTIALS_PATH);
	const content = await fs.promises.readFile(GOOGLE_CREDENTIALS_PATH);
	const keys = JSON.parse(content);
	const key = keys.installed || keys.web;
	const payload = JSON.stringify({
		type: 'authorized_user',
		client_id: key.client_id,
		client_secret: key.client_secret,
		refresh_token: client.credentials.refresh_token,
	});
	await fs.promises.writeFile(GOOGLE_TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 */
async function authorizeGoogleOAuth() {
	let client = await loadSavedGoogleCredentialsIfExist();
	if (client) {
		return client;
	}
	client = await authenticate({
		scopes: GOOGLE_TOKEN_SCOPES,
		keyfilePath: GOOGLE_CREDENTIALS_PATH,
	});
	if (client.credentials) {
		await saveGoogleCredentials(client);
	}
	return client;
}

/**
 * Lists events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listGoogleCalendarEvents(auth, dateStart, dateEnd) {
	const timeMin = dateStart.toISOString();
	const timeMax = dateEnd.toISOString();
	const calendar = google.calendar({version: 'v3', auth});
	const res = await calendar.events.list({
		calendarId: 'primary',
		timeMin: timeMin,
		timeMax: timeMax,
		maxResults: 20,
		singleEvents: true,
		orderBy: 'startTime',
	});
	const events = res.data.items;
	return events.map(event => ({
		startAt: event.start.dateTime || event.start.date,
		description: event.summary,
	})).filter(e => !EVENTS_BLACKLIST.includes(e.description));
}

const isMondayToday = () => now.getDay() === 1;

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

const askGpt = async (message) => {
	const response = await axios.post(
		'https://api.openai.com/v1/chat/completions',
		{
			model: 'gpt-3.5-turbo',
			messages: [{ role: 'user', content: message }],
		},
		{
			headers: {
				'Authorization': `Bearer ${OPEN_AI_KEY}`,
				'Content-Type': 'application/json',
			},
		}
	);

	return response.data.choices[0].message.content;
}

const main = async () => {
	const dateStart = startOfDay(subDays(now, isMondayToday() ? 3 : 1));
	const yesterdayEod = endOfDay(subDays(now, 1));
	const dateEnd = endOfDay(now);

	console.log("Getting events from ", dateStart, "to", dateEnd);

	const githubEvents = await listGithubEvents(dateStart, dateEnd);

	// const x= await fetchLinearTask("ENG-2036");
	// authorize().then(listEvents).catch(console.error);

	const authClient = await authorizeGoogleOAuth();
	const yesterdayCalendarEvents = await listGoogleCalendarEvents(authClient, dateStart, yesterdayEod);
	console.log("yesterday events", JSON.stringify(yesterdayCalendarEvents, null, 2));
	const todayCalendarEvents = await listGoogleCalendarEvents(authClient, yesterdayEod, dateEnd);
	console.log("today events", JSON.stringify(todayCalendarEvents, null, 2));

	console.log("MESSAGE:\n\n");
	console.log(assembleMessage(githubEvents, yesterdayCalendarEvents, todayCalendarEvents));

	console.log("ASKING GPT");

	const gptResponse = await askGpt(`This is a message Im going to post in the company's slack channel. Format it and add more details: '${assembleMessage(githubEvents, yesterdayCalendarEvents, todayCalendarEvents)}'`);
	console.log(gptResponse);

};


main();