#!/usr/bin/env node
/**
 * sync-brain.js — bidirectional brain sync with Claude Central
 *
 * Push mode (default when CLAUDE.md exists):
 *   node ~/.claude/sync-brain.js
 *   Reads ~/.claude/CLAUDE.md and pushes rules to Central as global brain cards.
 *
 * Pull mode (--pull flag, or when CLAUDE.md doesn't exist):
 *   node ~/.claude/sync-brain.js --pull
 *   Fetches global brain cards from Central and caches them locally in brain-cache.json.
 *   Called by setup-mac.sh on a fresh machine.
 */
'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const API_KEY   = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST  = 'command.digitalmaster.no';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

// ── Pull mode: fetch global brains from Central ─────────────────────────────
async function pullBrains() {
  console.log('[sync-brain] Pulling global rules from Claude Central...');
  const brains = await apiGet('brain_get');
  if (!brains || !Array.isArray(brains)) {
    console.error('[sync-brain] Failed to fetch brains from Central — check API connectivity');
    process.exit(1);
  }

  const globalBrains = brains.filter(b =>
    b.is_global == 1 || b.project_slug === 'global' || b.brain_type === 'global'
  );

  if (!globalBrains.length) {
    console.log('[sync-brain] No global brains found on Central — nothing to pull');
    process.exit(0);
  }

  const cacheFile = path.join(CLAUDE_DIR, 'brain-cache.json');
  const cache = { synced_at: new Date().toISOString(), brains: globalBrains };
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

  const totalChars = globalBrains.reduce((s, b) => s + (b.brain_content || b.content || '').length, 0);
  console.log(`[sync-brain] Pulled ${globalBrains.length} global brain(s) — ${totalChars} chars — cached to brain-cache.json`);
  globalBrains.forEach(b => {
    const preview = (b.brain_content || b.content || '').substring(0, 80).replace(/\n/g, ' ');
    console.log(`  - ${b.brain_name || b.project_slug}: ${preview}...`);
  });
  process.exit(0);
}

function apiGet(action) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 10000,
      rejectUnauthorized: false,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Route: pull if --pull flag or CLAUDE.md missing ─────────────────────────
const isPull = process.argv.includes('--pull') ||
               !fs.existsSync(path.join(CLAUDE_DIR, 'CLAUDE.md'));

if (isPull) {
  pullBrains().catch(err => { console.error('[sync-brain]', err.message); process.exit(1); });
  // Stop here — don't fall through to push mode
  return; // (in CJS this is a no-op but the async branch exits above)
}

// ── Push mode helpers ────────────────────────────────────────────────────────

function post(body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: '/api.php?action=brain_update',
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
      rejectUnauthorized: false,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { console.log('  ↳', JSON.parse(d)); } catch { console.log('  ↳', d.substring(0, 100)); } resolve(); });
    });
    req.on('error', e => { console.error('  ✗ error:', e.message); resolve(); });
    req.on('timeout', () => { req.destroy(); resolve(); });
    req.write(payload);
    req.end();
  });
}

async function main() {
  const claudeMd = fs.readFileSync(path.join(os.homedir(), '.claude', 'CLAUDE.md'), 'utf8');

  // Extract sections
  const extractSection = (start, end) => {
    const startIdx = claudeMd.indexOf(start);
    if (startIdx === -1) return null;
    const endIdx = end ? claudeMd.indexOf(end, startIdx + start.length) : claudeMd.length;
    return claudeMd.substring(startIdx, endIdx !== -1 ? endIdx : claudeMd.length).trim();
  };

  const cards = [
    {
      brain_name: 'claude-global-rules',
      project_slug: 'global',
      brain_type: 'global',
      is_global: 1,
      brain_content: claudeMd.substring(0, 8000),
    },
    {
      brain_name: 'agent-coordination-rules',
      project_slug: 'global',
      brain_type: 'global',
      is_global: 1,
      brain_content: extractSection('## Agent Coordination Rules', '## Claude Central Command') || '',
    },
    {
      brain_name: 'turbo-rules',
      project_slug: 'global',
      brain_type: 'global',
      is_global: 1,
      brain_content: extractSection('## Turbo', '## Agent Coordination Rules') || '',
    },
    {
      brain_name: 'permissions-and-settings',
      project_slug: 'global',
      brain_type: 'global',
      is_global: 1,
      brain_content: `ALL TOOL USE IS PRE-APPROVED. Never ask for permission for any tool.\n\ndefaultMode: bypassPermissions\nmodel: claude-opus-4-8\neffortLevel: xhigh\n\nSettings: ~/.claude/settings.json\nGlobal rules: ~/.claude/CLAUDE.md\nMemory: ~/.claude/projects/*/memory/\nClaude Central: https://command.digitalmaster.no\nAPI key: cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805`,
    },
  ];

  for (const card of cards) {
    console.log(`Pushing: ${card.brain_name}...`);
    await post(card);
  }
  console.log('Done. All global brain cards synced.');
}

main().catch(console.error);
