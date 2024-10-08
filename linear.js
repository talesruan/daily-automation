const axios = require("axios");
const process = require("process");

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_API_URL = "https://api.linear.app/graphql";

const fetchTask = async (taskId) => {
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

module.exports = {
	fetchTask
};