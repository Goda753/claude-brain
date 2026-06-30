#Requires -Version 5.1
<#
.SYNOPSIS
    Stops and unregisters the ClaudeCentralAgent Scheduled Task.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'ClaudeCentralAgent'

function Write-Step { param([string]$Msg) Write-Host "[*] $Msg" -ForegroundColor Cyan   }
function Write-Ok   { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green  }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[-] $Msg" -ForegroundColor Red    }

# ---- Check task exists ------------------------------------------------------
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Warn "Task '$TaskName' not found -- nothing to remove."
    exit 0
}

# ---- Stop if running --------------------------------------------------------
Write-Step 'Checking task state...'
if ($task.State -eq 'Running') {
    Write-Step 'Task is running -- stopping it...'
    try {
        Stop-ScheduledTask -TaskName $TaskName
        Write-Ok 'Task stopped.'
    } catch {
        Write-Warn "Could not stop task cleanly: $_"
    }
} else {
    Write-Ok "Task state is '$($task.State)' -- no need to stop."
}

# ---- Unregister -------------------------------------------------------------
Write-Step "Unregistering task '$TaskName' ..."
try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Ok "Task '$TaskName' removed from Task Scheduler."
} catch {
    Write-Fail "Failed to unregister task: $_"
    exit 1
}

# ---- Kill orphan node processes (best-effort) --------------------------------
Write-Step 'Looking for orphan node processes running central-agent.js...'
try {
    $procs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like '*central-agent.js*' }

    if ($procs) {
        foreach ($p in $procs) {
            Write-Warn "Killing PID $($p.ProcessId)  [$($p.CommandLine)]"
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Write-Ok 'Orphan process(es) killed.'
    } else {
        Write-Ok 'No orphan node processes found.'
    }
} catch {
    Write-Warn "Could not scan for orphan processes: $_"
}

Write-Host ''
Write-Ok 'Done. ClaudeCentralAgent is fully stopped and unregistered.'
Write-Host '  Run .\install-agent.ps1 to reinstall.' -ForegroundColor Gray
