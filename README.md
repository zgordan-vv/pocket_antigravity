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
- `/status` - Get a summary of the current terminal state.
- `/result` - Get a summary of the output produced *after* your last command.
- *Direct Text* - Anything sent (not starting with /) is relayed as a command.

## Architecture
- **Front-end:** Telegram Bot.
- **Relay:** Node.js server with `node-pty`.
- **Brain:** DeepSeek-V3 for text summarization.
- **Ears:** OpenAI Whisper for voice transcription.
