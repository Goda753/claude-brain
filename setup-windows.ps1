# Claude Code + Claude Central full setup for Windows
# Run: Set-ExecutionPolicy Bypass -Scope Process; & "$env:USERPROFILE\.claude\setup-windows.ps1"
# Or on a fresh machine:
#   Set-ExecutionPolicy Bypass -Scope Process
#   Invoke-WebRequest "https://command.digitalmaster.no/setup-windows.ps1" -OutFile "$env:TEMP\setup.ps1"
#   & "$env:TEMP\setup.ps1"

$ClaudeDir = "$env:USERPROFILE\.claude"
New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null

$ApiKey = "cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805"
$ApiBase = "https://command.digitalmaster.no"

Write-Host "=== Claude Central Windows Setup ===" -ForegroundColor Cyan

# 1. Write settings.json
$settingsJson = @'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "model": "claude-opus-4-8",
  "effortLevel": "xhigh",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\USERNAME\\.claude\\session-start.js",
            "timeout": 15
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\USERNAME\\.claude\\session-update.js",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\USERNAME\\.claude\\log-prompt.js",
            "timeout": 8
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\USERNAME\\.claude\\log-response.js",
            "timeout": 10,
            "async": true
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node C:\\Users\\USERNAME\\.claude\\session-end.js",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["C:\\Users\\USERNAME\\AppData\\Roaming\\npm\\node_modules\\@modelcontextprotocol\\server-memory\\dist\\index.js"]
    },
    "sequential-thinking": {
      "command": "node",
      "args": ["C:\\Users\\USERNAME\\AppData\\Roaming\\npm\\node_modules\\@modelcontextprotocol\\server-sequential-thinking\\dist\\index.js"]
    },
    "filesystem": {
      "command": "node",
      "args": ["C:\\Users\\USERNAME\\AppData\\Roaming\\npm\\node_modules\\@modelcontextprotocol\\server-filesystem\\dist\\index.js", "C:\\Users\\USERNAME"]
    },
    "fetch": {
      "command": "node",
      "args": ["C:\\Users\\USERNAME\\AppData\\Roaming\\npm\\node_modules\\mcp-server-fetch\\index.js"]
    },
    "playwright": {
      "command": "node",
      "args": ["C:\\Users\\USERNAME\\AppData\\Roaming\\npm\\node_modules\\@playwright\\mcp\\cli.js"]
    }
  }
}
'@

# Replace USERNAME placeholder with actual Windows username
$username = $env:USERNAME
$settingsJson = $settingsJson -replace 'USERNAME', $username

$settingsJson | Out-File -FilePath "$ClaudeDir\settings.json" -Encoding utf8
Write-Host "  settings.json written" -ForegroundColor Green

# 2. Download hook scripts from Claude Central
$hookScripts = @(
    "session-start.js",
    "session-update.js",
    "session-end.js",
    "log-prompt.js",
    "log-response.js",
    "sync-brain.js",
    "central-agent.js"
)

Write-Host ""
Write-Host "Downloading hook scripts from Claude Central..." -ForegroundColor Cyan
foreach ($script in $hookScripts) {
    $dest = "$ClaudeDir\$script"
    try {
        $headers = @{ "X-API-Key" = $ApiKey }
        Invoke-WebRequest -Uri "$ApiBase/api.php?action=get_hook_file&name=$script" `
            -Headers $headers -OutFile $dest -ErrorAction Stop
        Write-Host "  $script downloaded" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: Could not download $script — copy manually" -ForegroundColor Yellow
    }
}

# 3. Sync brain (pull global rules cache)
if (Test-Path "$ClaudeDir\sync-brain.js") {
    Write-Host ""
    Write-Host "Syncing global rules from Claude Central brain..." -ForegroundColor Cyan
    try {
        node "$ClaudeDir\sync-brain.js" --pull
        Write-Host "  Brain synced" -ForegroundColor Green
    } catch {
        Write-Host "  (sync failed — rules will load on next session start)" -ForegroundColor Yellow
    }
}

# 4. Install MCP servers if not present
Write-Host ""
Write-Host "Checking MCP servers..." -ForegroundColor Cyan

$mcpPackages = @(
    "@modelcontextprotocol/server-memory",
    "@modelcontextprotocol/server-sequential-thinking",
    "@modelcontextprotocol/server-filesystem",
    "mcp-server-fetch",
    "@playwright/mcp"
)

foreach ($pkg in $mcpPackages) {
    $checkName = $pkg -replace '@.*/', ''
    $installed = npm list -g $pkg 2>$null | Select-String $checkName
    if ($installed) {
        Write-Host "  $pkg already installed" -ForegroundColor Green
    } else {
        Write-Host "  Installing $pkg..." -ForegroundColor Yellow
        npm install -g $pkg
    }
}

# 5. Set up central-agent as a scheduled task (auto-restart on reboot)
if (Test-Path "$ClaudeDir\central-agent.js") {
    Write-Host ""
    Write-Host "Setting up central-agent as scheduled task..." -ForegroundColor Cyan
    $taskName = "ClaudeCentralAgent"
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  Task already exists — skipping" -ForegroundColor Green
    } else {
        $action  = New-ScheduledTaskAction -Execute "node.exe" -Argument "$ClaudeDir\central-agent.js"
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
            -Settings $settings -Description "Claude Central background agent" -RunLevel Highest | Out-Null
        Write-Host "  Scheduled task '$taskName' created (runs at logon)" -ForegroundColor Green
        # Start it now
        Start-ScheduledTask -TaskName $taskName
        Write-Host "  Agent started" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Green
Write-Host "Claude Central connected. Brain rules injected on every session start."
Write-Host "Dashboard: https://command.digitalmaster.no (pass: ClaudeCommand2026)"
Write-Host ""
Write-Host "To start Claude Code: claude"

Write-Host ""
Write-Host "Running integration check..." -ForegroundColor Cyan
node "$ClaudeDir\auto-check.js"
