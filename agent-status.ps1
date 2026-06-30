#Requires -Version 5.1
<#
.SYNOPSIS
    Shows the live status of the ClaudeCentralAgent Scheduled Task.

.DESCRIPTION
    Reports:
      - Task state (Running / Ready / Disabled / Not found)
      - Last run time and last exit code
      - Tail of the log file (agent.log)
      - HTTP health check against the agent API
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'SilentlyContinue'   # status script must not throw

$TaskName   = 'ClaudeCentralAgent'
$AgentDir   = 'C:\Users\aaa\.claude'
$LogFile    = Join-Path $AgentDir 'agent.log'
$LogTail    = 30
$HealthUrl  = 'http://localhost:3456/health'   # adjust port if needed

# ---- Helpers ----------------------------------------------------------------
function Write-Header { param([string]$T) Write-Host "`n$T" -ForegroundColor DarkCyan }

function Write-Col {
    param([string]$Label, [string]$Value, [string]$Color = 'White')
    Write-Host ('  {0,-22}' -f "$Label") -NoNewline -ForegroundColor DarkGray
    Write-Host $Value -ForegroundColor $Color
}

# ---- Header -----------------------------------------------------------------
Write-Host ''
Write-Host ('=' * 56) -ForegroundColor DarkGray
Write-Host '     Claude Central Agent -- Status Report' -ForegroundColor Cyan
Write-Host ('=' * 56) -ForegroundColor DarkGray

# ---- 1. Task Scheduler status -----------------------------------------------
Write-Header '[ Task Scheduler ]'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Col 'Registered' 'NO -- task not found' Red
    Write-Host '  Run .\install-agent.ps1 to install.' -ForegroundColor Yellow
} else {
    $stateColor = switch ($task.State) {
        'Running'  { 'Green'  }
        'Ready'    { 'Yellow' }
        'Disabled' { 'Red'    }
        default    { 'Gray'   }
    }
    Write-Col 'Registered'   'Yes'              Green
    Write-Col 'Task state'   "$($task.State)"   $stateColor
    Write-Col 'Description'  "$($task.Description)" Gray

    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($info) {
        $never    = [datetime]'1/1/1999'
        $lastRun  = if ($info.LastRunTime -and $info.LastRunTime -ne $never) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'Never' }
        $nextRun  = if ($info.NextRunTime -and $info.NextRunTime -ne $never) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'N/A'   }
        $exitCode = $info.LastTaskResult
        $exitColor = if ($exitCode -eq 0 -or $exitCode -eq 267009) { 'Green' } else { 'Red' }

        Write-Col 'Last run'    $lastRun
        Write-Col 'Next run'    $nextRun
        Write-Col 'Last result' "0x$('{0:X8}' -f $exitCode)  ($exitCode)" $exitColor
    }

    $act = $task.Actions | Select-Object -First 1
    if ($act) {
        Write-Col 'Executable'  "$($act.Execute)"           Gray
        Write-Col 'Arguments'   "$($act.Arguments)"         Gray
        Write-Col 'Working dir' "$($act.WorkingDirectory)"  Gray
    }

    $trig = $task.Triggers | Select-Object -First 1
    if ($trig) {
        Write-Col 'Trigger' "$($trig.CimClass.CimClassName -replace 'MSFT_Task','')" Gray
    }
}

# ---- 2. Process check -------------------------------------------------------
Write-Header '[ Process ]'

$procs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -like '*central-agent*' }

if ($procs) {
    foreach ($p in $procs) {
        $created = [System.Management.ManagementDateTimeConverter]::ToDateTime($p.CreationDate)
        $upMin   = [int]((Get-Date) - $created).TotalMinutes
        Write-Col "PID $($p.ProcessId)" "Up $upMin min  |  $($p.CommandLine)" Green
    }
} else {
    Write-Col 'node process' 'Not running' Yellow
}

# ---- 3. Log file tail -------------------------------------------------------
Write-Header "[ Log -- last $LogTail lines ]"

if (Test-Path $LogFile) {
    $fi = Get-Item $LogFile
    Write-Col 'Log path'  $LogFile Gray
    Write-Col 'Log size'  "$([math]::Round($fi.Length / 1KB, 1)) KB  |  Modified: $($fi.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))" Gray
    Write-Host ('  ' + ('-' * 52)) -ForegroundColor DarkGray
    Get-Content $LogFile -Tail $LogTail | ForEach-Object {
        if      ($_ -match 'error'   ) { Write-Host "  $_" -ForegroundColor Red    }
        elseif  ($_ -match 'warn'    ) { Write-Host "  $_" -ForegroundColor Yellow }
        elseif  ($_ -match 'info|start|ready|listen') { Write-Host "  $_" -ForegroundColor Cyan }
        else                           { Write-Host "  $_" -ForegroundColor Gray   }
    }
    Write-Host ('  ' + ('-' * 52)) -ForegroundColor DarkGray
} else {
    Write-Col 'Log file' "Not found at: $LogFile" Yellow
    Write-Col ''         '(Agent may not have written output yet)' Gray
}

# ---- 4. API health check ----------------------------------------------------
Write-Header '[ API Health Check ]'
Write-Col 'URL' $HealthUrl Gray

try {
    $resp = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Col 'HTTP status' "$($resp.StatusCode) $($resp.StatusDescription)" Green
    if ($resp.Content) {
        try {
            $json = $resp.Content | ConvertFrom-Json
            $json.PSObject.Properties | ForEach-Object {
                Write-Col "  $($_.Name)" "$($_.Value)" Cyan
            }
        } catch {
            Write-Col 'Response' $resp.Content Cyan
        }
    }
} catch {
    $sc = 0
    try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
    if ($sc -gt 0) {
        Write-Col 'HTTP status' "$sc -- agent responded but returned an error" Yellow
    } else {
        Write-Col 'HTTP status' 'No response -- agent not listening (or wrong port)' Red
        Write-Col 'Note'        "Edit `$HealthUrl in this script if the port differs." Gray
    }
}

# ---- Footer -----------------------------------------------------------------
Write-Host ''
Write-Host '  .\install-agent.ps1  -- install / update task' -ForegroundColor DarkGray
Write-Host '  .\stop-agent.ps1     -- stop and remove task'  -ForegroundColor DarkGray
Write-Host ''
