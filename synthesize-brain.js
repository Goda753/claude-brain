#!/usr/bin/env node
/**
 * synthesize-brain.js — Evolve the Claude brain from accumulated session learnings
 *
 * Run manually:      node ~/.claude/synthesize-brain.js
 * Run with days:     node ~/.claude/synthesize-brain.js --days=30
 * Run for project:   node ~/.claude/synthesize-brain.js --project=semeny2
 *
 * How it works:
 * 1. Fetches all learnings from the last N days (default: 7)
 * 2. Groups insights by type (technique, pattern, pitfall, tool, project)
 * 3. Identifies high-value repeated patterns
 * 4. Synthesizes them into evolved brain card content
 * 5. Updates global brain cards and project-specific cards
 * 6. Logs the evolution to console
 */
'use strict';
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

const API_KEY  = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST = 'command.digitalmaster.no';
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

// Parse CLI args
const args = process.argv.slice(2);
const days    = parseInt((args.find(a=>a.startsWith('--days='))   || '--days=7').split('=')[1]);
const project = (args.find(a=>a.startsWith('--project=')) || '').split('=')[1] || null;
const dryRun  = args.includes('--dry-run');

function apiGet(action) {
  return new Promise(resolve => {
    const req = https.request({
      hostname: API_HOST, path: `/api.php?action=${action}`,
      method: 'GET', headers: { 'X-API-Key': API_KEY }, timeout: 15000, rejectUnauthorized: false,
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
      timeout: 15000, rejectUnauthorized: false,
    }, res => {
      let d=''; res.on('data',c=>d+=c);
      res.on('end',()=>{ try{resolve(JSON.parse(d))}catch{resolve(null)} });
    });
    req.on('error',()=>resolve(null));
    req.on('timeout',()=>{ req.destroy(); resolve(null); });
    req.write(payload); req.end();
  });
}

function sinceDate(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function extractKeyTerms(content) {
  // Find frequently mentioned terms (simple frequency analysis)
  const words = content.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const freq = {};
  const stopwords = new Set(['that','this','with','from','have','been','will','when','what','they','then','also','more','each','into','over','some','just','were','used','make','like','very','would','should','which','their','there','about','where','could','after','before','other','these','those','being','using','doing','your','our']);
  words.filter(w => !stopwords.has(w)).forEach(w => freq[w] = (freq[w]||0)+1);
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([w])=>w);
}

