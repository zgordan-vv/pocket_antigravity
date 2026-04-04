require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const pty = require('node-pty');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Config
const TG_TOKEN = process.env.TG_TOKEN;
const ALLOWED_ID = parseInt(process.env.ALLOWED_USER_ID);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

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

// Terminal
const shell = 'zsh';
const PARENT_DIR = path.resolve(process.cwd(), '..');
const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env,
});

let terminalBuffer = [];
let lastCommandIndex = 0;
let isCommandRunning = false;
let lastSummary = "No commands executed yet.";
const MAX_BUFFER = 2000;

// Prompt Detection (macOS/zsh)
function isPrompt(data) {
  return data.includes('% ') || data.includes('$ ');
}

ptyProcess.onData(async (data) => {
  const clean = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  terminalBuffer.push(clean);
  if (terminalBuffer.length > MAX_BUFFER) terminalBuffer.shift();
  
  process.stdout.write(data);

  if (isCommandRunning && isPrompt(clean)) {
    isCommandRunning = false;
    const output = terminalBuffer.slice(lastCommandIndex).join('');
    if (output.length > 50) {
      const summary = await summarize(output, "auto");
      lastSummary = summary;
      logToAudit("AUTO_RESULT", summary);
      bot.telegram.sendMessage(ALLOWED_ID, `✅ *Task Complete*\n\n${summary}`, { parse_mode: 'Markdown' });
    }
  }
});

function logToAudit(type, content) {
  const entry = `[${new Date().toISOString()}] ${type}:\n${content}\n${'-'.repeat(40)}\n`;
  fs.appendFileSync('session_audit.log', entry);
}

async function getProjectContext() {
  try {
    const [git, files] = await Promise.all([
      execPromise('git status -s').then(r => r.stdout).catch(() => 'No git'),
      execPromise('ls -t | head -n 5').then(r => r.stdout).catch(() => 'No files')
    ]);
    return `Context: Git=${git || 'clean'}, Files=${files}`;
  } catch (e) {
    return "Context unavailable.";
  }
}

async function transcribeVoice(fileId) {
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const audioPath = path.join(os.tmpdir(), `voice_${fileId}.oga`);
    const response = await axios({ method: 'get', url: link.href, responseType: 'stream' });
    const writer = fs.createWriteStream(audioPath);
    response.data.pipe(writer);
    await new Promise((resolve) => writer.on('finish', resolve));

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
    });
    fs.unlinkSync(audioPath);
    return transcription.text;
  } catch (err) {
    return null;
  }
}

async function summarize(content, type = "status") {
  const context = await getProjectContext();
  try {
    const completion = await deepseek.chat.completions.create({
      messages: [
        { role: 'system', content: "Summarize terminal output concisely (3 bullets max). Know that files and git status are context." },
        { role: 'user', content: `Context:\n${context}\n\nOutput:\n${content}` }
      ],
      model: 'deepseek-chat',
    });
    return completion.choices[0].message.content;
  } catch (err) {
    return "Summary failed.";
  }
}

// Bot Commands
bot.start((ctx) => ctx.reply("Pocket Antigravity Dashboard.\nCommands: /projects, /status, /result."));

bot.command('projects', async (ctx) => {
  try {
    const items = fs.readdirSync(PARENT_DIR, { withFileTypes: true });
    const folders = items.filter(i => i.isDirectory() && !i.name.startsWith('.')).map(i => i.name);
    
    if (folders.length === 0) return ctx.reply("No other projects found in the parent directory.");
    
    const buttons = folders.map(f => Markup.button.callback(f, `cd:${f}`));
    // Group in pairs for better UI
    const chunks = [];
    for (let i = 0; i < buttons.length; i += 2) chunks.push(buttons.slice(i, i + 2));
    
    ctx.reply("📂 *Select Active Workspace:*", Markup.inlineKeyboard(chunks));
  } catch (e) {
    ctx.reply("Failed to list projects.");
  }
});

bot.action(/^cd:(.+)$/, async (ctx) => {
  const project = ctx.match[1];
  const targetPath = path.join(PARENT_DIR, project);
  
  lastCommandIndex = terminalBuffer.length;
  ptyProcess.write(`cd "${targetPath}"\n`);
  
  ctx.answerCbQuery(`Switching to ${project}...`);
  ctx.reply(`🚀 *Workspace Switch: ${project}*`);
  
  // Quick delay for the cd to settle then summarize
  setTimeout(async () => {
    const summary = await summarize("Switched to project " + project, "status");
    ctx.reply(`📊 *Project Audit*\n\n${summary}`, { parse_mode: 'Markdown' });
  }, 1000);
});

bot.command('status', async (ctx) => {
  const summary = await summarize(terminalBuffer.slice(-200).join(''), "status");
  logToAudit("STATUS_CHECK", summary);
  ctx.reply(`📊 *Current Status*\n\n${summary}`, { parse_mode: 'Markdown' });
});

bot.command('result', (ctx) => {
  ctx.reply(`♻️ *Last Result (Cached)*\n\n${lastSummary}`, { parse_mode: 'Markdown' });
});

function handleInput(text) {
  lastCommandIndex = terminalBuffer.length;
  isCommandRunning = true;
  ptyProcess.write(text + '\n');
}

bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  handleInput(ctx.message.text);
  ctx.reply(`Relayed: ${ctx.message.text}`);
});

bot.on('voice', async (ctx) => {
  ctx.reply("Transcribing...");
  const text = await transcribeVoice(ctx.message.voice.file_id);
  if (text) {
    handleInput(text);
    ctx.reply(`Relayed: ${text}`);
  } else {
    ctx.reply("STT failed.");
  }
});

bot.launch();
console.log("Pocket Antigravity Relay started. Waiting for Telegram orders...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
