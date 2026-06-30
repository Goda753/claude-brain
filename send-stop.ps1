# Stop hook — marks session ended in Claude Central
$apiKey = "cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805"
$apiUrl = "https://command.digitalmaster.no/api.php"
$machine = "windows-pc"

try {
    $hookInput = $input | ConvertFrom-Json -ErrorAction SilentlyContinue
} catch { $hookInput = $null }

$sessionId = $hookInput.session_id ?? ""
if (-not $sessionId) { exit 0 }

$body = @{
    session_id = $sessionId
    machine    = $machine
} | ConvertTo-Json

try {
    Invoke-RestMethod -Uri "$apiUrl?action=session_end" -Method POST -Body $body `
        -ContentType "application/json" -Headers @{"X-API-Key"=$apiKey} -TimeoutSec 6 -ErrorAction Stop | Out-Null
} catch {}
