#!/usr/bin/env node
/**
 * Claude Central SessionStart hook
 * Called automatically at the start of every Claude Code session.
 * Registers with Central, fetches context, injects into Claude via stdout.
 *
 * Features:
 * - Stream-based stdin (Windows-safe, no /dev/stdin)
 * - Global brain injection (is_global=1, project_slug='global', brain_type='global')
 * - Project context brain cards (projectSlug-context and projectSlug-sessions)
 * - Recent chat sessions summary (last 3 sessions for this machine)
 * - All fetches run in parallel via Promise.all
 * - Silent failure on any error — never blocks Claude from starting
 */
'use strict';

const https  = require('https');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
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

// Windows-safe stream-based stdin reader (avoids /dev/stdin which doesn't exist on Windows)
function readStdin() {
  return new Promise(resolve => {
    if (process.stdin.isTTY) { resolve('{}'); return; }
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => d += c);
    process.stdin.on('end', () => resolve(d || '{}'));
    process.stdin.on('error', () => resolve('{}'));
    // Safety timeout — resolve after 3s even if stream never ends
    setTimeout(() => resolve(d || '{}'), 3000);
  });
}

async function main() {
  // Read hook input from stdin (stream-based, Windows-safe)
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
  const projectSlug = path.basename(cwd);

  // Register with Central and fetch ALL context in parallel
  const [
    regResult,
    brains,
    devices,
    notifications,
    quickCmds,
    kpis,
    cmdHistory,
    recentSessions,
  ] = await Promise.all([
    apiPost('session_start', {
      session_id: sessionId,
      machine: MACHINE,
      label: MACHINE + ' Claude',
      project: projectSlug,
      cwd: cwd,
    }),
    apiGet('brain_get'),
    apiGet('devices'),
    apiGet('notifications?unread_only=true&limit=10'),
    apiGet('quick_commands'),
    apiGet('kpis'),
    apiGet('command_history?limit=5'),
    apiGet(`chat_sessions&limit=3&machine=${MACHINE}`),
  ]);

  // --- Brain categorisation ---

  // Global brains: injected on every machine in every session
  const globalBrains = Array.isArray(brains) ? brains.filter(b =>
    b.is_global == 1 || b.project_slug === 'global' || b.brain_type === 'global'
  ) : [];

  // Project brain (general, not context/sessions)
  const projectBrain = Array.isArray(brains) ? brains.find(b =>
    b.project_slug === projectSlug && !b.is_global && b.brain_type !== 'context' && b.brain_type !== 'sessions'
  ) : null;

  // Project context cards: type 'context' or 'sessions' for this project
  const projectContextCards = Array.isArray(brains) ? brains.filter(b =>
    b.project_slug === projectSlug &&
    (b.brain_type === 'context' || b.brain_type === 'sessions')
  ) : [];

  // ---- Build context sections in priority order ----
  const sections = [];

  // 1. Header (machine / session / project / dashboard link)
  sections.push(
    `> Machine: **${MACHINE}** | Session: \`${sessionId.slice(0, 16)}…\` | Project: **${projectSlug}**\n` +
    `> Dashboard: https://command.digitalmaster.no`
  );

  // 2. Handoff from Central (work to pick up — high priority)
  if (regResult?.handoff) {
    sections.push('## Handoff from Central — Pick This Up\n' + regResult.handoff);
  }

  // 3. Global brain cards (rules, turbo, coordination — most important, every session)
  if (globalBrains.length) {
    const globalContent = globalBrains
      .filter(b => b.brain_content || b.content)
      .map(b =>
        `### ${b.brain_name || b.project_slug}\n` +
        `${(b.brain_content || b.content || '').substring(0, 3000)}`
      )
      .join('\n\n---\n\n');
    if (globalContent) {
      sections.push('## Claude Central Brain — Global Rules\n\n' + globalContent);
    }
  }

  // 4. Project context cards (what was done in this project recently)
  if (projectContextCards.length) {
    projectContextCards.forEach(card => {
      if (card.brain_content || card.content) {
        sections.push(
          `## ${card.brain_name || 'Project Context'}\n` +
          `${(card.brain_content || card.content || '').substring(0, 2000)}`
        );
      }
    });
  }

  // 5. Recent chat sessions (last 3 for this machine, excluding current session)
  if (Array.isArray(recentSessions) && recentSessions.length) {
    const recentWork = recentSessions
      .filter(s => s.session_id !== sessionId)
      .slice(0, 3)
      .map(s => {
        const when = s.last_activity
          ? new Date(s.last_activity).toLocaleDateString('no-NO')
          : '?';
        const label = s.window_label || s.session_id.slice(-8);
        const msgs  = s.message_count || 0;
        const preview = (s.first_prompt_preview || '').substring(0, 100);
        return `- **${label}** (${when}, ${msgs} msgs): ${preview}`;
      })
      .join('\n');
    if (recentWork) {
      sections.push('## Recent Chat Sessions\n' + recentWork);
    }
  }

  // 6. Other active sessions (from regResult)
  if (regResult?.others_context) {
    sections.push(regResult.others_context);
  }

  // 7. Online machines
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

  // 8. Pending alerts (unread notifications)
  const pendingNotifs = Array.isArray(notifications) ? notifications.filter(n => !n.read_at) : [];
  if (pendingNotifs.length) {
    sections.push(
      '## Pending Alerts (' + pendingNotifs.length + ')\n' +
      pendingNotifs.slice(0, 5).map(n =>
        `- [${n.type || 'alert'}] ${n.title || n.message}: ${(n.body || n.message || '').substring(0, 80)}`
      ).join('\n')
    );
  }

  // 9. Quick command presets
  if (Array.isArray(quickCmds) && quickCmds.length) {
    sections.push(
      '## Quick Command Presets\n' +
      quickCmds.slice(0, 8).map(c =>
        `- **${c.name}**: ${c.cmd_type} → \`${(c.command || '').substring(0, 60)}\``
      ).join('\n')
    );
  }

  // 10. Current KPI metrics
  if (Array.isArray(kpis) && kpis.length) {
    const kpiLine = kpis.map(k => `${k.label || k.metric_key}: ${k.value}`).join(' | ');
    sections.push('## Current Metrics\n' + kpiLine);
  }

  // 11. Recent command history
  if (Array.isArray(cmdHistory) && cmdHistory.length) {
    sections.push(
      '## Recent Commands (last 5)\n' +
      cmdHistory.slice(0, 5).map(c => {
        const out = (c.output || '').substring(0, 60).replace(/\n/g, ' ');
        return `- \`${(c.command || c.cmd || '').substring(0, 60)}\` → ${out || '(no output)'}`;
      }).join('\n')
    );
  }

  // 12. Project brain (general — not context/sessions)
  if (projectBrain?.brain_content || projectBrain?.content) {
    const content = (projectBrain.brain_content || projectBrain.content || '').substring(0, 4000);
    sections.push('## Project Brain: ' + (projectBrain.project_slug || 'general') + '\n' + content);
  } else if (!globalBrains.length && !projectContextCards.length && Array.isArray(brains) && brains.length) {
    // Fallback: if no global brains and no project cards, show brains[0]
    const brain = brains[0];
    const content = (brain.brain_content || brain.content || '').substring(0, 4000);
    if (content) {
      sections.push('## Project Brain: ' + (brain.project_slug || 'general') + '\n' + content);
    }
  }

  // 13. Main CLAUDE.md content from Central (if any)
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
