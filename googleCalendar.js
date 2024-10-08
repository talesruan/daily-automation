const {google} = require('googleapis');
const fs = require('fs');
const path = require('path');
const process = require("process");
const {authenticate} = require('@google-cloud/local-auth');

// Do not report these calendar events:
const EVENTS_BLACKLIST = process.env.EVENTS_BLACKLIST.split(',');
// If modifying these scopes, delete token.json.
const GOOGLE_TOKEN_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const GOOGLE_TOKEN_PATH = path.join(process.cwd(), 'googleUserToken.json'); // user token saved here
const GOOGLE_CREDENTIALS_PATH = path.join(process.cwd(), 'googleAppCredentials.json'); // app credentials saved here

/**
 * Reads previously authorized credentials from the save file.
 */
const loadSavedGoogleCredentialsIfExist = async () => {
	try {
		const content = await fs.promises.readFile(GOOGLE_TOKEN_PATH);
		const credentials = JSON.parse(content);
		return google.auth.fromJSON(credentials);
	} catch (err) {
		return null;
	}
};

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 */
const saveGoogleCredentials = async client => {
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
};

/**
 * Load or request or authorization to call APIs.
 */
const authorizeGoogleOAuth = async () => {
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
};

/**
 * Lists events on the user's primary calendar.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
const listEvents = async (auth, dateStart, dateEnd) => {
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
};;

module.exports = {listEvents, authorizeGoogleOAuth };