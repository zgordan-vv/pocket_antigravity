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
const ptyEnv = { 
  ...process.env,
  PATH: (process.env.PATH || '') + ':/bin:/usr/bin:/usr/local/bin'
};

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: ptyEnv,
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
  ctx.reply(`🚀 <b>Workspace Switch: ${project}</b>`, { parse_mode: 'HTML' });
  
  // Quick delay for the cd to settle then summarize
  setTimeout(async () => {
    const summary = await summarize("Switched to project " + project, "status");
    ctx.reply(`📊 <b>Project Audit</b>\n\n${summary}`, { parse_mode: 'HTML' });
  }, 1000);
});

bot.command('status', async (ctx) => {
  const summary = await summarize(terminalBuffer.slice(-200).join(''), "status");
  logToAudit("STATUS_CHECK", summary);
  ctx.reply(`📊 <b>Current Status</b>\n\n${summary}`, { parse_mode: 'HTML' });
});

bot.command('result', (ctx) => {
  ctx.reply(`♻️ <b>Last Result (Cached)</b>\n\n${lastSummary}`, { parse_mode: 'HTML' });
});

async function hasActiveAgent() {
  try {
    const { stdout } = await execPromise(`pgrep -P ${ptyProcess.pid}`);
    return stdout.trim().length > 0;
  } catch (e) {
    return false;
  }
}

async function handleInput(text, ctx) {
  // 1. Ask DeepSeek for Intent (Routing)
  const agentRunning = await hasActiveAgent();
  let intent = 'COMMAND';
  
  if (!agentRunning) {
    const router = await deepseek.chat.completions.create({
      messages: [
        { role: 'system', content: "Classify user input: 'COMMAND' (ls, cd, npm, git) or 'AGENT' (natural language requests, questions, instructions like 'mark done'). Reply with ONLY the word." },
        { role: 'user', content: text }
      ],
      model: 'deepseek-chat',
    });
    intent = router.choices[0].message.content.trim().toUpperCase();
  }

  if (intent.includes('AGENT') && !agentRunning) {
    ctx.reply("🤔 <i>Antigravity is thinking...</i>", { parse_mode: 'HTML' });
    const context = await getProjectContext();
    
    // Safety Loop: Initial probe or direct answer
    const probe = await deepseek.chat.completions.create({
      messages: [
        { role: 'system', content: "You are the Antigravity AI Agent. Review the project context. If you need to read a file to answer correctly, reply ONLY with 'READ: filename'. Context:\n" + context },
        { role: 'user', content: text }
      ],
      model: 'deepseek-chat',
    });

    const response = probe.choices[0].message.content;
    const readMatch = response.match(/READ:\s*([^\s\n]+)/);
    const replaceMatch = response.match(/REPLACE:\s*([^\s\n]+)/);

    if (readMatch) {
      const fileName = readMatch[1].replace(/[`]/g, '');
      const currentPath = await getPtyCwd();
      const fileContent = await execPromise(`cat "${fileName}" | head -n 100`, { cwd: currentPath }).then(r => r.stdout).catch(() => "File unreadable.");
      const finalReply = await deepseek.chat.completions.create({
        messages: [
          { role: 'system', content: "You are Antigravity. Be direct and specific. If you need to edit this file to fulfill the request, reply ONLY with: REPLACE: filename \\n TARGET: exact_old_text \\n WITH: new_text. Use 'RAG for Humans' style." },
          { role: 'user', content: `Context from ${fileName}:\n${fileContent}\n\nTask: ${text}` }
        ],
        model: 'deepseek-chat',
      });
      
      const editResponse = finalReply.choices[0].message.content;
      if (editResponse.includes('REPLACE:')) {
        const parts = editResponse.split('\n').map(p => p.trim());
        const target = parts.find(p => p.startsWith('TARGET:')).replace('TARGET:', '').trim();
        const replacement = parts.find(p => p.startsWith('WITH:')).replace('WITH:', '').trim();
        const fullPath = path.join(currentPath, fileName);
        const original = fs.readFileSync(fullPath, 'utf8');
        if (original.includes(target)) {
          fs.writeFileSync(fullPath, original.replace(target, replacement));
          return ctx.reply(`<b>Edit Complete:</b> Marked task in <code>${fileName}</code>`, { parse_mode: 'HTML' });
        }
        return ctx.reply(`⚠️ Failed to find target text in <code>${fileName}</code>`, { parse_mode: 'HTML' });
      }

      return ctx.reply(`<b>Reading ${fileName}...</b>\n\n${editResponse}`, { parse_mode: 'HTML' });
    }

    // Direct answer with full Antigravity persona
    const finalAnswer = await deepseek.chat.completions.create({
      messages: [
        { role: 'system', content: "You are Antigravity, a powerful agentic AI coding assistant. Follow 'RAG for Humans' writing rules: be a knowledgeable friend, earn every sentence, be specific, and avoid hype words. Use HTML (<b>, <i>, <code>). Max 3 bullets. Context:\n" + context },
        { role: 'user', content: text }
      ],
      model: 'deepseek-chat',
    });
    return ctx.reply(finalAnswer.choices[0].message.content, { parse_mode: 'HTML' });
  }

  // It's a command or an agent is already handling it
  lastCommandIndex = terminalBuffer.length;
  isCommandRunning = true;
  ptyProcess.write(text + '\n');
  ctx.reply(`Relayed: <code>${text}</code>`, { parse_mode: 'HTML' });
}

bot.on('text', (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  handleInput(ctx.message.text, ctx);
});

bot.on('voice', async (ctx) => {
  ctx.reply("Transcribing...");
  const text = await transcribeVoice(ctx.message.voice.file_id);
  if (text) {
    handleInput(text, ctx);
  } else {
    ctx.reply("STT failed.");
  }
});

bot.launch();
console.log("Pocket Antigravity Relay started. Waiting for Telegram orders...");

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
