#!/usr/bin/env node
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST = 'command.digitalmaster.no';
const MACHINE  = process.platform === 'darwin' ? 'mac' : 'windows-pc';

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
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve());
    });
    req.on('error', () => resolve());
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(payload); req.end();
  });
}

async function main() {
  let hookInput = {};
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    hookInput = JSON.parse(raw);
  } catch {}

  const sessFile = path.join(os.homedir(), '.claude', 'central-agent-session.json');
  let sessionId = 'unknown';
  try { sessionId = JSON.parse(fs.readFileSync(sessFile, 'utf8')).session_id || 'unknown'; } catch {}

  const compactSummary = hookInput.summary || hookInput.compact_summary || 'Session updated (PostCompact)';
  const cwd = process.cwd();

  await apiPost('session_update', {
    session_id: sessionId,
    machine: MACHINE,
    summary: compactSummary.substring(0, 1000),
    files: cwd,
    next_steps: hookInput.next_steps || '',
  });

  // Save compaction summary as a structured learning
  if (compactSummary && sessionId) {
    const projectSlug = path.basename((cwd||'').replace(/\\/g,'/')).toLowerCase().replace(/[^a-z0-9-]/g,'-') || 'global';

    // Extract learning type from summary content
    const summaryLower = compactSummary.toLowerCase();
    let learningType = 'insight';
    if (summaryLower.includes('bug') || summaryLower.includes('fix') || summaryLower.includes('error')) learningType = 'pitfall';
    else if (summaryLower.includes('built') || summaryLower.includes('created') || summaryLower.includes('implement')) learningType = 'pattern';
    else if (summaryLower.includes('turbo') || summaryLower.includes('agent') || summaryLower.includes('parallel')) learningType = 'technique';

    await apiPost('add_learning', {
      session_id: sessionId,
      project_slug: projectSlug,
      machine: MACHINE,
      learning_type: learningType,
      title: `Session context: ${projectSlug} (${new Date().toISOString().split('T')[0]})`,
      content: compactSummary.substring(0, 8000),
      source: 'compact',
      quality: 4,
    });

    // Auto-evolve the project brain
    await apiPost('brain_evolve', { project_slug: projectSlug });
  }

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
