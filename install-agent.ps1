#Requires -Version 5.1
<#
.SYNOPSIS
    Installs central-agent.js as a Windows Scheduled Task that runs at logon.

.DESCRIPTION
    Registers "ClaudeCentralAgent" in Task Scheduler. Works without admin
    rights (user-level task). If the task already exists it is updated and
    restarted. Restart-on-failure is configured when running as administrator.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---- Constants --------------------------------------------------------------
$TaskName    = 'ClaudeCentralAgent'
$AgentDir    = 'C:\Users\aaa\.claude'
$AgentScript = Join-Path $AgentDir 'central-agent.js'
$LogFile     = Join-Path $AgentDir 'agent.log'

# ---- Helpers ----------------------------------------------------------------
function Write-Step { param([string]$Msg) Write-Host "[*] $Msg" -ForegroundColor Cyan   }
function Write-Ok   { param([string]$Msg) Write-Host "[+] $Msg" -ForegroundColor Green  }
function Write-Warn { param([string]$Msg) Write-Host "[!] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[-] $Msg" -ForegroundColor Red    }

# ---- 1. Check Node.js -------------------------------------------------------
Write-Step 'Checking Node.js...'
try {
    $nodeVersion = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "node exited with code $LASTEXITCODE" }
    Write-Ok "Node.js found: $nodeVersion"
} catch {
    Write-Fail "Node.js not found or not in PATH. Install it from https://nodejs.org"
    exit 1
}

# ---- 2. Check central-agent.js ----------------------------------------------
Write-Step "Checking for $AgentScript ..."
if (-not (Test-Path $AgentScript)) {
    Write-Fail "central-agent.js not found at: $AgentScript"
    exit 1
}
Write-Ok 'central-agent.js found.'

# ---- 3. Detect admin rights -------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent() `
           ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)

if ($isAdmin) {
    Write-Ok 'Running as Administrator -- full task options available.'
} else {
    Write-Warn 'Not running as Administrator -- task will run in current user context only.'
}

# ---- 4. Build task components -----------------------------------------------
Write-Step 'Building Scheduled Task definition...'

# Action: wrap in cmd.exe so stdout/stderr land in the log file
$cmdArgs = "/C `"node `"$AgentScript`" >> `"$LogFile`" 2>&1`""
$action  = New-ScheduledTaskAction `
    -Execute          'cmd.exe' `
    -Argument         $cmdArgs `
    -WorkingDirectory $AgentDir

# Trigger: at logon of the current user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Principal
if ($isAdmin) {
    $principal = New-ScheduledTaskPrincipal `
        -UserId    $env:USERNAME `
        -LogonType Interactive `
        -RunLevel  Highest
} else {
    $principal = New-ScheduledTaskPrincipal `
        -UserId    $env:USERNAME `
        -LogonType Interactive `
        -RunLevel  Limited
}

# Settings
$settingsParams = @{
    ExecutionTimeLimit = (New-TimeSpan -Hours 0)   # 0 = unlimited
    MultipleInstances  = 'IgnoreNew'
    StartWhenAvailable = $true
    DisallowDemandStart = $false
    Priority            = 7   # BelowNormal
}

if ($isAdmin) {
    $settingsParams['RestartInterval'] = (New-TimeSpan -Minutes 1)
    $settingsParams['RestartCount']    = 3
}

$settings = New-ScheduledTaskSettingsSet @settingsParams

# ---- 5. Register (or update) the task ---------------------------------------
Write-Step "Registering task '$TaskName' ..."

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

try {
    if ($existingTask) {
        Write-Warn "Task '$TaskName' already exists -- updating it."
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok 'Old task removed.'
    }

    Register-ScheduledTask `
        -TaskName    $TaskName `
        -Action      $action `
        -Trigger     $trigger `
        -Principal   $principal `
        -Settings    $settings `
        -Description 'Claude Central Agent -- started at user logon' | Out-Null

    Write-Ok "Task '$TaskName' registered successfully."
} catch {
    Write-Fail "Failed to register task: $_"
    exit 1
}

# ---- 6. Start the task immediately ------------------------------------------
Write-Step 'Starting the task now...'
try {
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2

    $taskInfo = Get-ScheduledTask -TaskName $TaskName
    $lastRun  = (Get-ScheduledTaskInfo -TaskName $TaskName).LastRunTime
    Write-Ok "Task started.  State: $($taskInfo.State)  |  Last run: $lastRun"
} catch {
    Write-Warn "Could not start task immediately: $_"
    Write-Warn 'It will start automatically at next logon.'
}

# ---- 7. Summary -------------------------------------------------------------
Write-Host ''
Write-Host ('=' * 56) -ForegroundColor DarkGray
Write-Ok   'ClaudeCentralAgent installed and running.'
Write-Host "  Script  : $AgentScript"                         -ForegroundColor Gray
Write-Host "  Log     : $LogFile"                             -ForegroundColor Gray
Write-Host "  Trigger : At logon of $env:USERNAME"            -ForegroundColor Gray
Write-Host "  Admin   : $isAdmin"                             -ForegroundColor Gray
Write-Host ''
Write-Host '  Run .\agent-status.ps1  to check live status.'  -ForegroundColor Gray
Write-Host '  Run .\stop-agent.ps1    to stop and unregister.' -ForegroundColor Gray
Write-Host ('=' * 56) -ForegroundColor DarkGray
