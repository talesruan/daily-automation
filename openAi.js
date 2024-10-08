const axios = require("axios");
const process = require("process");

const OPEN_AI_KEY = process.env.OPEN_AI_KEY;

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
};

module.exports ={
	askGpt
}