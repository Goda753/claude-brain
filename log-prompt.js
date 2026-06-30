#!/usr/bin/env node
'use strict';
/**
 * UserPromptSubmit hook — logs every user prompt to Claude Central chat_logs
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const API_HOST = 'command.digitalmaster.no';
const MACHINE  = process.platform === 'darwin' ? 'mac' : 'windows-pc';

function post(action, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 6000,
      rejectUnauthorized: false,
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  });
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    // Timeout safety — if stdin never closes, give up after 3s
    setTimeout(() => resolve(data), 3000);
  });
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch { process.stdout.write('{}'); return; }

  const sessionId = input.session_id || input.sessionId || 'unknown';
  // Claude Code UserPromptSubmit sends the prompt in different fields depending on version
  const prompt = input.prompt || input.message || input.content
    || (input.tool_input && (input.tool_input.prompt || input.tool_input.message))
    || '';
  const cwd = input.cwd || process.cwd();

  if (!prompt || !sessionId || sessionId === 'unknown') {
    process.stdout.write('{}'); return;
  }

  const label = path.basename(cwd.replace(/\\/g, '/'));

  await post('chat_log', {
    session_id:   sessionId,
    role:         'user',
    content:      prompt.substring(0, 65000),
    machine:      MACHINE,
    project_path: cwd,
    window_label: label,
  });

  // Store session state for response hook to use
  try {
    const stateFile = path.join(os.homedir(), '.claude', `chat-session-${sessionId.slice(-8)}.json`);
    fs.writeFileSync(stateFile, JSON.stringify({ session_id: sessionId, cwd, label, updated: Date.now() }));
  } catch {}

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
