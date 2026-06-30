#!/usr/bin/env node
'use strict';
/**
 * Stop hook — reads the JSONL transcript to find the last assistant message
 * and logs it to Claude Central chat_logs
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const API_HOST = 'command.digitalmaster.no';
const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const MACHINE  = process.platform === 'darwin' ? 'mac' : 'windows-pc';

function post(action, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 8000,
      rejectUnauthorized: false,
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  });
}

function apiGet(action) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 15000,
      rejectUnauthorized: false,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function apiPost(action, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 15000,
      rejectUnauthorized: false,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function detectAndLogFeedback(sessionId, responseContent, cwd) {
  try {
    const history = await apiGet(`chat_history&session_id=${encodeURIComponent(sessionId)}&limit=5`);
    if (!Array.isArray(history) || history.length < 2) return;

    // Get the last user message (the one just before this response)
    const lastUser = [...history].reverse().find(m => m.role === 'user');
    if (!lastUser) return;

    const userText = (lastUser.content || '').toLowerCase();
    const projectSlug = path.basename((cwd || '').replace(/\\/g, '/')).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'global';

    // Positive signals — something worked
    const positive = ['perfect', 'exactly right', 'great work', 'well done', 'amazing', 'exactly what', 'that works', 'yes exactly', 'love it', 'brilliant', 'thats it', "that's it"];
    const isPositive = positive.some(p => userText.includes(p));

    // Correction signals — something needs fixing
    const negative = ["that's wrong", "thats wrong", "not what i", "fix it", "that's not", "don't do that", "stop doing", "no not that", "wrong approach"];
    const isCorrection = negative.some(p => userText.includes(p));

    if (isPositive) {
      const responseSnippet = responseContent.substring(0, 600);
      await apiPost('add_learning', {
        session_id:    sessionId,
        project_slug:  projectSlug,
        learning_type: 'technique',
        title:         `✅ Validated approach (user: "${userText.substring(0, 50)}")`,
        content:       `User confirmed this worked. Response preview:\n${responseSnippet}\n\nProject: ${cwd}`,
        source:        'feedback',
        quality:       5,
      });
    }

    if (isCorrection) {
      const correctionText = userText.substring(0, 200);
      await apiPost('add_learning', {
        session_id:    sessionId,
        project_slug:  projectSlug,
        learning_type: 'pitfall',
        title:         `❌ Correction needed: "${userText.substring(0, 60)}"`,
        content:       `User corrected this approach. What to avoid:\n${correctionText}\n\nProject: ${cwd}`,
        source:        'feedback',
        quality:       2,
      });
    }
  } catch(e) { /* silent */ }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 3000);
  });
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text)
      .join('\n');
  }
  return '';
}

function findJsonlFile(sessionId) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const dirs = fs.readdirSync(projectsDir);
    for (const dir of dirs) {
      const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {}
  return null;
}

function getLastAssistantMessage(jsonlPath) {
  try {
    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    // Scan from the end for the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        const role = obj.type || (obj.message && obj.message.role);
        if (role === 'assistant') {
          const content = obj.message
            ? extractText(obj.message.content)
            : extractText(obj.content);
          if (content && content.trim()) return { content, index: i };
        }
      } catch {}
    }
  } catch {}
  return null;
}

async function main() {
  let input = {};
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch { process.stdout.write('{}'); return; }

  const sessionId = input.session_id || input.sessionId || 'unknown';
  if (!sessionId || sessionId === 'unknown') { process.stdout.write('{}'); return; }

  const jsonlPath = findJsonlFile(sessionId);
  if (!jsonlPath) { process.stdout.write('{}'); return; }

  const result = getLastAssistantMessage(jsonlPath);
  if (!result || !result.content) { process.stdout.write('{}'); return; }

  // Get window label from state file written by log-prompt.js
  let label = 'Claude Code';
  let cwd   = '';
  try {
    const stateFile = path.join(os.homedir(), '.claude', `chat-session-${sessionId.slice(-8)}.json`);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    label = state.label || label;
    cwd   = state.cwd   || cwd;
  } catch {}

  await post('chat_log', {
    session_id:   sessionId,
    role:         'assistant',
    content:      result.content.substring(0, 65000),
    machine:      MACHINE,
    project_path: cwd,
    window_label: label,
    message_index: result.index,
  });

  // Detect feedback signals and log learnings
  await detectAndLogFeedback(sessionId, result.content, cwd);

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
