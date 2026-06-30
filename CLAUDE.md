# Global Claude Code Setup

## Auto-Discovery — Read This First

You are connected to Claude Central. On every session start, the SessionStart hook (`~/.claude/session-start.js`) auto-injects live context from Central into your system prompt. If you see a "Claude Central Context" section above — you're already synced.

### If Hooks Aren't Configured Yet

Run the setup for your platform:
- **Mac:** `bash ~/.claude/setup-mac.sh` (or `curl -sL https://command.digitalmaster.no/setup-mac.sh | bash`)
- **Windows:** Run `~/.claude/setup-windows.ps1` in PowerShell

After setup: restart Claude Code. The SessionStart hook fires on every new chat and auto-injects everything.

### What Gets Injected At Session Start
- Global rules: turbo mode, agent coordination, permissions
- Project context: what was done in this project in previous sessions
- Recent sessions: last 3 chats across all projects
- System state: which machines are online, active KPIs, pending alerts

### Manual Brain Sync
If you edit CLAUDE.md and want to push updates to all future sessions:
```bash
node ~/.claude/sync-brain.js
```

### Claude Central
- Dashboard: https://command.digitalmaster.no (ClaudeCommand2026)
- All sessions, commands, and chat logs visible in the dashboard
- Remote desktop, brain management, quick commands all from one place

---

## Who I'm working with
Norwegian photographer/videographer who also does restaurant branding and web work (PHP/WordPress, HTML/CSS/JS). Works across creative and technical projects. Wants maximum effort and results every time — use all available tools aggressively, be decisive, don't hold back.

## Environment
- OS: Windows 11 Pro
- Shell: PowerShell 5.1 (primary) + Git Bash available via Bash tool
- Node.js: v22, npm: v10, Git: v2.39
- VS Code with 40+ extensions

## How to work — always follow these
1. **Use sequential-thinking first** on any complex problem — plan step by step before writing code
2. **Fetch live docs** with the fetch MCP — never guess at library APIs, get the actual documentation
3. **Verify UI with playwright** — after any frontend change, open it in the browser and confirm it works visually
4. **Persist decisions with memory** — store architecture choices and key decisions so they carry across sessions
5. **Track multi-step work with todos** — for anything with more than 3 steps, use TodoWrite to track progress
6. **ALL TOOL USE IS PRE-APPROVED — NEVER ASK** — Do not ask for permission, do not ask "shall I run this?", do not pause before any tool use. Just use Bash, Write, Edit, SSH, browser, agents, MCP — everything is pre-approved. If you're about to run a command, run it. Never prefix tool use with a question or explanation seeking approval. This is a hard rule: asking for permission when it's been pre-approved wastes the user's time.
7. **Be decisive and thorough** — push for the best possible output every time
8. **Show progress on every multi-step task** — at the start of any task with 3+ steps, print a progress table (Step | Status). Update it after each milestone so the user always sees what's done, in progress, and queued. Never go silent for long stretches.

## Turbo — Multi-Agent Parallel Execution

When the user says "Nx turbo", spawn exactly N agents IN PARALLEL immediately. The number before "x" is literal — it IS the agent count. No asking, no confirmation — just launch them all at once.

**Formula: `Nx turbo` = N agents**

Examples: `3x turbo` = 3 agents, `7x turbo` = 7 agents, `12x turbo` = 12 agents

Plain `turbo` with no number = 4 agents (default).

**Rules:**
- Always use the `Agent` tool, never sequential execution
- Each agent runs at maximum effort (`xhigh`) — turbo means max effort per agent, not just parallelism
- Split the task into truly independent subtasks — one per agent
- All agents run in a single message (parallel, not sequential)
- Agents that edit the same file should each write to separate temp files; a final agent assembles
- Never ask the user to confirm before spawning — turbo is always pre-approved

## Agent Coordination Rules — How to Split Work Correctly

These rules apply whenever running multiple agents (turbo or otherwise). Violating them causes conflicts, gaps, and incoherent output.

---

### 1. Decomposition — Find the Right Seams

**Parallelism test:** Can this piece start without knowing any other agent's output? If yes → parallel. If Agent B needs Agent A's output → sequential (phased).

