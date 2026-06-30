# PostCompact hook — sends work state summary to Claude Central
$apiKey = "cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805"
$apiUrl = "https://command.digitalmaster.no/api.php"
$machine = "windows-pc"

try {
    $hookInput = $input | ConvertFrom-Json -ErrorAction SilentlyContinue
} catch { $hookInput = $null }

$sessionId = $hookInput.session_id ?? ""
$summary   = $hookInput.summary    ?? ($hookInput.tool_response.summary ?? "")
if (-not $summary) { $summary = $hookInput | ConvertTo-Json -Compress }

if (-not $sessionId) { exit 0 }

$body = @{
    session_id = $sessionId
    machine    = $machine
    summary    = $summary
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$apiUrl?action=session_update" -Method POST -Body $body `
        -ContentType "application/json" -Headers @{"X-API-Key"=$apiKey} -TimeoutSec 6 -ErrorAction Stop | Out-Null
} catch {}
