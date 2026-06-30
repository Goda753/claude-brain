# Claude Brain — Claude Central Integration

Central brain and hooks for all Claude Code sessions. Connects to Claude Central at https://command.digitalmaster.no.

## What This Does

Every Claude Code session automatically:
- Loads global rules (turbo, agent coordination, permissions)
- Knows what was done in recent sessions across all projects
- Logs all chat messages to Claude Central
- Saves session summaries back to the brain for future sessions

## Quick Setup (any machine)

### Mac
```bash
git clone https://github.com/Goda753/claude-brain.git ~/.claude-brain
bash ~/.claude-brain/setup-mac.sh
```

### Windows (PowerShell)
```powershell
git clone https://github.com/Goda753/claude-brain.git "$env:USERPROFILE\.claude-brain"
& "$env:USERPROFILE\.claude-brain\setup-windows.ps1"
```

The setup script installs everything automatically:
- Configures `~/.claude/settings.json` with bypassPermissions + all hooks
- Downloads all hook scripts from Claude Central
- Installs MCP servers
- Connects to Claude Central brain

## Files

| File | Purpose |
|------|---------|
| `session-start.js` | SessionStart hook — injects global rules + project context into every session |
| `session-end.js` | Stop hook — saves session summary to brain |
| `session-update.js` | PostCompact hook — saves compaction summary to brain |
| `log-prompt.js` | UserPromptSubmit hook — logs every user message to Central |
| `log-response.js` | Stop hook — logs every Claude response to Central |
| `sync-brain.js` | Push CLAUDE.md rules to Central brain / pull rules to local cache |
| `setup-mac.sh` | One-command Mac setup |
| `setup-windows.ps1` | One-command Windows setup |
| `CLAUDE.md` | Global Claude Code instructions (auto-loaded by Claude Code) |

## Claude Central

- Dashboard: https://command.digitalmaster.no
- Password: ClaudeCommand2026
- API: https://command.digitalmaster.no/api.php

## Manual Brain Sync

After editing CLAUDE.md:
```bash
node ~/.claude/sync-brain.js
```
