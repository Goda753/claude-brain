#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST = 'command.digitalmaster.no';
const MACHINE  = process.platform === 'darwin' ? 'mac' : 'windows-pc';

function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => resolve(d || '{}'));
    process.stdin.on('error', () => resolve('{}'));
    setTimeout(() => resolve(d || '{}'), 2000);
  });
}

function apiPost(action, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 8000,
      rejectUnauthorized: false,
    }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    req.on('error', () => resolve('{}'));
    req.on('timeout', () => { req.destroy(); resolve('{}'); });
    req.write(payload); req.end();
  });
}

function apiGet(actionAndParams) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${actionAndParams}`,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 8000,
      rejectUnauthorized: false,
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Save session summary to project brain so future sessions know what happened
async function saveSessionSummary(sessionId, cwd, machine) {
  // Get the last N messages from this session
  const history = await apiGet(`chat_history&session_id=${encodeURIComponent(sessionId)}&limit=20`);
  if (!Array.isArray(history) || !history.length) return;

  const projectSlug = path.basename((cwd || '').replace(/\\/g, '/')).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'general';

  // Build a summary from the messages
  const lastMsgs = history.slice(-10); // last 10 messages
  const userMsgs = lastMsgs.filter(m => m.role === 'user').map(m => (m.content || '').substring(0, 150)).join(' | ');
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  const lastResponse = lastAssistant ? (lastAssistant.content || '').substring(0, 500) : '';

  const now = new Date().toISOString();
  const summary = `## Session: ${sessionId.substring(0, 16)} (${machine}) — ${now.split('T')[0]}
Project: ${cwd || 'unknown'}
Last topics: ${userMsgs.substring(0, 300)}
Last response preview: ${lastResponse.substring(0, 300)}
Messages: ${history.length} total`;

  // Fetch existing brain content for this project
  const brainName = `${projectSlug}-sessions`;
  const existing = await apiGet(`brain_get&project_slug=${encodeURIComponent(projectSlug)}&brain_name=${encodeURIComponent(brainName)}`);
  let existingContent = '';
  // brain_get with project_slug + brain_name returns a single object (not array)
  if (existing && typeof existing === 'object' && !Array.isArray(existing) && existing.brain_content) {
    existingContent = existing.brain_content;
  }

  // Keep last 5 session summaries (prepend new one)
  const summaries = existingContent.split('\n## Session:').filter(Boolean);
  const trimmed = summaries.slice(0, 4).join('\n## Session:');
  const newContent = summary + (trimmed ? '\n\n---\n\n## Session:' + trimmed : '');

  await apiPost('brain_update', {
    brain_name: brainName,
    project_slug: projectSlug,
    brain_type: 'sessions',
    is_global: 0,
    brain_content: newContent.substring(0, 8000),
    updated_by: `session-end/${machine}`,
  });
}

async function main() {
  let hookInput = {};
  try {
    const raw = await readStdin();
    hookInput = JSON.parse(raw);
  } catch {}

  const sessFile = path.join(os.homedir(), '.claude', 'central-agent-session.json');
  let sessionId = 'unknown';
  try { sessionId = JSON.parse(fs.readFileSync(sessFile, 'utf8')).session_id || 'unknown'; } catch {}

  const cwd = hookInput.cwd || hookInput.project_path || process.cwd();

  await apiPost('session_end', {
    session_id: sessionId,
    machine: MACHINE,
    summary: (hookInput.summary || 'Session ended').substring(0, 500),
  });

  // Save session summary to project brain so future sessions know what happened
  await saveSessionSummary(sessionId, cwd, MACHINE);

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
