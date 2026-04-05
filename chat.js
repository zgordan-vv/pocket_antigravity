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
    const [git, files, readme, pkg] = await Promise.all([
      execPromise('git status -s').then(r => r.stdout).catch(() => 'No git'),
      execPromise('ls -t | head -n 8').then(r => r.stdout).catch(() => 'No files'),
      execPromise('cat README.md | head -c 500').then(r => r.stdout).catch(() => ''),
      execPromise('cat package.json | head -c 1000').then(r => r.stdout).catch(() => '')
    ]);
    return `Git Status: ${git}\nFiles:\n${files}\nTechnical Deps (package.json):\n${pkg}\nREADME Snippet:\n${readme}`;
  } catch (e) {
    return "Context unavailable.";
  }
}

async function ask(question) {
  const context = await getProjectContext();
  try {
    const response = await deepseek.post('/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: `You are Antigravity, a powerful agentic AI coding assistant. Follow 'RAG for Humans' writing rules: be a knowledgeable friend, earn every sentence, be specific, and avoid hype. Use Markdown for formatting. Context:\n${context}` },
        { role: 'user', content: question }
      ]
    });
    return response.data.choices[0].message.content;
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
