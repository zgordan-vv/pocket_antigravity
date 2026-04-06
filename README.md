# 🌊 Pocket Antigravity v1.0 (Seaside Ready)

**Pocket Antigravity** is a high-fidelity, mobile-first terminal bridge for Telegram. It turns your phone into a remote control for your local development environment, making it perfect for for-the-grid coding while walking or away from your desk.

## 🚀 Key Features

- **📱 Seaside Dashboard:** Persistent UI buttons for one-tap project management.
- **🧠 Brain-Bridge Architecture:** A specialized agent CLI (`chat.js`) that handles your project context locally, while the bridge (`relay.js`) handles the remote delivery.
- **📊 Project Pulse:** One-tap surgical audits that synchronize Git, files, and project goals.
- **⚡ Agent Bypass:** Low-latency, high-fidelity delivery of agent reports to Telegram without secondary summarization.
- **🎙️ Voice Commands:** Transcribe and execute terminal commands via Telegram voice notes.
- **📂 Workspace Switcher:** Instantly navigate between your local projects with automatic re-auditing.

## 🛠️ Seaside Dashboard Options

- **📁 Projects:** Lists and switches to other workspaces in your parent directory.
- **📊 Project Pulse:** Performs a deep-dive audit of the current project's status.
- **🧠 Antigravity Chat:** Keeps you locked into the Antigravity Brain session.
- **♻️ Last Result:** Recovers the last generated summary from the terminal cache.

## 📦 Getting Started

1. **Environmental Keys:** Configure your `.env` (Rename `.env.example` to `.env`):
   - `TG_TOKEN`: From @BotFather
   - `ALLOWED_USER_ID`: Your Telegram ID (Use @userinfobot if you don't know it)
   - `DEEPSEEK_API_KEY`: For the brain
   - `OPENAI_API_KEY`: For voice/summaries

2. **Installation:**
   ```bash
   npm install
   ```

3. **Deployment:**
   Run the relay. It will automatically launch the Antigravity Brain by default.
   ```bash
   node relay.js
   ```

## 🔒 Security
The relay is hard-locked to your numeric Telegram User ID. Only you can talk to your terminal. All transactions are logged to `session_audit.log` for your records.

## 🤝 Project State
**Status:** v1.0 (Stable) - Seaside Ready.
This project follows the **"Brain-Bridge"** model for hallucination-free remote management.

## Commands
- `/prompt [text]` - Send a command to the terminal.
- `/projects` - Open an interactive dashboard to switch between projects in your `lab/` folder.
- `/status` - Get a summary of the current terminal state and project health.
- `/result` - Get a cached summary of the last completed task.
- *Voice Message* - Hold the mic to transcribe and relay a voice command automatically.
- *Direct Text* - Anything sent (not starting with /) is relayed as a command.

## 📂 The Project Switcher
The relay is designed to work with all projects in your parent directory. By running `/projects`, you will see an inline keyboard of all sibling folders. Tapping a project will automatically `cd` the terminal into that folder and return a fresh context summary.

## 🛡️ Security
- **ID Locking:** The bot only responds to the `ALLOWED_USER_ID` set in your `.env`.
- **GPLv3 License:** This project is open-source and protected against proprietary takeover.

## Architecture
- **Front-end:** Telegram Bot (`Telegraf.js`).
- **Relay:** Node.js server with `node-pty`.
- **Brain:** DeepSeek-V3 for project-aware summarization.
- **Ears:** OpenAI Whisper for high-accuracy voice transcription.

## Finding your Bot
If you forget your bot's name, you can always check your Telegram app or run a query using your `TG_TOKEN`. The default username for this session was `@pocket_ag_bot`.
