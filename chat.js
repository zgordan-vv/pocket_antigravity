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
    // Surgical Vision: Sniff out all .md plans in the root
    const planFiles = Array.from(new Set(['PRD.md', 'implementation_plan.md', 'README.md']))
      .filter(f => fs.existsSync(path.resolve(cwd, f)));
    
    for (const f of planFiles) {
      try {
        const content = fs.readFileSync(path.resolve(cwd, f), 'utf8').substring(0, 1000);
        context += `\n--- FILE: ${f} ---\n${content}\n`;
      } catch (e) {}
    }

    const { stdout: tree } = await execPromise('find . -maxdepth 3 -not -path "*/.*" -not -path "*/node_modules/*"', { cwd });
    context += `\nFILE TREE:\n${tree}\n`;

    const { stdout: status } = await execPromise('git status -s', { cwd }).catch(() => ({ stdout: 'No git' }));
    context += `\nGIT STATUS:\n${status}\n`;

  } catch (e) {
    console.error("Context Error:", e.message);
  }
  return context;
}

const conversationHistory = [];

async function ask(question, depth = 0) {
  if (depth > 30) {
    console.error("⚠️ Max recursion depth (30) reached.");
    return "⚠️ Error: The AI reached the execution limit for this turn.";
  }
  
  const context = await getProjectContext();
  conversationHistory.push({ role: 'user', content: question });
  
  if (conversationHistory.length > 20) conversationHistory.shift();

  try {
    console.log(`\n🧠 Antigravity is thinking... (Depth: ${depth})`);
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, an autonomous agent.
TOOLS:
- [READ: path]: Returns content or lists directory.
- [WRITE: path, CONTENT: text]: Overwrites file.

RULES:
1. ONLY response with the tool call if using a tool.
2. Project Context & File Tree:
${context}` },
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
          const fullPath = path.resolve(process.cwd(), filePath);
          const stats = fs.statSync(fullPath);
          
          let toolResult = "";
          if (stats.isDirectory()) {
            const files = fs.readdirSync(fullPath);
            toolResult = `--- DIRECTORY LISTING: ${filePath} ---\n${files.join('\n')}\n\n(Explore further or finalize.)`;
          } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            toolResult = `--- FILE CONTENT: ${filePath} ---\n${content}\n\n(Verify and finalize.)`;
          }

          // Push tool call to history but keep it lean
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(toolResult, depth + 1);
        } catch (e) {
          conversationHistory.push({ role: 'assistant', content: answer });
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
          
          conversationHistory.push({ role: 'assistant', content: `[TOOL_METADATA: Wrote ${fileContent.length} chars to ${pathPart}]` });
          return await ask(`--- SUCCESS: Wrote to ${pathPart}. The file is now correct. ---`, depth + 1);
        } catch (e) {
          conversationHistory.push({ role: 'assistant', content: answer });
          return await ask(`--- ERROR: Failed to write ${pathPart}: ${e.message} ---`, depth + 1);
        }
      }
    }
    
    // Final response cleanup: keep history lean
    conversationHistory.push({ role: 'assistant', content: answer });
    
    // Auto-Truncate History to prevent token bloat
    if (conversationHistory.length > 20) {
      conversationHistory.splice(0, 2); // Remove oldest user/assistant pair
    }

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
