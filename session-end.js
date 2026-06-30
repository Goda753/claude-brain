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

async function saveSessionSummary(sessionId, hookInput) {
  await apiPost('session_end', {
    session_id: sessionId,
    machine: MACHINE,
    summary: (hookInput.summary || 'Session ended').substring(0, 500),
  });
}

async function extractLearnings(sessionId, cwd, machine) {
  try {
    // Get all messages from this session
    const history = await apiGet(`chat_history&session_id=${encodeURIComponent(sessionId)}&limit=50`);
    if (!Array.isArray(history) || history.length < 4) return; // too short to learn from

    const projectSlug = path.basename((cwd || '').replace(/\\/g, '/')).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'global';

    // Extract signals from the conversation
    const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
    const assistantMessages = history.filter(m => m.role === 'assistant').map(m => m.content);

    const allUserText = userMessages.join('\n').toLowerCase();
    const allAssistantText = assistantMessages.join('\n');

    // Detect learning signals
    const learnings = [];

    // Positive feedback signals → what worked
    const positivePatterns = ['perfect', 'exactly', 'great', 'works', 'thank', 'yes that', 'good job', 'well done', 'nice', 'amazing'];
    const hadPositiveFeedback = positivePatterns.some(p => allUserText.includes(p));

    // Negative feedback → what to avoid
    const negativePatterns = ['no,', 'wrong', 'not what', 'fix it', "that's not", 'incorrect', 'mistake', "don't do that", 'stop doing'];
    const hadCorrections = negativePatterns.some(p => allUserText.includes(p));

    // Detect turbo usage
    const turboMatch = allUserText.match(/(\d+)x turbo/);
    if (turboMatch) {
      learnings.push({
        learning_type: 'technique',
        title: `${turboMatch[1]}x turbo used in ${projectSlug}`,
        content: `Session used ${turboMatch[1]}x turbo (${turboMatch[1]} parallel agents). Project: ${cwd}. Check if the split was effective based on outcome.`,
        quality: hadPositiveFeedback ? 4 : 3,
      });
    }

    // Detect agent coordination patterns
    if (allAssistantText.includes('scratchpad') && allAssistantText.includes('assembler')) {
      learnings.push({
        learning_type: 'pattern',
        title: 'Scratchpad + assembler pattern used',
        content: `Successfully used scratchpad files + assembler agent pattern in project: ${cwd}. Each agent wrote to scratchpad/agent-N-file, assembler merged.`,
        quality: 4,
      });
    }

    // Extract tool discoveries from long assistant responses
    const longResponses = assistantMessages.filter(m => m.length > 2000);
    if (longResponses.length > 0 && hadPositiveFeedback) {
      // A long response that got positive feedback = valuable technique
      const snippet = longResponses[0].substring(0, 500);
      learnings.push({
        learning_type: 'insight',
        title: `Effective approach in ${projectSlug} (${new Date().toISOString().split('T')[0]})`,
        content: `Session with positive feedback. Key approach preview:\n${snippet}\n\nProject: ${cwd}\nSession: ${sessionId}`,
        quality: 4,
      });
    }

    // If corrections happened, note the pattern
    if (hadCorrections) {
      const correctionContext = userMessages
        .filter(m => negativePatterns.some(p => m.toLowerCase().includes(p)))
        .slice(0, 2)
        .map(m => m.substring(0, 150))
        .join(' | ');
      if (correctionContext) {
        learnings.push({
          learning_type: 'pitfall',
          title: `Correction needed in ${projectSlug}`,
          content: `User needed to correct Claude during this session. Context: ${correctionContext}\n\nProject: ${cwd} — Review and refine approach.`,
          quality: 2,
        });
      }
    }

    // Always save a session insight for substantial sessions (>10 messages)
    if (history.length >= 10) {
      const topics = userMessages.slice(-5).map(m => m.substring(0, 80)).join(' | ');
      learnings.push({
        learning_type: 'project',
        title: `Work done: ${projectSlug} (${new Date().toISOString().split('T')[0]})`,
        content: `${history.length} messages. Last topics: ${topics}\n\nProject path: ${cwd}\nSession: ${sessionId}`,
        quality: 3,
      });
    }

    // Save all extracted learnings
    for (const learning of learnings) {
      await apiPost('add_learning', {
        session_id: sessionId,
        project_slug: projectSlug,
        machine: machine,
        source: 'session_end',
        ...learning,
      });
    }

    // Trigger brain evolution if we have learnings
    if (learnings.length > 0) {
      await apiPost('brain_evolve', { project_slug: projectSlug });
    }

  } catch(e) { /* silent */ }
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

  const cwd = process.cwd();

  await saveSessionSummary(sessionId, hookInput);
  await extractLearnings(sessionId, cwd, MACHINE);

  process.stdout.write('{}');
}

main().catch(() => process.stdout.write('{}'));
