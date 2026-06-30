#Requires -Version 5.1
<#
.SYNOPSIS
    Continuous monitor that runs health-check.ps1 every 5 minutes and sends
    ntfy.sh notifications when any check fails.

.DESCRIPTION
    Runs in a loop until Ctrl+C. On each cycle:
      1. Runs health-check.ps1 and captures its output + exit code.
      2. If exit code != 0 (any check failed): fetches the ntfy topic from
         Claude Central and sends a push notification.
      3. Waits for the next interval.

    The ntfy topic is fetched fresh from Claude Central on the first run
    and cached. It re-fetches the topic every hour in case it changes.

.PARAMETER IntervalMinutes
    How many minutes between checks. Default: 5.

.PARAMETER ApiKey
    Claude Central API key. Defaults to the DASHBOARD_PASS value.

.EXAMPLE
    .\monitor.ps1
    .\monitor.ps1 -IntervalMinutes 10
#>

param(
    [int]    $IntervalMinutes = 5,
    [string] $ApiKey          = 'ClaudeCommand2026'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'

# ── Config ────────────────────────────────────────────────────────────────────
$CentralBase   = 'https://command.digitalmaster.no'
$HealthScript  = Join-Path $PSScriptRoot 'health-check.ps1'
$IntervalSec   = $IntervalMinutes * 60
$TopicCacheSec = 3600   # re-fetch ntfy topic after 1 hour

# ── ntfy helper ──────────────────────────────────────────────────────────────
function Send-Ntfy {
    param(
        [string] $Topic,
        [string] $Title,
        [string] $Message,
        [string] $Priority = 'default'
    )
    $headers = @{
        'Title'    = $Title
        'Priority' = $Priority
        'Tags'     = 'warning'
    }
    try {
        Invoke-RestMethod -Uri "https://ntfy.sh/$Topic" `
                          -Method POST `
                          -Body $Message `
                          -Headers $headers `
                          -TimeoutSec 8 | Out-Null
        return $true
    } catch {
        Write-Host "  [ntfy] Send failed: $_" -ForegroundColor DarkYellow
        return $false
    }
}

# ── Topic fetch ───────────────────────────────────────────────────────────────
function Get-NtfyTopic {
    try {
        $resp = Invoke-RestMethod `
            -Uri "$CentralBase/api.php?action=settings&api_key=$ApiKey" `
            -UseBasicParsing `
            -TimeoutSec 10 `
            -Headers @{ 'User-Agent' = 'ClaudeMonitor/1.0' }
        # settings returns { key_name: { value, updated_at } }
        if ($resp.ntfy_topic) { return $resp.ntfy_topic.value }
        if ($resp.ntfy_topic_id) { return $resp.ntfy_topic_id.value }
    } catch {}
    return $null
}

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Banner {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host ''
    Write-Host "[$([datetime]::Now.ToString('HH:mm:ss'))] $Msg" -ForegroundColor $Color
}

function Format-Countdown {
    param([int]$Sec)
    $m = [math]::Floor($Sec / 60)
    $s = $Sec % 60
    return "$($m)m $($s)s"
}

# ── Startup ───────────────────────────────────────────────────────────────────
if (-not (Test-Path $HealthScript)) {
    Write-Host "ERROR: health-check.ps1 not found at: $HealthScript" -ForegroundColor Red
    Write-Host 'Place health-check.ps1 in the same directory as monitor.ps1.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║        Claude Central — Continuous Monitor               ║' -ForegroundColor Cyan
Write-Host "║  Interval: every $IntervalMinutes min  |  Press Ctrl+C to stop         ║" -ForegroundColor Cyan
Write-Host '╚══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan

# ── State ─────────────────────────────────────────────────────────────────────
$ntfyTopic          = $null
$topicFetchedAt     = [datetime]::MinValue
$consecutiveFailures = 0
$cycleNumber         = 0

# ── Main loop ─────────────────────────────────────────────────────────────────
while ($true) {
    $cycleNumber++
    $cycleStart = [datetime]::Now

    Write-Banner "=== Cycle #$cycleNumber — $($cycleStart.ToString('yyyy-MM-dd HH:mm:ss')) ===" 'Cyan'

    # (Re-)fetch ntfy topic if stale
    $topicAge = ([datetime]::Now - $topicFetchedAt).TotalSeconds
    if (-not $ntfyTopic -or $topicAge -gt $TopicCacheSec) {
        Write-Host '  Fetching ntfy topic from Claude Central...' -ForegroundColor DarkGray
        $fetched = Get-NtfyTopic
        if ($fetched) {
            $ntfyTopic      = $fetched
            $topicFetchedAt = [datetime]::Now
            Write-Host "  ntfy topic: $ntfyTopic" -ForegroundColor DarkGray
        } else {
            Write-Host '  [WARN] Could not fetch ntfy topic — notifications disabled until next fetch.' -ForegroundColor DarkYellow
        }
    }

    # Run health-check.ps1 and capture output
    $output   = & powershell.exe -NonInteractive -NoProfile -File $HealthScript 2>&1
    $checkOk  = ($LASTEXITCODE -eq 0)

    # Print output with timestamp prefix on first line
    $output | ForEach-Object { Write-Host "  $_" }

    if ($checkOk) {
        $consecutiveFailures = 0
        Write-Host "  Result: HEALTHY" -ForegroundColor Green
    } else {
        $consecutiveFailures++
        Write-Host "  Result: DEGRADED (failure #$consecutiveFailures)" -ForegroundColor Red

        # Send ntfy notification
        if ($ntfyTopic) {
            $failedLines = $output | Where-Object { $_ -match '(FAIL|ERROR|WARN)' }
            $detail      = if ($failedLines) { ($failedLines -join "`n") } else { 'One or more checks failed.' }
            $title       = "Claude Central ALERT — $($cycleStart.ToString('HH:mm'))"
            $msgBody     = "Health check failed (cycle #$cycleNumber)`n`n$detail"

            Write-Host "  Sending ntfy notification to '$ntfyTopic'..." -ForegroundColor Yellow
            $sent = Send-Ntfy -Topic $ntfyTopic -Title $title -Message $msgBody -Priority 'high'
            if ($sent) {
                Write-Host "  Notification sent." -ForegroundColor Yellow
            }
        } else {
            Write-Host '  [ntfy] No topic configured — skipping notification.' -ForegroundColor DarkYellow
        }
    }

    # Calculate sleep time (account for check duration)
    $elapsed  = ([datetime]::Now - $cycleStart).TotalSeconds
    $sleepSec = [math]::Max(0, $IntervalSec - [int]$elapsed)

    if ($sleepSec -gt 0) {
        Write-Host ''
        Write-Host "  Next check in $(Format-Countdown $sleepSec)..." -ForegroundColor DarkGray
        # Sleep in 5-second increments so Ctrl+C is responsive
        $slept = 0
        while ($slept -lt $sleepSec) {
            Start-Sleep -Seconds ([math]::Min(5, $sleepSec - $slept))
            $slept += 5
        }
    }
}
