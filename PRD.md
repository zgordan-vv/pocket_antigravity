# PRD: Pocket Antigravity

Your local coding agent is powerful, but it’s anchored to your desk. Pocket Antigravity turns a Telegram bot into a remote control for your local terminal, allowing you to ship code while walking the dog or waiting for a coffee. It’s not a full IDE on your phone — it’s a high-level command center.

## 1. The Core Idea
Pocket Antigravity connects a mobile Telegram interface to your local Antigravity instance. It handles the "input" (voice/text commands) and filters the "output" (summarizing long terminal logs into 3-sentence updates). 

Instead of reading 500 lines of `npm install` and `lint` errors, you get a DeepSeek-powered summary of what actually happened.

## 2. The User Experience
The interaction follows a simple loop:
1. **The Order:** You send a voice message: *"Hey, look at the recent audit log and fix the styling in the header."*
2. **The Execution:** The bot relays this to your local machine. Antigravity starts working.
3. **The Update:** You ask for a summary. DeepSeek reads the terminal buffer and says: *"Fixed 3 CSS conflicts, updated the logo size, and restarted the dev server. Everything is green."*

## 3. Functional Requirements

### 3.1 Interface: The Telegram Bridge
*   **Command Relay:** The bot must accept text and voice messages. Voice messages are transcribed (using OpenAI Whisper or Telegram's native STT) and piped directly into the local Antigravity input stream.
*   **Persistent Session:** The bot maintains a connection to a specific local machine ID.

### 3.2 Output Management: The Summarizer
Raw terminal output is unreadable on a 6-inch screen. We use DeepSeek to condense it.
*   **Terminal Summary:** A rolling window of the last 100-200 lines of terminal output, summarized into "What is happening right now."
*   **Command Result Summary:** When a specific command finishes (e.g., a test suite or a build), the bot provides a focused summary of that specific execution's success or failure.

### 3.3 Three Essential Commands
1.  **/prompt [text|voice]**: Sends instructions to the local Antigravity agent.
2.  **/status**: Fetches a summary of the current terminal state (via DeepSeek).
3.  **/result**: Gets a detailed summary of the last executed command's output.

## 4. Proposed Architecture

### The Local Relay (Node.js)
A small server running on your machine that:
1.  Hooks into the Antigravity process (likely via a local socket or stdin/stdout redirection).
2.  Exposes a secure endpoint (via Cloudflare Tunnels or Ngrok) for the Telegram bot.
3.  Buffers terminal output for the summarizer.

### The Cloud Bot (Telegram API)
1.  Receives user input.
2.  Transcribes voice messages.
3.  Communicates with the DeepSeek API to generate summaries from the buffered terminal logs provided by the Local Relay.

## 5. Technical Stack
*   **Language:** Node.js (for high async I/O compatibility with terminal streams).
*   **API:** Telegram Bot API (telegraf.js).
*   **Summarization Engine:** DeepSeek-V3 API (for high-efficiency, low-cost context parsing).
*   **Tunnelling:** Cloudflare Tunnel (for secure, non-publicly exposed local access).
*   **Voice STT:** OpenAI Whisper (via API) for high accuracy.

## 6. Security Considerations
*   **Authentication:** The bot must only respond to your specific Telegram User ID.
*   **Encryption:** The tunnel between mobile and local must be encrypted.
*   **Safe Commands:** A "Wait for approval" mode for destructive commands (like `rm -rf /`) should be toggleable from the mobile UI.

## 7. Success Metrics
*   **Latency:** Time from voice command to local execution < 3 seconds.
*   **Accuracy:** Summaries accurately reflect build failures vs. successes without hallucinating results.
*   **Utility:** Ability to resolve a simple bug (e.g., fixing a typo) entirely from the mobile interface within 5 minutes.
