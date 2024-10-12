# Daily Automation

A CLI tool to automate the task of posting a daily status update of your work. 
This project integrates various services such as GitHub, Linear, OpenAI, and Google Calendar to streamline workflows.

Motivation: It's very common for me to get so immersed on the current task that I may forgot what I did yesterday, and thus my daily reports were incomplete sometimes. Also this should save me time.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/talesruan/daily-automation.git
    cd yourproject
    ```

2. Install the dependencies:
    ```sh
    npm install
    ```

## Configuration

1. Copy the `.env.template` file to `.env`:
    ```sh
    cp .env.template .env
    ```

2. Fill in the required environment variables in the `.env` file. At a minimum, you need to configure either GitHub or Google Calendar integration.

    - **GitHub Integration**:
        - `ENABLE_GITHUB_INTEGRATION=true`
        - `GITHUB_EMAIL=your_email`
        - `GITHUB_USERNAME=your_username`
        - `GITHUB_TOKEN=your_personal_access_token`
        - `GITHUB_ORG=your_github_org`

    - **Linear Integration**:
        - `ENABLE_LINEAR_INTEGRATION=true`
        - `LINEAR_API_KEY=your_linear_api_key`

    - **OpenAI Integration**:
        - `ENABLE_OPEN_AI_INTEGRATION=true`
        - `OPEN_AI_KEY=your_openai_key`

    - **Google Calendar Integration**:
        - `ENABLE_GOOGLE_CALENDAR_INTEGRATION=true`
        - `EVENTS_BLACKLIST="Event1,Event2"`

3. Configure Google Calendar API:
    - Follow the instructions [here](https://developers.google.com/calendar/api/quickstart/nodejs#set-up-environment) to set up your Google project.
    - Save the `credentials.json` file as `googleAppCredentials.json` in the project root.

## Usage

1. Run the application:
    ```sh
    npm start
    ```

2. For Google Calendar integration, you will be prompted to log in to your Google account the first time you run the application.

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Make your changes.
4. Commit your changes (`git commit -m 'Add some feature'`).
5. Push to the branch (`git push origin feature-branch`).
6. Open a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
