const axios = require("axios");
const process = require("process");

const GITHUB_EMAIL = process.env.GITHUB_EMAIL;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

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

const parseEvent = (event) => {
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
					commits: descriptiveCommitMessages
				}
			}
		} else {
			throw new Error("Merge to staging without a PR");
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
	return filteredEvents.map(e => parseEvent(e)).filter(e => !!e);
};

module.exports = { listEvents };