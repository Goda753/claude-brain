# Watchdog for central-agent.js
# Runs every 5 minutes via Task Scheduler

$logFile = "C:\Users\aaa\.claude\watchdog.log"
$agentLog = "C:\Users\aaa\.claude\agent.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

# Check if agent is running
$proc = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    try { $_.MainModule.FileName -like "*node*" } catch { $false }
} | Where-Object {
    try {
        $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        $cmdLine -like "*central-agent*"
    } catch { $false }
}

if ($proc) {
    # Agent is running
    "$timestamp [watchdog] Agent running (PID $($proc.Id))" | Add-Content $logFile
} else {
    # Agent not running - restart it
    "$timestamp [watchdog] Agent NOT running - restarting" | Add-Content $logFile

    # Start with output going to agent log
    Start-Process -FilePath "node" -ArgumentList "C:\Users\aaa\.claude\central-agent.js" -WorkingDirectory "C:\Users\aaa\.claude" -RedirectStandardOutput $agentLog -WindowStyle Hidden -NoNewWindow

    "$timestamp [watchdog] Agent restarted" | Add-Content $logFile
}

# Keep log small (last 200 lines)
$lines = Get-Content $logFile -ErrorAction SilentlyContinue
if ($lines -and $lines.Count -gt 200) {
    $lines[-200..-1] | Set-Content $logFile
}
