# Claude Central Command System

Live distributed orchestration for all Claude AI sessions.

## Dashboard
**https://command.digitalmaster.no/**
Password: ClaudeCommand2026

## Features
- Live session tracking (Mac, Windows, VS Code)
- Remote terminal — run shell/PowerShell from browser
- Remote Claude — send prompts to Claude on any machine
- GitHub integration — browse repos, files, issues, edit files
- KPI metrics with Chart.js dashboards
- Project brains — AI context per project
- Cron scheduler — automated tasks on connected machines
- Push notifications via ntfy.sh
- Work handoff between machines
- VS Code extension

## Connect a Machine

### Windows PC
1. Copy `central-agent.js` to `C:\Users\<you>\.claude\central-agent.js`
2. Run: `node central-agent.js`
3. Auto-start: `powershell -File install-agent.ps1`

### SessionStart Hook (settings.json)
```json
"hooks": {
  "SessionStart": [{"hooks": [{"type":"command","command":"powershell -NonInteractive -File \"C:\\Users\\<you>\\.claude\\sync-claude.ps1\"","shell":"powershell","timeout":15}]}]
}
```

### Mac
See the Connect tab on the dashboard for the bash script.

## API
Base: `https://command.digitalmaster.no/api.php`
Auth: `X-API-Key` header

Key endpoints: session_start, sessions, command_create, command_poll, command_status, kpis, cron_list, brain_get, notifications, github, server_check, ntfy_send

## Architecture
- PHP REST API on cPanel shared hosting
- MySQL DB (semenvoi_command)
- Node.js agent polls every 2s
- Cron agent checks every 60s
- KPI collection every 5min
- Push notifications via ntfy.sh