async function main() {
  console.log(`\n🧠 Brain Synthesis — last ${days} days${project ? ` (${project})` : ''}\n`);

  // Fetch learnings
  const since = sinceDate(days);
  const qsProject = project ? `&project_slug=${project}` : '';
  const learnings = await apiGet(`get_learnings&limit=500&since=${since}${qsProject}`);

  if (!Array.isArray(learnings) || !learnings.length) {
    console.log('No learnings found for this period.');
    return;
  }
  console.log(`Found ${learnings.length} learnings from ${since} onward\n`);

  // Fetch brain stats
  const stats = await apiGet('brain_stats');
  if (stats) {
    console.log(`Brain total: ${stats.summary?.total_learnings || 0} learnings across ${stats.summary?.contributing_sessions || 0} sessions`);
  }

  // Group by type
  const byType = {};
  learnings.forEach(l => {
    const t = l.learning_type || 'insight';
    if (!byType[t]) byType[t] = [];
    byType[t].push(l);
  });

  // Group by project
  const byProject = {};
  learnings.forEach(l => {
    const p = l.project_slug || 'global';
    if (!byProject[p]) byProject[p] = [];
    byProject[p].push(l);
  });

  console.log('\n📊 Learning breakdown:');
  Object.entries(byType).forEach(([t,items]) => console.log(`  ${t}: ${items.length}`));

  // ── Synthesize global technique brain card ────────────────────────────────
  const techniques = [...(byType['technique']||[]), ...(byType['pattern']||[])].sort((a,b) => b.quality - a.quality);
  if (techniques.length) {
    console.log(`\n💡 Synthesizing ${techniques.length} techniques + patterns...`);
    const topTechniques = techniques.slice(0, 20);
    const techniqueContent = [
      `# Techniques & Patterns Library`,
      `*Synthesized from ${techniques.length} learnings on ${new Date().toISOString().split('T')[0]}*`,
      '',
      ...topTechniques.map(t => `## ${t.title || 'Untitled'} [quality: ${t.quality}/5]\n${t.content.substring(0, 600)}`),
    ].join('\n\n');

    const keyTerms = extractKeyTerms(topTechniques.map(t=>t.content).join(' '));
    console.log(`  Key themes: ${keyTerms.slice(0,5).join(', ')}`);

    if (!dryRun) {
      await apiPost('brain_update', {
        brain_name: 'techniques-library',
        project_slug: 'global',
        brain_type: 'global',
        is_global: 1,
        brain_content: techniqueContent,
      });
      console.log('  ✅ techniques-library brain card updated');
    }
  }

  // ── Synthesize pitfalls card ──────────────────────────────────────────────
  const pitfalls = byType['pitfall'] || [];
  if (pitfalls.length) {
    console.log(`\n⚠️  Synthesizing ${pitfalls.length} pitfalls...`);
    const pitfallContent = [
      `# Pitfalls to Avoid`,
      `*${pitfalls.length} recorded issues — avoid repeating these*`,
      '',
      ...pitfalls.slice(0,15).map(p => `## ${p.title || 'Issue'}\n${p.content.substring(0,400)}`),
    ].join('\n\n');

    if (!dryRun) {
      await apiPost('brain_update', {
        brain_name: 'pitfalls-catalog',
        project_slug: 'global',
        brain_type: 'global',
        is_global: 1,
        brain_content: pitfallContent,
      });
      console.log('  ✅ pitfalls-catalog brain card updated');
    }
  }

  // ── Synthesize per-project brain cards ───────────────────────────────────
  for (const [slug, items] of Object.entries(byProject)) {
    if (slug === 'global' || !items.length) continue;
    console.log(`\n📁 Synthesizing project: ${slug} (${items.length} learnings)...`);

    const projectContent = [
      `# Project Brain: ${slug}`,
      `*${items.length} learnings — last updated ${new Date().toISOString().split('T')[0]}*`,
      '',
      `## Recent Work`,
      items.filter(i=>i.learning_type==='project').slice(0,5).map(i=>`- ${i.title}: ${i.content.substring(0,100)}`).join('\n') || '(none)',
      '',
      `## What Works Here`,
      items.filter(i=>['technique','pattern'].includes(i.learning_type)).slice(0,5).map(i=>`- ${i.title}`).join('\n') || '(none)',
      '',
      `## Watch Out For`,
      items.filter(i=>i.learning_type==='pitfall').slice(0,5).map(i=>`- ${i.title}: ${i.content.substring(0,80)}`).join('\n') || '(none)',
    ].join('\n\n');

    if (!dryRun) {
      await apiPost('brain_update', {
        brain_name: `${slug}-evolved`,
        project_slug: slug,
        brain_type: 'project',
        is_global: 0,
        brain_content: projectContent.substring(0, 8000),
      });
      console.log(`  ✅ ${slug}-evolved brain card updated`);
    }
  }

  // ── Update CLAUDE.md with evolved techniques (if significant new content) ──
  if (techniques.length >= 3 && !dryRun) {
    console.log('\n📝 Updating CLAUDE.md with evolved techniques...');
    const claudeMdPath = path.join(CLAUDE_DIR, 'CLAUDE.md');
    try {
      let claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
      const marker = '## Evolved Techniques (auto-updated by synthesize-brain.js)';
      const newSection = [
        marker,
        `*Last synthesis: ${new Date().toISOString().split('T')[0]} | ${techniques.length} techniques accumulated*`,
        '',
        ...techniques.slice(0,5).map(t => `- **${t.title}**: ${t.content.substring(0,120)}`),
        '',
      ].join('\n');

      if (claudeMd.includes(marker)) {
        claudeMd = claudeMd.replace(/## Evolved Techniques[\s\S]*?(?=\n## |\n# |$)/, newSection);
      } else {
        // Add before Claude Central Command section
        claudeMd = claudeMd.replace('## Claude Central Command', newSection + '\n## Claude Central Command');
      }
      fs.writeFileSync(claudeMdPath, claudeMd);
      console.log('  ✅ CLAUDE.md updated with evolved techniques');

      // Push to brain
      await apiPost('brain_update', {
        brain_name: 'claude-global-rules',
        project_slug: 'global',
        brain_type: 'global',
        is_global: 1,
        brain_content: claudeMd.substring(0, 8000),
      });
    } catch(e) { console.log('  ⚠️  Could not update CLAUDE.md:', e.message); }
  }

  console.log('\n✅ Synthesis complete!\n');
  if (dryRun) console.log('DRY RUN — no changes were saved.');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
