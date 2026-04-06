#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
require('dotenv').config();

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

if (!DEEPSEEK_API_KEY) {
  console.error("❌ DEEPSEEK_API_KEY missing in .env");
  process.exit(1);
}

const deepseek = axios.create({
  baseURL: 'https://api.deepseek.com/v1',
  headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` }
});

const conversationHistory = [];

async function ask(question, depth = 0) {
  if (depth > 50) return "⚠️ Execution limit reached.";
  
  conversationHistory.push({ role: 'user', content: question });
  if (conversationHistory.length > 30) conversationHistory.shift();

  try {
    console.log(`\n🧠 Antigravity is thinking...`);
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, an autonomous agent.
TOOLS:
- [READ: path]: Returns file content or directory listing.
- [WRITE: path, CONTENT: text]: Physical file write.` },
        ...conversationHistory
      ]
    }, { timeout: 300000 });
    
    let answer = response.data.choices[0].message.content.trim();

    // Tool Detection (Pure Pass-through)
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
          return await ask(`--- RESULT: READ ${filePath} ---\n${result}`, depth + 1);
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

console.log("🚀 Antigravity CLI v3.0 (Pure Pipe Mode)");
rl.prompt();

rl.on('line', async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }
  if (input.toLowerCase() === 'exit') process.exit(0);

  if (input.startsWith('cd ')) {
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
