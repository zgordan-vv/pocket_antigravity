require('dotenv').config();
const { Telegraf } = require('telegraf');
const pty = require('node-pty');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');

// Config
const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_ID = parseInt(process.env.ALLOWED_USER_ID);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY; // For Whisper STT

if (!TG_TOKEN || !ALLOWED_ID) {
  console.error("Missing TG_TOKEN or ALLOWED_USER_ID in .env");
  process.exit(1);
}

// Clients
const bot = new Telegraf(TG_TOKEN);
const deepseek = new OpenAI({
  apiKey: DEEPSEEK_KEY,
  baseURL: 'https://api.deepseek.com',
});
const openai = new OpenAI({
  apiKey: OPENAI_KEY,
});

const shell = 'zsh';
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});

let terminalBuffer = [];
let lastCommandIndex = 0;
const MAX_BUFFER = 1000; // Increased window

ptyProcess.onData((data) => {
  // Strip ANSI escape codes
  const clean = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  terminalBuffer.push(clean);
  if (terminalBuffer.length > MAX_BUFFER) {
    terminalBuffer.shift();
    if (lastCommandIndex > 0) lastCommandIndex--;
  }
  process.stdout.write(data);
});

// Middlewares
bot.use(async (ctx, next) => {
  if (ctx.from.id !== ALLOWED_ID) {
    console.warn(`Unauthorized access from ${ctx.from.id}`);
    return ctx.reply("You are not authorized to control me.");
  }
  return next();
});

// STT Helper
async function transcribeVoice(fileId) {
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const audioPath = path.join(os.tmpdir(), `voice_${fileId}.oga`);
    
    // Download
    const response = await axios({
      method: 'get',
      url: link.href,
      responseType: 'stream',
    });
    const writer = fs.createWriteStream(audioPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });

    fs.unlinkSync(audioPath);
    return transcription.text;
  } catch (err) {
    console.error("STT Error:", err);
    return null;
  }
}

// Summarizer Helper
async function summarize(content, type = "status") {
  const prompt = type === "status" 
    ? "Summarize the current terminal state in 3-5 concise bullet points. What is happening? Any errors or finishes?"
    : "The following is the output of a specific command. Summarize what it did and if it was successful.";

  try {
    const completion = await deepseek.chat.completions.create({
      messages: [
        { role: 'system', content: "You are a terminal expert. Your summaries are brief, technical, and accurate. No fluff." },
        { role: 'user', content: `${prompt}\n\nTerminal Output:\n${content}` }
      ],
      model: 'deepseek-chat',
    });
    return completion.choices[0].message.content;
  } catch (err) {
    console.error("Summarizer Error:", err);
    return "Failed to generate summary.";
  }
}

// Commands
bot.start((ctx) => ctx.reply("Pocket Antigravity listening. Use /prompt, /status, or /result."));

bot.command('prompt', async (ctx) => {
  const text = ctx.message.text.replace('/prompt', '').trim();
  if (text) {
    lastCommandIndex = terminalBuffer.length;
    ptyProcess.write(text + '\n');
    ctx.reply(`Relayed: ${text}`);
  } else {
    ctx.reply("Send a command after /prompt or send a voice message.");
  }
});

bot.command('status', async (ctx) => {
  const snapshot = terminalBuffer.slice(-200).join(''); // Last 200 chunks
  const summary = await summarize(snapshot, "status");
  ctx.reply(`📊 *Current Status*\n\n${summary}`, { parse_mode: 'Markdown' });
});

bot.command('result', async (ctx) => {
  const resultData = terminalBuffer.slice(lastCommandIndex).join('');
  if (resultData.length < 10) {
    return ctx.reply("Not enough new output for a result summary yet.");
  }
  const summary = await summarize(resultData, "result");
  ctx.reply(`✅ *Last Result Summary*\n\n${summary}`, { parse_mode: 'Markdown' });
});

// Handle text messages directly
bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  lastCommandIndex = terminalBuffer.length;
  ptyProcess.write(ctx.message.text + '\n');
  ctx.reply(`Relayed: ${ctx.message.text}`);
});

// Handle voice
bot.on('voice', async (ctx) => {
  ctx.reply("Transcribing voice...");
  const text = await transcribeVoice(ctx.message.voice.file_id);
  if (text) {
    lastCommandIndex = terminalBuffer.length;
    ptyProcess.write(text + '\n');
    ctx.reply(`Transcribed & Relayed: ${text}`);
  } else {
    ctx.reply("Could not transcribe voice.");
  }
});

bot.launch();
console.log("Pocket Antigravity Relay started. Waiting for Telegram commands...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
