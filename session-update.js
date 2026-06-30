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

async function main() {
  let hookInput = {};
  try {
    const raw = await readStdin();
    hookInput = JSON.parse(raw);
  } catch {}

  const sessFile = path.join(os.homedir(), '.claude', 'central-agent-session.json');
  let sessionId = 'unknown';
  try { sessionId = JSON.parse(fs.readFileSync(sessFile, 'utf8')).session_id || 'unknown'; } catch {}

  const summary = hookInput.summary || hookInput.compact_summary || 'Session updated (PostCompact)';
  const cwd = hookInput.cwd || hookInput.project_path || process.cwd();

  await apiPost('session_update', {
    session_id: sessionId,
    machine: MACHINE,
    summary: summary.substring(0, 1000),
    files: cwd,
    next_steps: hookInput.next_steps || '',
  });

  // After session_update, also save the compaction summary to the project brain.
  // PostCompact provides hookInput.summary which IS the compressed session context — ideal for brain sync.
  if (hookInput.summary || hookInput.compact_summary) {
    const compactSummary = hookInput.summary || hookInput.compact_summary || '';
    const projectSlug = path.basename((cwd || '').replace(/\\/g, '/')).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'general';
    const now = new Date().toISOString();

    await apiPost('brain_update', {
      brain_name: `${projectSlug}-context`,
      project_slug: projectSlug,
      brain_type: 'context',
      is_global: 0,
      brain_content: `# ${projectSlug} — Context as of ${now.split('T')[0]}\nSession: ${sessionId}\n\n${compactSummary.substring(0, 6000)}`,
      updated_by: `session-update/${MACHINE}`,
    });
  }

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