**Slice vertically by feature, not horizontally by layer.**

Good (vertical — each agent owns a complete slice end-to-end):
- Agent 1: search feature — route + controller + blade + CSS
- Agent 2: checkout feature — route + controller + blade + CSS

Bad (horizontal — agents block each other):
- Agent 1: all models / Agent 2: all controllers / Agent 3: all views

Natural seams to look for: route groups, models/tables, Blade components, Alpine widgets, Laravel modules, Livewire components, feature-scoped CSS files, migrations, locale strings.

**Right granularity:** each agent = 5–20 minutes of focused work, 2–6 files. Too coarse = no parallelism gain. Too fine = coordination overhead dominates.

**Scout-first when the codebase is unfamiliar:** spawn one scout agent that reads the code and returns a decomposition plan. Then spawn workers in the next wave using that plan.

---

### 2. Define Contracts Before Spawning

A contract is anything two agents share: function signatures, API endpoint shapes, DB column names, CSS class names, event names, TypeScript types, JSON payloads. If it's not written down, agents guess — and they guess differently.

**Rules:**
- Define each contract once in the parent prompt
- Paste the full definition verbatim into every agent prompt that touches it — never say "use the same schema as Agent 2" (agents cannot read each other)
- Explicitly forbid renaming: "Use exactly these names. Do not rename columns, routes, or keys."

If there's no clear contract yet, run a scout phase first to lock the spec before spawning build agents.

---

### 3. One File = One Agent. No Exceptions.

No two agents may write to the same file. Concurrent writes produce corrupted output or silently dropped changes.

**Temp-file pattern for shared targets:**
1. Each agent writes to `scratchpad/agent-N-<filename>.ext`
2. An assembler agent runs last, reads all temp files, merges into the final target

**High-conflict zones** — `routes/web.php`, `package.json`, `.env`, `config/app.php`, `composer.json`, `app.css`, `app.js`: assign to one agent only, or freeze during parallel work and handle in the assembler pass.

**Pre-assignment rule:** before spawning any agent, produce an explicit file ownership map:
```
Agent 1 → app/Http/Controllers/SearchController.php
Agent 2 → resources/views/search/results.blade.php
Agent 3 → scratchpad/agent-3-search.css  (assembler writes to public/search.css)
```
No file appears twice. Scan for duplicates before spawning — overlap found after spawning means wasted work.

---

### 4. Brief Every Agent With Three Context Layers

Every agent starts cold — no memory, no awareness of siblings. Every prompt must include:

**Layer 1 — System:** What the overall product is. One sentence: stack, purpose, domain.
*"This is a Laravel 13 / Blade / Alpine.js restaurant discovery platform serving 66k+ restaurants across Norway and Europe."*

**Layer 2 — Task:** What the overall work achieves. One sentence on the collective goal, not just this agent's piece.
*"We are rebuilding checkout to support Vipps, Stripe, and cash, with a unified order summary component."*

**Layer 3 — Slice:** Where this agent's piece fits, and what the other agents own.
*"Agent 1 is building CartSummary, Agent 3 is building PaymentSelector. You are building OrderConfirmation, which receives a finalized order object from PaymentSelector."*

**Briefing template:**
```
Big picture: [one sentence — what the full assembled result does]

Other agents are building:
- Agent [N]: [owns X — output shape / export name / file path]
- Agent [N]: [owns Y — output shape / export name / file path]
Do NOT implement any of the above.

Your scope — [Section Title]:
[What to build. Exact files to write or functions to implement.]
[Hard boundary: what is explicitly out of scope.]

Shared contracts:
- Naming: [e.g. camelCase functions, PascalCase types]
- File output: [exact path(s) to write]
- Interfaces to honor: [function signatures or type names from other agents]
- Style: [match existing pattern in X file]

Return: [file path written] + [one-line summary of what was produced]
```

**What breaks when a section is missing:**

| Missing | Failure mode |
|---|---|
| Big picture | Agent gold-plates its piece or solves the wrong problem |
| Other agents' scopes | Duplicate implementations, broken interfaces |
| Hard boundaries | Scope creep into files owned by others |
| Shared contracts | Naming mismatches that break assembly |
| Output format | Agent returns prose instead of artifact |

