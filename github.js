const axios = require("axios");
const process = require("process");

const GITHUB_EMAIL = process.env.GITHUB_EMAIL;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

const isPullRequestMerge = (commitMessage) => {
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

const getCommitsFromPullRequestEvent = async (event) => {
	const url = event.payload.pull_request.commits_url;
	const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
	try {
		const response = await axios.get(url, { headers });
		console.log("response.data", JSON.stringify(response.data, null, 2));
		return response.data;
	} catch (error) {
		console.error('Error fetching GitHub commits:', error);
		throw error;
	}
}

const parseEvent = async (event) => {

	if (event.type !== "PushEvent" && event.type !== "PullRequestReviewEvent" && event.type !== "PullRequestEvent") {
		return;
	}

	if (!event.org || event.org.login !== GITHUB_ORG) {
		return;
	}
	const isPREvent = event.type === "PullRequestEvent";

	if (event.type === "PullRequestReviewEvent") {
		return {
			type: "review",
			tasks: getTaskListFromString(event.payload.pull_request.head.label),
			url: event.payload.pull_request.html_url
		}
	}
	const fullBranchRef = isPREvent ? event.payload.pull_request.head.ref : event.payload.ref;
	const branchName = isPREvent ? fullBranchRef : fullBranchRef.replace(/^refs\/heads\//, '');

	const isMaster = branchName === "master" || branchName === "main";
	const isStaging = branchName === "staging";

	const isFeatureBranch = !isMaster && !isStaging;

	let commitsData;
	if (isPREvent) {
		const prCommits = await getCommitsFromPullRequestEvent(event);
		commitsData = prCommits.map(c => c.commit);
	} else {
		commitsData = event.payload.commits;
	}

	const commitMessages = commitsData.filter(c => c.author.email === GITHUB_EMAIL).map(c => c.message);
	const descriptiveCommitMessages = commitMessages.filter(m => !isMergeCommit(m) && !isPullRequestMerge(m));
	if (isFeatureBranch) {
		// TODO: diff message if is in PR
		return {
			type: "feature",
			branchName,
			commits: descriptiveCommitMessages,
			tasks: getTaskListFromString(branchName)
		}
	}
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
		const lastCommit = event.payload.commits.at(-1);
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
					commits: descriptiveCommitMessages,
					tasks: []
				}
			}
		} else {
			console.warn(`Couldn't find the pr that merged to ${branchName}.`);
			// throw new Error("Merge to staging without a PR");
			return {
				type: "staging",
				branchName,
				commits: descriptiveCommitMessages,
				tasks: []
			}
		}
	}
};

const fetchEvents = async (username) => {
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

const listEvents = async (dateStart, dateEnd)=> {
	const githubEvents = await fetchEvents(GITHUB_USERNAME);
	const filteredEvents = githubEvents.filter(event => {
		const eventDate = new Date(event.created_at);
		return eventDate >= dateStart && eventDate <= dateEnd;
	});
	const parsedEvents = [];
	for (const e of filteredEvents) {
		const parsedEvent = await parseEvent(e);
		if (parsedEvent) {
			parsedEvents.push(parsedEvent);
		}
	}
	return parsedEvents;
};

module.exports = { listEvents };