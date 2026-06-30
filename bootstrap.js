#!/usr/bin/env node
/**
 * bootstrap.js — Zero-touch Claude Central setup
 * Claude runs this automatically on new machines when CLAUDE.md is read.
 * Usage: node ~/.claude/bootstrap.js
 *    or: node bootstrap.js (from the claude-brain repo directory)
 */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const https = require('https');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const IS_MAC     = process.platform === 'darwin';
const IS_WIN     = process.platform === 'win32';
const API_KEY    = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST   = 'command.digitalmaster.no';

function run(cmd, opts = {}) {
  try {
    const result = spawnSync(cmd, { shell: true, encoding: 'utf8', ...opts });
    return { ok: result.status === 0, out: result.stdout || '', err: result.stderr || '' };
  } catch(e) { return { ok: false, out: '', err: e.message }; }
}

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

async function download(url, dest) {
  return new Promise(resolve => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'X-API-Key': API_KEY }, rejectUnauthorized: false }, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(true); });
    }).on('error', () => resolve(false));
  });
}

async function apiGet(action) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: API_HOST, path: `/api.php?action=${action}`,
      method: 'GET', headers: { 'X-API-Key': API_KEY }, timeout: 10000, rejectUnauthorized: false,
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function main() {
  console.log('\n🚀 Claude Central Bootstrap\n');
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });

  // ─── 1. Download hook scripts from Central ───────────────────────────────
  console.log('📥 Downloading hook scripts from Claude Central...');
  const hooks = ['session-start.js','session-end.js','session-update.js','log-prompt.js','log-response.js','sync-brain.js','auto-check.js'];
  for (const hook of hooks) {
    const dest = path.join(CLAUDE_DIR, hook);
    const url  = `https://${API_HOST}/api.php?action=get_hook_file&name=${hook}`;
    const ok   = await download(url, dest);
    console.log(ok ? `  ✅ ${hook}` : `  ⚠️  ${hook} (will try from local copy)`);
  }

  // ─── 2. Write settings.json ───────────────────────────────────────────────
  console.log('\n⚙️  Writing settings.json...');
  const claudeDir = CLAUDE_DIR.replace(/\\/g, '\\\\');
  const settings = {
    permissions: { defaultMode: 'bypassPermissions' },
    model: 'claude-opus-4-8',
    effortLevel: 'xhigh',
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR,'session-start.js')}"`, timeout: 15 }] }],
      PostCompact:  [{ hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR,'session-update.js')}"`, timeout: 10 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR,'log-prompt.js')}"`, timeout: 8 }] }],
      Stop: [
        { hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR,'log-response.js')}"`, timeout: 10, async: true }] },
        { hooks: [{ type: 'command', command: `node "${path.join(CLAUDE_DIR,'session-end.js')}"`, timeout: 10 }] },
      ],
    },
  };

  // Add MCP servers with platform-correct paths
  const npmRoot = run('npm root -g').out.trim();
  if (npmRoot) {
    settings.mcpServers = {
      memory:               { command: 'node', args: [path.join(npmRoot,'@modelcontextprotocol/server-memory/dist/index.js')] },
      'sequential-thinking':{ command: 'node', args: [path.join(npmRoot,'@modelcontextprotocol/server-sequential-thinking/dist/index.js')] },
      filesystem:           { command: 'node', args: [path.join(npmRoot,'@modelcontextprotocol/server-filesystem/dist/index.js'), os.homedir()] },
      fetch:                { command: 'node', args: [path.join(npmRoot,'mcp-server-fetch/index.js')] },
      playwright:           { command: 'node', args: [path.join(npmRoot,'@playwright/mcp/cli.js')] },
    };
  }

  fs.writeFileSync(path.join(CLAUDE_DIR, 'settings.json'), JSON.stringify(settings, null, 2));
  console.log('  ✅ settings.json written');

  // ─── 3. Install MCP npm packages ─────────────────────────────────────────
  console.log('\n📦 Installing MCP servers...');
  const pkgs = ['@modelcontextprotocol/server-memory','@modelcontextprotocol/server-sequential-thinking','@modelcontextprotocol/server-filesystem','mcp-server-fetch','@playwright/mcp'];
  for (const pkg of pkgs) {
    const check = run(`npm list -g ${pkg} --depth=0`);
    if (check.ok) { console.log(`  ✅ ${pkg} (already installed)`); continue; }
    console.log(`  ↓ Installing ${pkg}...`);
    const r = run(`npm install -g ${pkg}`);
    console.log(r.ok ? `  ✅ ${pkg}` : `  ❌ ${pkg}: ${r.err.split('\n')[0]}`);
  }

  // ─── 4. Install VS Code extensions ───────────────────────────────────────
  console.log('\n🧩 Installing VS Code extensions...');
  const codeCmd = IS_WIN ? 'code.cmd' : 'code';
  const codeCheck = run(`${codeCmd} --version`);
  if (!codeCheck.ok) {
    console.log('  ⚠️  VS Code CLI not found — install VS Code and add to PATH, then re-run');
  } else {
    const extFile = path.join(CLAUDE_DIR, 'vscode-extensions.txt');
    const localExtFile = path.join(__dirname, 'vscode-extensions.txt');
    const extListFile  = exists(extFile) ? extFile : exists(localExtFile) ? localExtFile : null;
    if (extListFile) {
      const exts = fs.readFileSync(extListFile,'utf8').split('\n').map(e=>e.trim()).filter(Boolean);
      const installed = run(`${codeCmd} --list-extensions`).out.toLowerCase().split('\n');
      for (const ext of exts) {
        if (installed.includes(ext.toLowerCase())) { console.log(`  ✅ ${ext}`); continue; }
        const r = run(`${codeCmd} --install-extension ${ext} --force`);
        console.log(r.ok ? `  ✅ ${ext}` : `  ⚠️  ${ext}`);
      }
    } else {
      console.log('  ⚠️  vscode-extensions.txt not found');
    }
  }

  // ─── 5. Pull brain from Central ──────────────────────────────────────────
  console.log('\n🧠 Syncing brain from Claude Central...');
  const syncJs = path.join(CLAUDE_DIR, 'sync-brain.js');
  if (exists(syncJs)) {
    const r = run(`node "${syncJs}" --pull`);
    console.log(r.ok ? '  ✅ Brain synced' : `  ⚠️  Brain sync: ${r.err.split('\n')[0]}`);
  }

  // ─── 6. Register this machine with Central ───────────────────────────────
  console.log('\n📡 Registering with Claude Central...');
  const machine = IS_MAC ? 'mac' : IS_WIN ? 'windows-pc' : os.hostname();
  const reg = await apiGet(`session_start&machine=${machine}&label=${machine}+Bootstrap&project=setup`);
  console.log(reg ? '  ✅ Registered' : '  ⚠️  Could not reach Central (offline?)');

  console.log('\n✅ Bootstrap complete!\n');
  console.log('Next step: Restart VS Code / Claude Code');
  console.log('Dashboard: https://command.digitalmaster.no (ClaudeCommand2026)\n');
}

main().catch(e => { console.error('Bootstrap error:', e.message); process.exit(1); });
