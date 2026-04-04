# Pocket Antigravity 🚀

A Telegram-powered remote control for your local terminal. Ship code from your phone, get smart summaries of long terminal outputs, and relay voice commands directly to your local AI agent.

## Features
- 🎙️ **Voice Commands:** Send voice messages to your terminal (auto-transcribed via OpenAI Whisper).
- 📊 **Smart Status:** Get a DeepSeek-powered summary of what's happening in your terminal right now.
- ✅ **Command Results:** See a summary of the *actual* result of your last command, not just the raw logs.
- 🔒 **Security:** Locked to your specific Telegram User ID.

## Prerequisites
1. **Node.js** installed.
2. **Telegram Bot Token** (from [@BotFather](https://t.me/BotFather)).
3. **DeepSeek API Key** (for summarization).
4. **OpenAI API Key** (for Whisper STT).

## Installation

1. Clone or copy this folder to your local machine.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment:
   ```bash
   cp .env.example .env
   ```
4. Fill in your keys in `.env`.

## Usage

1. Start the relay:
   ```bash
   node relay.js
   ```
2. Open your Telegram bot and send `/start`.
3. Type a command (e.g., `ls -la`) or send a voice message.
4. If you want to use the local Antigravity chat, just type:
   ```
   antigravity
   ```
   *Note: The relay uses your system's default `zsh` shell.*

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
