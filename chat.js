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
  let context = "";
  try {
    const cwd = process.cwd();
    const docs = ['PRD.md', 'implementation_plan.md', 'README.md', 'package.json'];
    
    for (const f of docs) {
      if (fs.existsSync(path.resolve(cwd, f))) {
        const content = fs.readFileSync(path.resolve(cwd, f), 'utf8');
        context += `\n--- FILE: ${f} ---\n${content}\n`;
      }
    }

    const { stdout: tree } = await execPromise('find . -maxdepth 4 -not -path "*/.*" -not -path "*/node_modules/*"', { cwd });
    context += `\nPROJECT STRUCTURE:\n${tree}\n`;

    const { stdout: status } = await execPromise('git status -s', { cwd }).catch(() => ({ stdout: '' }));
    context += `\nGIT STATUS:\n${status}\n`;

  } catch (e) {}
  return context;
}

const conversationHistory = [];

async function ask(question, depth = 0) {
  if (depth > 50) return "⚠️ Execution limit reached.";
  
  const context = await getProjectContext();
  conversationHistory.push({ role: 'user', content: question });
  if (conversationHistory.length > 30) conversationHistory.shift();

  try {
    console.log(`\n🧠 Antigravity is thinking...`);
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, an autonomous agent with local filesystem access. 

TOOLS:
- [READ: path]: Returns file content or directory listing.
- [WRITE: path, CONTENT: text]: Overwrites file with full content.

PROJECT CONTEXT:
${context}` },
        ...conversationHistory
      ]
    }, { timeout: 300000 });
    
    let answer = response.data.choices[0].message.content.trim();

    // Tool Detection
    if (answer.includes('[READ: ')) {
      const start = answer.indexOf('[READ: ') + 7;
      const end = answer.indexOf(']', start);
      if (end !== -1) {
        const filePath = answer.substring(start, end).trim().replace(/['"]/g, '');
        console.log(`🛠️ Tool Calling: READ ${filePath}`);
        try {
          const fullPath = path.resolve(process.cwd(), filePath);
          const stats = fs.statSync(fullPath);
          const result = stats.isDirectory() ? fs.readdirSync(fullPath).join('\n') : fs.readFileSync(fullPath, 'utf8');
          
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(`--- RESULT for READ ${filePath} ---\n${result}`, depth + 1);
        } catch (e) {
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(`--- ERROR: ${e.message} ---`, depth + 1);
        }
      }
    }

    if (answer.includes('[WRITE: ')) {
      const blockStart = answer.indexOf('[WRITE: ');
      const contentIdx = answer.indexOf('CONTENT: ', blockStart);
      const closeIdx = answer.lastIndexOf(']');

      if (contentIdx !== -1 && closeIdx > contentIdx) {
        const pathPart = answer.substring(blockStart + 8, answer.indexOf(',', blockStart)).trim().replace(/['"]/g, '');
        const fileContent = answer.substring(contentIdx + 9, closeIdx).trim();
        
        console.log(`🛠️ Tool Calling: WRITE ${pathPart}`);
        try {
          const fullPath = path.resolve(process.cwd(), pathPart);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, fileContent);
          console.log(`✅ Success: Physical write to ${pathPart} complete.`);
          
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(`--- SUCCESS: Wrote ${pathPart} ---`, depth + 1);
        } catch (e) {
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(`--- ERROR: ${e.message} ---`, depth + 1);
        }
      }
    }
    
    conversationHistory.push({ role: 'assistant', content: answer });
    return answer;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error(`❌ Brain Error:`, errorMsg);
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

  const context = await getProjectContext();

  // Command Execution (Surgical)
  if (input === 'audit') {
    const answer = await ask(`Perform a project audit based on this context. 3-bullet summary of goals and status.`);
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