---

### 5. Phased vs. Flat Parallel

**Decision test:** Can every agent start right now with zero input from any other agent?

**Yes → flat parallel.** Launch all agents in one message. Use when: all contracts are clear from context, files are independent, codebase is familiar.

**No → phased:**
- **Phase 1 — Scout (1 agent):** reads codebase, maps patterns, writes spec to scratchpad. Use when codebase is unfamiliar or no clear pattern exists.
- **Phase 2 — Build (N agents):** all launch simultaneously from the Phase 1 spec, owning separate files.
- **Phase 3 — Integrate (1–2 agents):** merges outputs, runs seam check, ships.

Skip Phase 1 if patterns are obvious from context. Skip Phase 3 if agents each ship their own independent file.

| Wrong call | Consequence |
|---|---|
| Flat parallel on dependent work | Conflicting decisions; incompatible outputs; integration takes longer than sequential |
| Too many phases on simple work | Serial bottlenecks wipe out the parallelism gain |

Default to flat. Add phases only when dependency makes flat impossible.

---

### 6. The Assembler and Reviewer Agents

**When to use an assembler:**

| Situation | Approach |
|---|---|
| Total output < 500 lines | Assemble in main context |
| Output > 500 lines or 4+ agents | Spawn assembler agent |
| Cross-cutting concerns (types, styles) | Always use assembler agent |

**Assembler brief structure:**
```
You are assembling final output from N agents. Inputs: [list each file].
Target: [output path + format].
Rules: unify naming to camelCase, resolve duplicate functions by keeping the
fuller implementation, ensure all imports resolve. Read every file before
writing a single line.
```

**Reviewer agent:** after assembly, spawn a separate reviewer. Its only job: read the assembled result end-to-end and report gaps, inconsistencies, broken connections. It does not fix — it catalogs. Fix in a targeted edit pass after.

**Seam check — always verify:**
- Import A references export B — does B exist with that exact name and signature?
- Route X calls Controller Y method Z — does that method exist and accept those params?
- Component receives prop W — is W typed and passed correctly from parent?

Seam failures are the most common integration bug. Check them explicitly; never assume they work because each piece compiled in isolation.

---

### 7. Real-World Split Examples

**3-agent auth + profile + permissions:** vertical slices — Agent 1 owns login/logout/session, Agent 2 owns profile read/update/avatar, Agent 3 owns roles/middleware/seeder. No assembler needed (distinct files).

**4-agent controller refactor + assembler:** Agents 1–4 each extract one controller to a `scratchpad/*.php.tmp` file. Assembler moves them into place and rewrites the original controller's route bindings atomically.

**5-agent dashboard panels:** each agent owns one `<x-panel-{name}>` Blade component. Agent 5 writes the shared `dashboard-panels.css` with `.panel-*` base styles all four reference. Contract upfront: every panel accepts a `$data` prop, uses `.panel-` prefix.

**2-agent REST + frontend consumer:** contract written first (`GET /api/restaurants/{id}/stats` → `{ orders_today, revenue_today, avg_rating }`). Agent 1 builds the controller + query. Agent 2 builds the Blade partial + Alpine fetch. No assembler needed because JSON shape was locked before spawning.

**5-agent blog posts:** fully flat parallel. Contract: each post goes to `resources/views/blog/{slug}.blade.php`, uses `@extends('layouts.blog')`, 600–900 words. No shared state, no assembler.

---

### 8. Anti-Patterns Quick Reference

| Anti-pattern | What goes wrong | Fix |
|---|---|---|
| **Scope bleed** | Two agents implement the same function | Every scope names exact files and exports it owns — nothing else |
| **Silent gap** | Part of task has no owner | Enumerate every deliverable before spawning; confirm each has an agent |
| **Horizontal slice** | Agents split by layer; every feature needs cross-agent coordination | Split vertically by feature |
| **Assumption mismatch** | Agents invent their own data shapes; seam breaks at runtime | Write shared types and field names explicitly in every relevant prompt |
| **Shared file collision** | Second write silently overwrites first | One file, one owner; others write to temp files; assembler merges |
| **Vague brief** | Agent invents its own approach that collides with others | Name exact endpoints, inputs, outputs, and edge cases in every prompt |
| **Missing big picture** | Agent introduces patterns that conflict with existing architecture | Inject a system-snapshot paragraph into every prompt |

