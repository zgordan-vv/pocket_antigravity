#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
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

async function ask(question) {
  const context = await getProjectContext();
  conversationHistory.push({ role: 'user', content: question });
  
  if (conversationHistory.length > 15) conversationHistory.shift();

  try {
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, a powerful agentic AI coding assistant. You have REAL HANDS.
If you need to see a file, output exactly: [READ: path/to/file]
If you need to create/update a file, output exactly: [WRITE: path/to/file, CONTENT: ...full content...]
You will then receive the result in the next turn. 
NEVER hallucinate results; always use the [READ] tool to verify. 
Your context is: ${context}` },
        ...conversationHistory
      ]
    });
    
    let answer = response.data.choices[0].message.content;

    // Surgical Tool Execution Loop
    if (answer.includes('[READ:')) {
      const filePath = answer.match(/\[READ: (.+?)\]/)[1];
      try {
        const content = fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');
        return await ask(`--- FILE CONTENT: ${filePath} ---\n${content}\n\n(Now finish your original response based on this file content.)`);
      } catch (e) {
        return await ask(`--- ERROR: Could not read ${filePath}: ${e.message} ---`);
      }
    }

    if (answer.includes('[WRITE:')) {
      const match = answer.match(/\[WRITE: (.+?), CONTENT: ([\s\S]+?)\]/);
      if (match) {
        const filePath = match[1];
        const content = match[2];
        try {
          fs.writeFileSync(path.resolve(process.cwd(), filePath), content);
          return await ask(`--- SUCCESS: Wrote to ${filePath} ---`);
        } catch (e) {
          return await ask(`--- ERROR: Failed to write ${filePath}: ${e.message} ---`);
        }
      }
    }
    
    conversationHistory.push({ role: 'assistant', content: answer });
    if (conversationHistory.length > 15) conversationHistory.shift();
    return answer;
  } catch (err) {
    return "❌ Error: " + (err.response?.data?.error?.message || err.message);
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
