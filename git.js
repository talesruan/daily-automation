const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const execAsync = async command => {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				if (stderr) console.error(`stderr: ${stderr}`);
				reject(error);
			} else {
				resolve(stdout);
			}
		});
	});
};

const getSubdirectories = async baseDir => {
	const files = await fs.promises.readdir(baseDir);
	return files.map(f => path.join(baseDir, f)).filter(f => fs.lstatSync(f).isDirectory());
};

const isGitRepo = async dir => {
	try {
		await fs.promises.access(path.join(dir, '.git'));
		return true;
	} catch {
		return false;
	}
};


const x = async () => {
	console.log("running...");
	const author = 'talesruan';
	const since = 'yesterday 00:00';
	const until = 'today 23:59';
	const format = '%H|%an|%ad|%s';
	const baseDir = '/Users/talesruan/proj/tmt'; // Change this to your target directory

	const x = await getSubdirectories(baseDir);

	const command = `git log --all --author="${author}" --since="${since}" --until="${until}" --pretty=format:"${format}"`;

	console.log("command", command);
	const dirs = await getSubdirectories(baseDir);

	for (const repoPath of dirs) {
		if (!await isGitRepo(repoPath)) {
			console.log(`Ignoring ${repoPath} as it is not a Git repository.`);
			continue;
		}
		const stdout = await execAsync(`cd ${repoPath} && ${command}`);

		console.log("stdout", stdout.split('\n'));
		const commits = stdout.split('\n').map(line => {
			const [hash, author, date, message] = line.split('|');
			return {hash, author, date, message};
		});

		console.log(`Commits by ${author} from yesterday in ${repoPath}:`, commits);
	}
}

module.exports = {x}
