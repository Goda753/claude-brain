#!/usr/bin/env node
/**
 * Claude Central SessionStart hook
 * Called automatically at the start of every Claude Code session.
 * Registers with Central, fetches context, injects into Claude via stdout.
 */
'use strict';

const https  = require('https');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const API_KEY = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST = 'command.digitalmaster.no';
const MACHINE  = process.env.COMPUTERNAME === 'MAC' ? 'mac' :
                 (process.platform === 'darwin' ? 'mac' : 'windows-pc');

function apiGet(action) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'GET',
      headers: { 'X-API-Key': API_KEY },
      timeout: 8000,
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

function apiPost(action, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: `/api.php?action=${action}`,
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 8000,
      rejectUnauthorized: false,
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// Windows-safe stdin reader (avoids /dev/stdin which doesn't exist on Windows)
function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let d = '';
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => resolve(d || '{}'));
    process.stdin.on('error', () => resolve('{}'));
    setTimeout(() => resolve(d || '{}'), 3000);
  });
}

async function main() {
  // Read hook input from stdin (Windows-safe)
  let hookInput = {};
  try {
    const raw = await readStdin();
    hookInput = JSON.parse(raw);
  } catch {}

  // Generate or load session ID
  const sessFile = path.join(os.homedir(), '.claude', 'central-agent-session.json');
  let sessionId;
  try {
    const s = JSON.parse(fs.readFileSync(sessFile, 'utf8'));
    sessionId = s.session_id;
  } catch {}

  // Use session_id from hook input if provided (Claude Code passes it in SessionStart)
  const hookSessionId = hookInput?.session_id || hookInput?.sessionId;
  if (hookSessionId) sessionId = hookSessionId;

  if (!sessionId) {
    sessionId = 'claude-' + MACHINE + '-' + crypto.randomUUID();
  }

  // Detect current project from CWD
  const cwd = process.cwd();
  const projectGuess = path.basename(cwd);

  // Register with Central and get all context in parallel
  const [regResult, brains, devices, notifications, quickCmds, kpis, cmdHistory, projects, brainHealth] = await Promise.all([
    apiPost('session_start', {
      session_id: sessionId,
      machine: MACHINE,
      label: MACHINE + ' Claude',
      project: projectGuess,
      cwd: cwd,
    }),
    apiGet('brain_get'),
    apiGet('devices'),
    apiGet('notifications?unread_only=true&limit=10'),
    apiGet('quick_commands'),
    apiGet('kpis'),
    apiGet('command_history?limit=5'),
    apiGet('get_projects'),
    apiGet('brain_health'),
  ]);

  // Separate global brains from project-specific brains
  const globalBrains = Array.isArray(brains)
    ? brains.filter(b => b.is_global == 1 || b.project_slug === 'global' || b.brain_type === 'global')
    : [];
  const projectBrain = Array.isArray(brains)
    ? brains.find(b => b.project_slug === projectGuess && !b.is_global)
    : null;

  // Build context sections
  const sections = [];

  // Header line
  sections.push(`> Machine: **${MACHINE}** | Session: \`${sessionId.slice(0,16)}…\` | Project: **${projectGuess}**\n> Dashboard: https://command.digitalmaster.no`);

  // Global brain cards — injected into EVERY session on EVERY machine
  if (globalBrains.length) {
    const globalContent = globalBrains
      .filter(b => b.brain_content || b.content)
      .map(b => `### ${b.brain_name || b.project_slug}\n${(b.brain_content || b.content || '').substring(0, 3000)}`)
      .join('\n\n---\n\n');
    if (globalContent) {
      sections.push('## Claude Central Brain — Global Rules\n\n' + globalContent);
    }
  }

  // Handoff from Central (work to pick up)
  if (regResult?.handoff) {
    sections.push('## Handoff from Central — Pick This Up\n' + regResult.handoff);
  }

  // Other active sessions
  if (regResult?.others_context) {
    sections.push(regResult.others_context);
  }

  // Devices — show all machines with online status, age, session count
  if (Array.isArray(devices) && devices.length) {
    const onlineMachines = devices.filter(d => d.online);
    const machineList = devices.map(d => {
      if (d.online) {
        return `- **${d.machine}** (online, last seen ${d.age_sec}s ago, ${d.session_count || 0} sessions)`;
      } else {
        return `- ${d.machine} (offline)`;
      }
    }).join('\n');
    sections.push(`## Online Machines (${onlineMachines.length}/${devices.length})\n${machineList || 'None online'}`);
  }

  // Pending alerts (unread notifications)
  const pendingNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read_at) : [];
  if (pendingNotifs.length) {
    sections.push('## Pending Alerts (' + pendingNotifs.length + ')\n' +
      pendingNotifs.slice(0, 5).map(n => `- [${n.type || 'alert'}] ${n.title || n.message}: ${(n.body || n.message || '').substring(0, 80)}`).join('\n'));
  }

  // Brain health check — warn if stagnant or slow
  if (brainHealth && brainHealth.status !== 'healthy') {
    sections.push(`## Brain Health: ${brainHealth.status.toUpperCase()}\n` +
      (brainHealth.warnings || []).map(w => `- ${w}`).join('\n') +
      `\nLearnings this week: ${brainHealth.weekly_growth} | Total: ${brainHealth.total_learnings}`
    );
  }

  // Quick command presets
  if (Array.isArray(quickCmds) && quickCmds.length) {
    sections.push('## Quick Command Presets\n' + quickCmds.slice(0, 8).map(c => `- **${c.name}**: ${c.cmd_type} → \`${(c.command || '').substring(0, 60)}\``).join('\n'));
  }

  // All projects cheatsheet
  if (Array.isArray(projects) && projects.length) {
    const projectLines = projects.map(p => {
      const parts = [`${p.icon || '📁'} **${p.name}** (\`${p.slug}\`): ${p.description ? p.description.substring(0,80)+'…' : ''}`];
      if (p.local_path) parts.push(`  Local: ${p.local_path}`);
      if (p.server_host) parts.push(`  Server: ${p.server_user}@${p.server_host}:${p.server_path}`);
      return parts.join('\n');
    }).join('\n\n');
    sections.push('## Projects — Switch with: `node ~/.claude/switch-project.js <slug>`\n\n' + projectLines);
  }

  // Active project (set by switch-project.js)
  const activeProjectPath = path.join(os.homedir(), '.claude', 'active-project.json');
  try {
    const activeProject = JSON.parse(fs.readFileSync(activeProjectPath, 'utf8'));
    if (activeProject?.slug) {
      sections.push(`## Active Project: ${activeProject.icon||'📁'} ${activeProject.name}\n` +
        `Slug: \`${activeProject.slug}\`\n` +
        (activeProject.local_path ? `Local: ${activeProject.local_path}\n` : '') +
        (activeProject.server_host ? `SSH: ssh -i ${activeProject.ssh_key} ${activeProject.server_user}@${activeProject.server_host}\n` : '') +
        (activeProject.extra_context ? `Context: ${activeProject.extra_context.substring(0,500)}` : '')
      );
    }
  } catch {}

  // Current KPI metrics
  if (Array.isArray(kpis) && kpis.length) {
    const kpiLine = kpis.map(k => `${k.label || k.metric_key}: ${k.value}`).join(' | ');
    sections.push('## Current Metrics\n' + kpiLine);
  }

  // Recent command history
  if (Array.isArray(cmdHistory) && cmdHistory.length) {
    sections.push('## Recent Commands (last 5)\n' +
      cmdHistory.slice(0, 5).map(c => {
        const out = (c.output || '').substring(0, 60).replace(/\n/g, ' ');
        return `- \`${(c.command || c.cmd || '').substring(0, 60)}\` → ${out || '(no output)'}`;
      }).join('\n'));
  }

  // Project brain (most relevant context for current project)
  if (projectBrain?.brain_content || projectBrain?.content) {
    const content = (projectBrain.brain_content || projectBrain.content || '').substring(0, 4000);
    sections.push('## Project Brain: ' + (projectBrain.project_slug || 'general') + '\n' + content);
  } else if (!globalBrains.length && Array.isArray(brains) && brains.length) {
    // Fallback: if no global brains and no matching project brain, show brains[0]
    const brain = brains[0];
    const content = (brain.brain_content || brain.content || '').substring(0, 4000);
    if (content) {
      sections.push('## Project Brain: ' + (brain.project_slug || 'general') + '\n' + content);
    }
  }

  // Main CLAUDE.md content from Central
  if (regResult?.claude_md) {
    sections.push(regResult.claude_md.substring(0, 3000));
  }

  // Wrap everything in a clear header/footer
  const fullContext = [
    '---',
    '## Claude Central Context (auto-injected at session start)',
    ...sections,
    `_Injected at ${new Date().toISOString()}_`,
    '---',
  ].join('\n\n');

  // Output the hook response — inject context into Claude
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: fullContext,
    }
  });

  process.stdout.write(output);
}

main().catch(() => {
  // Silent failure — never block Claude from starting
  process.stdout.write('{}');
});
