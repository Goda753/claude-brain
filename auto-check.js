#!/usr/bin/env node
/**
 * auto-check.js — verify Claude Central integration is fully configured
 * Run: node ~/.claude/auto-check.js
 */
'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const API_KEY    = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST   = 'command.digitalmaster.no';

function check(label, condition, fix) {
  const ok = typeof condition === 'function' ? (() => { try { return condition(); } catch { return false; } })() : condition;
  console.log(ok ? `  ✅ ${label}` : `  ❌ ${label}${fix ? '\n     Fix: ' + fix : ''}`);
  return ok;
}

async function apiGet(action) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: API_HOST, path: `/api.php?action=${action}`,
      method: 'GET', headers: {'X-API-Key': API_KEY}, timeout: 8000, rejectUnauthorized: false,
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} }); });
    req.on('error', ()=>resolve(null));
    req.on('timeout', ()=>{ req.destroy(); resolve(null); });
    req.end();
  });
}

async function main() {
  console.log('\n🧠 Claude Brain — Integration Check\n');

  console.log('📁 Local Files:');
  const hooks = ['session-start.js','session-end.js','session-update.js','log-prompt.js','log-response.js','sync-brain.js'];
  hooks.forEach(f => check(f, () => fs.existsSync(path.join(CLAUDE_DIR, f)), `Download from Claude Central or run setup-mac.sh / setup-windows.ps1`));
  check('CLAUDE.md', () => fs.existsSync(path.join(CLAUDE_DIR, 'CLAUDE.md')), 'git clone the claude-brain repo');

  console.log('\n⚙️  Settings:');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, 'settings.json'), 'utf8'));
    check('bypassPermissions', settings.permissions?.defaultMode === 'bypassPermissions', 'Set "defaultMode": "bypassPermissions" in settings.json');
    check('SessionStart hook', !!settings.hooks?.SessionStart, 'Add SessionStart hook in settings.json');
    check('Stop hook (log-response)', settings.hooks?.Stop?.some(h => h.hooks?.some(x => x.command?.includes('log-response'))), 'Add log-response.js to Stop hooks');
    check('UserPromptSubmit hook', !!settings.hooks?.UserPromptSubmit, 'Add UserPromptSubmit hook in settings.json');
    check('model: claude-opus-4-8', settings.model === 'claude-opus-4-8', 'Set "model": "claude-opus-4-8"');
  } catch(e) {
    console.log('  ❌ settings.json missing or invalid');
  }

  console.log('\n🌐 Claude Central API:');
  const health = await apiGet('health');
  check('API reachable', health && health.ok !== false, 'Check network / https://command.digitalmaster.no');

  const brains = await apiGet('brain_get&is_global=1');
  const globalCount = Array.isArray(brains) ? brains.length : 0;
  check(`Global brain cards (${globalCount})`, globalCount >= 4, 'Run: node ~/.claude/sync-brain.js');

  const sessions = await apiGet('sessions');
  check('Sessions endpoint', Array.isArray(sessions), 'Check api.php on server');

  const chatSessions = await apiGet('chat_sessions&limit=1');
  check('Chat logging working', Array.isArray(chatSessions), 'Check chat_logs table in DB');

  console.log('\n📋 Summary:');
  console.log('Dashboard: https://command.digitalmaster.no (ClaudeCommand2026)');
  console.log('Sync rules: node ~/.claude/sync-brain.js');
  console.log('Setup new Mac: bash ~/.claude/setup-mac.sh');
  console.log('Setup Windows: .\\setup-windows.ps1\n');
}

main().catch(console.error);
