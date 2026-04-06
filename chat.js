#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');
const util = require('node:util');
const execPromise = util.promisify(exec);
const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const PARENT_DIR = path.dirname(__dirname);

if (!DEEPSEEK_API_KEY) {
  console.error("❌ DEEPSEEK_API_KEY missing in .env");
  process.exit(1);
}

const deepseek = axios.create({
  baseURL: 'https://api.deepseek.com/v1',
  headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
});

async function getProjectContext() {
  try {
    const cwd = process.cwd();
    // Surgical Vision: Sniff out all .md plans in the root
    const planFiles = await execPromise('find . -maxdepth 1 -name "*.md" | head -n 4', { cwd })
      .then(r => r.stdout.split('\n').filter(Boolean))
      .catch(() => []);
    
    const docContexts = await Promise.all(planFiles.map(f => 
      execPromise(`cat "${f}" | head -c 800`, { cwd })
        .then(r => `--- FILE: ${f} ---\n${r.stdout}\n`)
        .catch(() => '')
    ));

    const [git, files, pkg] = await Promise.all([
      execPromise('git status -s', { cwd }).then(r => r.stdout).catch(() => 'No git'),
      execPromise('ls -F | head -n 12', { cwd }).then(r => r.stdout).catch(() => 'No files'),
      execPromise('cat package.json 2>/dev/null | head -c 800', { cwd }).then(r => r.stdout).catch(() => '')
    ]);

    return `ACTUAL PROJECT DIRECTORY: ${cwd}\n\nProject Plans & Docs:\n${docContexts.join('\n')}\nGit Status: ${git}\nFiles:\n${files}\nTechnical Deps (package.json):\n${pkg}`;
  } catch (e) {
    return `Context unavailable for ${process.cwd()}`;
  }
}

const conversationHistory = [];

async function ask(question, depth = 0) {
  if (depth > 10) {
    console.error("⚠️ Loop detected: Max recursion depth reached.");
    return "⚠️ Error: The AI is caught in a loop. Task halted safety.";
  }
  
  const context = await getProjectContext();
  conversationHistory.push({ role: 'user', content: question });
  
  if (conversationHistory.length > 20) conversationHistory.shift();

  try {
    console.log(`\n🧠 Antigravity is thinking... (Depth: ${depth})`);
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, a professional agentic AI assistant. 
TOOLS:
- [READ: path]: Returns file content.
- [WRITE: path, CONTENT: text]: Overwrites file. PROVIDE FULL CONTENT.

RULES:
1. If using a tool, your response MUST ONLY contain the tool call. NO PREAMBLE.
2. Only one tool per turn.
3. Be surgical. If a task is complete, stop tool calls.
Context: ${context}` },
        ...conversationHistory
      ]
    }, { timeout: 60000 });
    
    let answer = response.data.choices[0].message.content.trim();

    // Surgical Tool Detection
    if (answer.includes('[READ: ')) {
      const start = answer.indexOf('[READ: ') + 7;
      const end = answer.indexOf(']', start);
      if (end !== -1) {
        const filePath = answer.substring(start, end).trim().replace(/['"]/g, '');
        console.log(`🛠️ Tool Calling: READ ${filePath}`);
        try {
          const content = fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
          return await ask(`--- FILE CONTENT: ${filePath} ---\n${content}\n\n(Verify and finalize.)`, depth + 1);
        } catch (e) {
          return await ask(`--- ERROR: Could not read ${filePath}: ${e.message} ---`, depth + 1);
        }
      }
    }

    if (answer.includes('[WRITE: ')) {
      const blockStart = answer.indexOf('[WRITE: ');
      const contentKey = 'CONTENT: ';
      const contentIdx = answer.indexOf(contentKey, blockStart);
      const closeIdx = answer.lastIndexOf(']');

      if (contentIdx !== -1 && closeIdx > contentIdx) {
        const pathPart = answer.substring(blockStart + 8, answer.indexOf(',', blockStart)).trim().replace(/['"]/g, '');
        const fileContent = answer.substring(contentIdx + contentKey.length, closeIdx).trim();
        
        console.log(`🛠️ Tool Calling: WRITE ${pathPart}`);
        try {
          const fullPath = path.resolve(process.cwd(), pathPart);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, fileContent);
          console.log(`✅ Success: Physical write to ${pathPart} complete.`);
          return await ask(`--- SUCCESS: Wrote to ${pathPart}. The file is now correct. ---`, depth + 1);
        } catch (e) {
          return await ask(`--- ERROR: Failed to write ${pathPart}: ${e.message} ---`, depth + 1);
        }
      }
    }
    
    conversationHistory.push({ role: 'assistant', content: answer });
    if (conversationHistory.length > 20) conversationHistory.shift();
    return answer;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error(`❌ Brain Error:`, errorMsg);
    if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
      return "❌ Error: The AI brain timed out. Please try your command again.";
    }
    return "❌ Error: " + errorMsg;
  }
}

// Interactive looping
const rl = require('node:readline').createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'Antigravity > '
});

console.log("🚀 Antigravity CLI v1.0 (Mobile Ready)");
console.log("Type your project questions below. Type 'exit' to quit.\n");
rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  if (input.toLowerCase() === 'exit') process.exit(0);

  // Command Execution (Surgical)
  if (input === 'audit') {
    const context = await getProjectContext();
    const answer = await ask(`Perform a project audit based on this context. 3-bullet summary of goals and status. Context:\n${context}`);
    console.log(`📊 Project Pulse\n\n${answer}`);
  } else if (input.startsWith('cd ')) {
    const target = input.replace('cd ', '').replace(/['"]/g, '').trim();
    try {
      process.chdir(target);
      console.log(`\n🚀 Moved to: ${process.cwd()}\n`);
    } catch (err) {
      console.log(`\n❌ Error: ${err.message}\n`);
    }
  } else {
    const answer = await ask(input);
    console.log(`\n${answer}\n`);
  }
  rl.prompt();
});
