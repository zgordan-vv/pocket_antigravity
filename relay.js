require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const pty = require('node-pty');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { exec } = require('node:child_process');
const util = require('node:util');
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
const shell = fs.existsSync('/bin/zsh') ? '/bin/zsh' : 'sh';
const PARENT_DIR = path.resolve(process.cwd(), '..');

// Bulletproof environment cloning and path restoration
function isPrompt(data) {
  // Detecting standard shell (%), and the new Antigravity CLI prompt (>)
  // More flexible detection to capture 'Antigravity >' even at start/end of chunks
  return /[%$\]>]/.test(data.trim());
}

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: process.env
});

// Auto-Launch: Start the Antigravity CLI brain by default
setTimeout(() => {
  ptyProcess.write('node chat.js\n');
}, 500);

let terminalBuffer = [];
let lastCommandIndex = 0;
let isCommandRunning = false;
let lastSummary = "No commands executed yet.";
let lastCtx = null; // Persisted context for background replies
const MAX_BUFFER = 2000;

ptyProcess.onData(async (data) => {
  const clean = data.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  terminalBuffer.push(clean);
  if (terminalBuffer.length > MAX_BUFFER) terminalBuffer.shift();
  
  process.stdout.write(data);

  if (isCommandRunning && isPrompt(clean)) {
    isCommandRunning = false;
    const output = terminalBuffer.slice(lastCommandIndex).join('').trim();
    if (output.length > 20 && lastCtx) {
      // 🚀 AGENT BYPASS: If the brain already answered, don't summarize it again
      if (output.includes('📊 Project Pulse') || output.includes('Antigravity >')) {
        return lastCtx.reply(`<code>${output}</code>`, { parse_mode: 'HTML', ...dashboard });
      }
      
      const summary = await summarize(output, "auto");
      lastSummary = summary;
      logToAudit("AUTO_RESULT", summary);
      bot.telegram.sendMessage(ALLOWED_ID, `<b>✅ Task Complete</b>\n\n${summary}`, { parse_mode: 'HTML' });
    }
  }
});

function logToAudit(type, content) {
  const entry = `[${new Date().toISOString()}] ${type}:\n${content}\n${'-'.repeat(40)}\n`;
  fs.appendFileSync('session_audit.log', entry);
}

async function getPtyCwd() {
  try {
    const { stdout } = await execPromise(`lsof -p ${ptyProcess.pid} | grep cwd | awk '{print $9}'`);
    return stdout.trim();
  } catch (e) {
    return process.cwd();
  }
}

async function getProjectContext() {
  try {
    const currentPath = await getPtyCwd();
    const [git, files, readme, pkg, sourceSignal] = await Promise.all([
      execPromise('git status -s', { cwd: currentPath }).then(r => r.stdout).catch(() => 'No git'),
      execPromise('ls -t | head -n 8', { cwd: currentPath }).then(r => r.stdout).catch(() => 'No files'),
      execPromise('cat README.md | head -c 500', { cwd: currentPath }).then(r => r.stdout).catch(() => ''),
      execPromise('cat package.json | head -c 1000', { cwd: currentPath }).then(r => r.stdout).catch(() => ''),
      execPromise('find src lib -type f -maxdepth 3 2>/dev/null | grep -vE "layout|page" | head -n 3', { cwd: currentPath }).then(r => r.stdout).catch(() => '')
    ]);
    return `LOCATION: ${currentPath}\nGit Status: ${git}\nFiles:\n${files}\nTechnical Deps (package.json):\n${pkg}\nCustom Source Files:\n${sourceSignal}\nREADME (Caution: Might be boilerplate):\n${readme}`;
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
        { role: 'system', content: "Summarize terminal output concisely using HTML tags (<b>, <i>, <code>). Maximum 3 bullets. Focus on actionable project context." },
        { role: 'user', content: `Context:\n${context}\n\nOutput:\n${content}` }
      ],
      model: 'deepseek-chat',
    });
    return completion.choices[0].message.content;
  } catch (err) {
    return "Summary failed.";
  }
}

const dashboard = Markup.keyboard([
  ['📁 Projects', '📊 Project Pulse'],
  ['🧠 Antigravity Chat', '♻️ Last Result']
]).resize();

// Bot Commands
bot.start((ctx) => {
  if (ctx.from.id == ALLOWED_ID) {
    lastCtx = ctx;
    ctx.reply('🚀 <b>Antigravity Terminal Bridge</b>\nConnected and ready for seaside coding.', { 
      parse_mode: 'HTML',
      ...dashboard
    });
  }
});

// ... (existing listProjects function)

bot.action(/^cd:(.+)$/, async (ctx) => {
  if (ctx.from.id != ALLOWED_ID) return;
  lastCtx = ctx;
  const project = ctx.match[1];
  const targetPath = path.join(PARENT_DIR, project);
  
  lastCommandIndex = terminalBuffer.length;
  isCommandRunning = true;
  
  ptyProcess.write(`cd "${targetPath}"\n`);
  setTimeout(() => ptyProcess.write('audit\n'), 200);
  
  ctx.answerCbQuery(`Switching to ${project}...`);
  ctx.reply(`🚀 <b>Workspace Switch: ${project}</b>`, { parse_mode: 'HTML', ...dashboard });
});

async function handleInput(text, ctx) {
  lastCtx = ctx;
  lastCommandIndex = terminalBuffer.length;
  isCommandRunning = true;
  ptyProcess.write(text + '\n');
  ctx.reply(`Relayed: <code>${text}</code>`, { parse_mode: 'HTML', ...dashboard });
}

bot.on('text', async (ctx) => {
  if (ctx.from.id != ALLOWED_ID) return;
  lastCtx = ctx;
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  // Dashboard Routing
  if (text === '📁 Projects') return listProjects(ctx);
  if (text === '📊 Project Pulse') {
    lastCommandIndex = terminalBuffer.length;
    isCommandRunning = true;
    ptyProcess.write('audit\n');
    return;
  }
  if (text === '♻️ Last Result') {
    return ctx.reply(`♻️ <b>Last Result (Cached)</b>\n\n${lastSummary}`, { parse_mode: 'HTML', ...dashboard });
  }
  if (text === '🧠 Antigravity Chat') {
    ptyProcess.write('node chat.js\n');
    return ctx.reply("🧠 <b>Antigravity Chat Activated</b>", { parse_mode: 'HTML', ...dashboard });
  }

  handleInput(text, ctx);
});

bot.on('voice', async (ctx) => {
  if (ctx.from.id != ALLOWED_ID) return;
  lastCtx = ctx;
  ctx.reply("Transcribing...");
  const text = await transcribeVoice(ctx.message.voice.file_id);
  if (text) {
    handleInput(text, ctx);
  } else {
    ctx.reply("STT failed.", dashboard);
  }
});

bot.launch();
console.log("Pocket Antigravity Relay started. Waiting for Telegram orders...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
