# sync-claude.ps1 — SessionStart hook
# Connects to Claude Central Command, registers this session, pulls CLAUDE.md + any handoff.
$apiKey  = "cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805"
$apiUrl  = "https://command.digitalmaster.no/api.php"
$machine = "windows-pc"
$label   = "Windows PC"
$repo    = "C:\Users\aaa\.claude\claude-central"

# Silently keep local clone in sync (offline fallback)
git -C $repo pull --quiet 2>$null

# Read session_id from hook stdin
$hookInput = $null
try { $hookInput = $input | ConvertFrom-Json -ErrorAction SilentlyContinue } catch {}
$sessionId = if ($hookInput.session_id) { $hookInput.session_id } else { [guid]::NewGuid().ToString() }
$project   = (Get-Location).Path

# Register with Central + get context
$body = @{
    session_id = $sessionId
    machine    = $machine
    label      = $label
    project    = $project
    cwd        = $project
} | ConvertTo-Json

$context = ""
try {
    $resp = Invoke-RestMethod -Uri "$apiUrl?action=session_start" -Method POST `
        -Body $body -ContentType "application/json" `
        -Headers @{"X-API-Key" = $apiKey} -TimeoutSec 8 -ErrorAction Stop

    $context = if ($resp.claude_md) { $resp.claude_md } else { "" }
    if ($resp.handoff) {
        $context += "`n`n---`n## ✈️ HANDOFF FROM ANOTHER MACHINE`n" + $resp.handoff
    }
    if ($resp.others_context) {
        $context += $resp.others_context
    }
} catch {
    # Offline fallback — read local clone
    $context = Get-Content "$repo\CLAUDE.md" -Raw -ErrorAction SilentlyContinue
    if (-not $context) { exit 0 }
}

@{
    hookSpecificOutput = @{
        hookEventName     = "SessionStart"
        additionalContext = "# Claude Central (command.digitalmaster.no)`n`n$context"
    }
} | ConvertTo-Json -Depth 5 -Compress
