#!/usr/bin/env node
/**
 * switch-project.js — Switch active project within one Claude chat
 *
 * Usage (Claude calls this via Bash):
 *   node ~/.claude/switch-project.js semeny
 *   node ~/.claude/switch-project.js digitalmaster
 *   node ~/.claude/switch-project.js central
 *   node ~/.claude/switch-project.js list
 *
 * Returns: project context as text that Claude reads
 */
'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST = 'command.digitalmaster.no';
const STATE_FILE = path.join(os.homedir(), '.claude', 'active-project.json');
const SESSION_FILE = path.join(os.homedir(), '.claude', 'central-agent-session.json');

function apiGet(action) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: API_HOST, path: `/api.php?action=${action}`,
      method: 'GET', headers: { 'X-API-Key': API_KEY }, timeout: 10000, rejectUnauthorized: false,
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} });
    });
    req.on('error',()=>resolve(null));
    req.on('timeout',()=>{ req.destroy(); resolve(null); });
    req.end();
  });
}

function apiPost(action, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST, path: `/api.php?action=${action}`,
      method: 'POST',
      headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000, rejectUnauthorized: false,
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} });
    });
    req.on('error',()=>resolve(null));
    req.on('timeout',()=>{ req.destroy(); resolve(null); });
    req.write(payload); req.end();
  });
}

function getSessionId() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE,'utf8')).session_id; } catch { return null; }
}

function getBrainContent(slug) {
  return apiGet(`brain_get&project_slug=${slug}`).then(brains => {
    if (!Array.isArray(brains)) return '';
    const card = brains.find(b => b.project_slug === slug && !b.is_global);
    return card ? (card.brain_content || '') : '';
  });
}

async function main() {
  const arg = (process.argv[2] || 'list').toLowerCase().trim();

  // List all projects
  if (arg === 'list' || arg === '--list') {
    const projects = await apiGet('get_projects');
    if (!Array.isArray(projects)) { console.log('Could not fetch projects'); return; }
    console.log('\n📋 Available projects:\n');
    projects.forEach(p => {
      const current = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')).slug; } catch { return null; } })();
      const marker = current === p.slug ? ' ◀ ACTIVE' : '';
      console.log(`  ${p.icon} ${p.name} (${p.slug})${marker}`);
      console.log(`     📁 ${p.local_path || 'N/A'}`);
      if (p.server_host) console.log(`     🌐 ${p.server_user}@${p.server_host}:${p.server_path}`);
      console.log(`     🏷️  aliases: ${p.aliases || 'none'}`);
      console.log();
    });
    return;
  }

  // Resolve and switch to a project
  const r = await apiPost('set_active_project', {
    project_slug: arg,
    session_id: getSessionId() || 'unknown',
  });

  if (!r?.ok) {
    console.log(`❌ Project '${arg}' not found.`);
    console.log('Run: node ~/.claude/switch-project.js list');
    return;
  }

  const project = r.project;

  // Save active project state
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    slug: project.slug,
    name: project.name,
    icon: project.icon,
    local_path: project.local_path,
    server_host: project.server_host,
    server_user: project.server_user,
    server_path: project.server_path,
    ssh_key: project.ssh_key,
    php_binary: project.php_binary,
    db_name: project.db_name,
    db_user: project.db_user,
    extra_context: project.extra_context,
    switched_at: new Date().toISOString(),
  }, null, 2));

  // Get project brain card
  const brainContent = await getBrainContent(project.slug);

  // Output context for Claude to read
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${project.icon} SWITCHED TO: ${project.name.toUpperCase()}`);
  console.log('═'.repeat(60));
  console.log(`\n📁 Local path:   ${project.local_path || 'N/A'}`);
  if (project.server_host) {
    console.log(`🌐 Server:       ${project.server_user}@${project.server_host}`);
    console.log(`📂 Server path:  ${project.server_path}`);
    console.log(`🔑 SSH key:      ${project.ssh_key}`);
    console.log(`🔌 SSH command:  ssh -i ${project.ssh_key} ${project.server_user}@${project.server_host}`);
    if (project.php_binary) console.log(`🐘 PHP:          ${project.php_binary}`);
  }
  if (project.extra_context) {
    console.log(`\n📋 Context:\n${project.extra_context}`);
  }
  if (project.description) {
    console.log(`\n📖 ${project.description}`);
  }
  if (brainContent) {
    console.log(`\n🧠 Brain:\n${brainContent.substring(0, 2000)}`);
  }
  console.log(`\n${'═'.repeat(60)}`);
  console.log('All logs and learnings will now be tagged to this project.');
  console.log('To switch back: node ~/.claude/switch-project.js list');
  console.log('═'.repeat(60) + '\n');
}

main().catch(e => console.error('Error:', e.message));