## Claude Central Command

This machine is connected to Claude Central at https://command.digitalmaster.no (pass: ClaudeCommand2026)
API key: `cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805`
Agent: `C:\Users\aaa\.claude\central-agent.js` (runs in background, auto-restarts via Task Scheduler)

Every Claude Code session is automatically registered with Central via the SessionStart hook. Central tracks all sessions, machines, commands, KPIs, and remote desktop.

## MCP Servers Available

### memory (`mcp__memory__*`)
Persistent knowledge graph across sessions. Use to store/retrieve facts, decisions, and relationships between projects and entities.
Tools: `create_entities`, `create_relations`, `add_observations`, `read_graph`, `search_nodes`, `open_nodes`, `delete_entities`, `delete_observations`, `delete_relations`

### sequential-thinking (`mcp__sequential-thinking__sequentialthinking`)
Step-by-step reasoning for complex multi-step problems. Use this BEFORE writing complex code or making architectural decisions.

### filesystem (`mcp__filesystem__*`)
Extended file system access rooted at `C:\Users\aaa`.
Tools: `read_file`, `read_multiple_files`, `write_file`, `edit_file`, `create_directory`, `list_directory`, `directory_tree`, `move_file`, `search_files`, `get_file_info`

### fetch (`mcp__fetch__fetch`)
Fetch any live URL and return its content as text or markdown. Use for reading up-to-date documentation, APIs, or web pages.

### playwright (`mcp__playwright__*`)
Full Chromium browser automation. Use for UI verification, screenshots, web scraping, and testing.
Tools: `playwright_navigate`, `playwright_screenshot`, `playwright_click`, `playwright_fill`, `playwright_select`, `playwright_hover`, `playwright_evaluate`, `playwright_get_visible_text`, `playwright_get_visible_html`, `playwright_go_back`, `playwright_go_forward`, `playwright_scroll`, `playwright_wait`

### GitHub MCP (optional — needs GITHUB_TOKEN)
Not pre-configured. To enable: add `GITHUB_TOKEN` env var to the `github` entry in `~/.claude/settings.json`.

## Built-in Claude Code Tools

| Tool | Purpose |
|------|---------|
| `Read` | Read any file |
| `Write` | Create/overwrite files |
| `Edit` | Precise string replacement edits |
| `Bash` | Run PowerShell or shell commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents (ripgrep) |
| `Agent` | Spawn specialized subagents (Explore, Plan, claude-code-guide, etc.) |
| `TodoWrite` | Track multi-step task progress |
| `WebFetch` | Fetch a URL (built-in) |
| `WebSearch` | Search the web |

## VS Code Extensions Installed

**Web/Frontend:** ESLint, Tailwind CSS, Auto Rename Tag, HTML CSS Support, CSS Class Completion, CSS Peek, Prettier, Live Server
**PHP/WordPress:** Intelephense, PHP Namespace Resolver, WordPress Toolbox
**Python:** Python, Pylance, Debugpy, Black Formatter, Python Envs
**Data/DB:** SQLTools + MySQL/PostgreSQL/SQLite drivers, Jupyter, Rainbow CSV
**Git:** GitLens, Git Graph, GitHub Actions
**Languages:** Go, Rust Analyzer, C/C++, YAML, TOML
**Productivity:** IntelliCode, Path Intellisense, NPM Intellisense, Error Lens, Todo Tree, Code Spell Checker
**Infra:** Docker, Remote SSH, Remote WSL, SFTP
**Markdown:** Markdown All in One, GitHub Markdown Preview
**Icons:** Material Icon Theme

## PowerShell notes
- `&&` is NOT supported in PS 5.1 — chain with `; if ($?) { ... }` or use semicolons
- Use the Bash tool explicitly for POSIX/Unix scripts
- Always double-quote paths with spaces
