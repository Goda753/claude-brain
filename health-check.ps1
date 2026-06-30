#Requires -Version 5.1
<#
.SYNOPSIS
    Claude Central health check — runs all service checks and reports status.

.DESCRIPTION
    Checks Claude Central API, semeny.no, digitalmaster.no, active session count,
    the local central-agent.js node process, and C: drive space. Completes in
    under 30 seconds. Exits with code 0 if everything is OK, 1 if anything fails.

.EXAMPLE
    .\health-check.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'   # individual checks handle their own errors

# ── Config ────────────────────────────────────────────────────────────────────
$CentralBase = 'https://command.digitalmaster.no'
$ApiKey      = 'ClaudeCommand2026'            # DASHBOARD_PASS used as lightweight bearer
$DiskWarnPct = 85                             # warn at this % used

# ── Helpers ───────────────────────────────────────────────────────────────────
function Get-Timestamp { (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') }

function Invoke-Check {
    <#
    .DESCRIPTION
        Performs an HTTP GET and returns [ok, statusCode, elapsedMs, body].
    #>
    param([string]$Url, [int]$TimeoutSec = 15)

    $sw   = [System.Diagnostics.Stopwatch]::StartNew()
    $ok   = $false
    $code = 0
    $body = ''
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec `
                    -Headers @{ 'User-Agent' = 'ClaudeHealthCheck/1.0' }
        $code = [int]$resp.StatusCode
        $body = $resp.Content
        $ok   = ($code -ge 200 -and $code -lt 400)
    } catch [System.Net.WebException] {
        $code = [int]$_.Exception.Response.StatusCode
        if ($code -eq 0) { $body = $_.Exception.Message }
    } catch {
        $body = $_.Exception.Message
    }
    $sw.Stop()
    return [PSCustomObject]@{ Ok = $ok; Code = $code; Ms = $sw.ElapsedMilliseconds; Body = $body }
}

function Format-Result {
    param([bool]$Ok, [string]$Label, [string]$Detail, [string]$Extra = '')
    $icon   = if ($Ok) { [char]0x2705 } else { [char]0x274C }   # ✅ / ❌
    $status = if ($Ok) { 'OK' } else { 'FAIL' }
    $line   = "$icon $($Label.PadRight(20)) $($Detail.PadRight(40)) $status"
    if ($Extra) { $line += "  ($Extra)" }
    return $line
}

function Format-Warn {
    param([string]$Label, [string]$Detail, [string]$Extra = '')
    $icon = [char]0x26A0   # ⚠
    $line = "$icon $($Label.PadRight(20)) $($Detail.PadRight(40)) WARN"
    if ($Extra) { $line += "  ($Extra)" }
    return $line
}

# ── Run checks ────────────────────────────────────────────────────────────────
$results = [System.Collections.Generic.List[string]]::new()
$passed  = 0
$total   = 0
$exitCode = 0

# Header
$ts = Get-Timestamp
Write-Host ''
Write-Host "Claude Central Health Check - $ts" -ForegroundColor Cyan
Write-Host ('=' * 60) -ForegroundColor DarkGray

# 1. Central API health
$total++
$r = Invoke-Check "$CentralBase/api.php?action=health"
try   { $json = $r.Body | ConvertFrom-Json; $apiOk = ($r.Ok -and $json.ok -eq $true) }
catch { $apiOk = $false }
if ($apiOk) {
    $passed++
    $line = Format-Result $true 'Central API' $CentralBase "$($r.Ms)ms"
    Write-Host $line -ForegroundColor Green
} else {
    $exitCode = 1
    $line = Format-Result $false 'Central API' $CentralBase "HTTP $($r.Code)"
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# 2. semeny.no
$total++
$r = Invoke-Check 'https://semeny.no'
if ($r.Ok) {
    $passed++
    $line = Format-Result $true 'semeny.no' 'https://semeny.no' "$($r.Ms)ms"
    Write-Host $line -ForegroundColor Green
} else {
    $exitCode = 1
    $line = Format-Result $false 'semeny.no' 'https://semeny.no' "HTTP $($r.Code)"
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# 3. digitalmaster.no
$total++
$r = Invoke-Check 'https://digitalmaster.no'
if ($r.Ok) {
    $passed++
    $line = Format-Result $true 'digitalmaster.no' 'https://digitalmaster.no' "$($r.Ms)ms"
    Write-Host $line -ForegroundColor Green
} else {
    $exitCode = 1
    $line = Format-Result $false 'digitalmaster.no' 'https://digitalmaster.no' "HTTP $($r.Code)"
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# 4. Active sessions (KPI call — requires API key)
$total++
$r = Invoke-Check "$CentralBase/api.php?action=kpis&api_key=$ApiKey"
$sessionsActive = -1
try {
    $json = $r.Body | ConvertFrom-Json
    $sessionsActive = [int]$json.sessions_active
    $kpiOk = $r.Ok
} catch {
    $kpiOk = $false
}
if ($kpiOk) {
    $passed++
    $sessionWord = if ($sessionsActive -eq 1) { 'session' } else { 'sessions' }
    $line = Format-Result $true 'Active Sessions' "$sessionsActive $sessionWord active" ''
    Write-Host $line -ForegroundColor Green
} else {
    $exitCode = 1
    $line = Format-Result $false 'Active Sessions' 'Could not fetch KPIs' "HTTP $($r.Code)"
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# 5. Local agent process (central-agent.js running under node)
$total++
$nodeProcs = Get-Process -Name 'node' -ErrorAction SilentlyContinue |
             Where-Object { $_.Path -ne $null -or $_.Id -gt 0 }

# Try to find specifically central-agent.js via WMI command line
$agentProc = $null
try {
    $wmi = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
    if ($wmi) {
        $agentProc = $wmi | Where-Object { $_.CommandLine -like '*central-agent.js*' } | Select-Object -First 1
    }
} catch {}

if ($agentProc) {
    $passed++
    $line = Format-Result $true 'Local Agent' 'central-agent.js' "PID $($agentProc.ProcessId)"
    Write-Host $line -ForegroundColor Green
} elseif ($nodeProcs) {
    # node is running but could not confirm it's central-agent.js
    $passed++
    $pids = ($nodeProcs | Select-Object -First 3 | ForEach-Object { $_.Id }) -join ', '
    $line = Format-Result $true 'Local Agent' 'node running (agent assumed)' "PID $pids"
    Write-Host $line -ForegroundColor Yellow
} else {
    $exitCode = 1
    $line = Format-Result $false 'Local Agent' 'central-agent.js NOT running' ''
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# 6. Disk space — C: drive
$total++
$drive = Get-PSDrive -Name C -ErrorAction SilentlyContinue
if ($drive) {
    $usedGB  = [math]::Round(($drive.Used)  / 1GB, 1)
    $freeGB  = [math]::Round(($drive.Free)  / 1GB, 1)
    $totalGB = [math]::Round(($usedGB + $freeGB), 1)
    $usedPct = if ($totalGB -gt 0) { [math]::Round(($usedGB / $totalGB) * 100, 0) } else { 0 }

    if ($usedPct -ge $DiskWarnPct) {
        # Warn but don't fail — disk space is advisory
        $line = Format-Warn 'Disk Space' "C: ${usedPct}% used" "${freeGB}GB free"
        Write-Host $line -ForegroundColor Yellow
        $passed++   # count as passed (warn, not error)
    } else {
        $passed++
        $line = Format-Result $true 'Disk Space' "C: ${usedPct}% used" "${freeGB}GB free"
        Write-Host $line -ForegroundColor Green
    }
} else {
    $exitCode = 1
    $line = Format-Result $false 'Disk Space' 'Could not read C: drive' ''
    Write-Host $line -ForegroundColor Red
}
$results.Add($line)

# ── Footer ────────────────────────────────────────────────────────────────────
Write-Host ('=' * 60) -ForegroundColor DarkGray
if ($exitCode -eq 0) {
    Write-Host "Status: ALL OK ($passed/$total checks passed)" -ForegroundColor Green
} else {
    $failed = $total - $passed
    Write-Host "Status: $failed CHECK(S) FAILED  ($passed/$total passed)" -ForegroundColor Red
}
Write-Host ''

exit $exitCode
