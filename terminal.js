const process = require("process");
const readline = require('readline').createInterface({input: process.stdin, output: process.stdout,});

const waitWithMessage = async (message) => {
	return new Promise(resolve => readline.question(message, resolve));
}

module.exports = {
	waitWithMessage
}