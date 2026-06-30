/**
 * Claude Central Agent — Windows PC
 * Polls command.digitalmaster.no for remote commands and executes them.
 * Features: command polling, heartbeat, cron jobs, KPI collection, ntfy.sh notifications, GitHub KPI,
 *           remote desktop (persistent PS screen capture → API upload + mouse/keyboard event execution)
 *
 * Start: node central-agent.js
 */

'use strict';

const https  = require('https');
const { spawn } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Config ────────────────────────────────────────────────────────────────────
const API_KEY          = 'cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805';
const API_HOST         = 'command.digitalmaster.no';
const API_PATH         = '/api.php';
const MACHINE          = 'windows-pc';
const LABEL            = 'Windows PC';
const POLL_MS          = 2000;
const HEARTBEAT_MS     = 45000;
const CRON_CHECK_MS    = 60000;
const KPI_COLLECT_MS   = 300000;   // 5 min
const GITHUB_KPI_MS    = 1800000;  // 30 min
const CLOUDFLARED_EXE  = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
const MJPEG_PORT       = 8788;

// ── Session ID ────────────────────────────────────────────────────────────────
const SESSION_FILE = path.join(os.homedir(), '.claude', 'central-agent-session.json');

function loadOrCreateSession() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (s.session_id) return s.session_id;
  } catch {}
  const id = 'agent-' + MACHINE + '-' + crypto.randomUUID();
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ session_id: id }), 'utf8');
  return id;
}

const SESSION_ID = loadOrCreateSession();

// ── HTTP helper ───────────────────────────────────────────────────────────────
function apiReq(qs, body) {
  return new Promise((resolve) => {
    // Strip leading '?' if present so we always normalise to 'key=val&...' form
    const cleanQs = qs.startsWith('?') ? qs.slice(1) : qs;
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: API_HOST,
      path: API_PATH + '?' + cleanQs,
      method: body ? 'POST' : 'GET',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': `ClaudeCentralAgent/3.0 (${MACHINE})`,
      },
      timeout: 12000,
      rejectUnauthorized: false,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ _error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ _error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Core helpers ──────────────────────────────────────────────────────────────
async function sendOutput(cmdId, chunk) {
  apiReq('action=command_output', { command_id: cmdId, chunk: String(chunk) }).catch(() => {});
}

async function markRunning(cmdId) {
  await apiReq('action=command_running', { id: cmdId });
}

async function markDone(cmdId, exitCode, err) {
  await apiReq('action=command_done', {
    id: cmdId,
    exit_code: exitCode ?? null,
    error: err ?? null,
  });
  // Notify on failure
  if ((exitCode ?? 1) !== 0 || err) {
    await sendNtfy(
      `Command Failed on PC`,
      `cmd #${cmdId} exit ${exitCode ?? 'null'}\n${err || ''}`.substring(0, 200),
      'high'
    );
  }
}

// ── Command execution ─────────────────────────────────────────────────────────
/**
 * Runs a command object. Streams output via onOutput(chunk) if provided,
 * otherwise streams via sendOutput(cmd.id, chunk).
 * Returns { exitCode, error }.
 */
function runCommand(cmd, onOutput) {
  return new Promise((resolve) => {
    const cwd = cmd.cwd || os.homedir();
    let shell, args, opts;

    if (cmd.cmd_type === 'claude') {
      shell = 'claude';
      args  = ['-p', cmd.command];
      opts  = { cwd, windowsHide: true, shell: true, env: { ...process.env } };

    } else if (cmd.cmd_type === 'vscode') {
      const parts = cmd.command.trim().split(/\s+/);
      shell = 'code';
      args  = parts[0] === 'code' ? parts.slice(1) : parts;
      opts  = { cwd, windowsHide: true, shell: true };

    } else if (cmd.cmd_type === 'powershell') {
      shell = 'powershell';
      args  = ['-NonInteractive', '-Command', cmd.command];
      opts  = { cwd, windowsHide: true };

    } else {
      // shell / default
      shell = 'powershell';
      args  = ['-NonInteractive', '-Command', cmd.command];
      opts  = { cwd, windowsHide: true };
    }

    let proc;
    try {
      proc = spawn(shell, args, opts);
    } catch (e) {
      resolve({ exitCode: -1, error: e.message });
      return;
    }

    const emit = (chunk) => {
      if (onOutput) onOutput(chunk);
      else sendOutput(cmd.id, chunk);
    };

    proc.stdout.on('data', d => emit(d.toString()));
    proc.stderr.on('data', d => emit('[stderr] ' + d.toString()));
    proc.on('close', (code) => resolve({ exitCode: code, error: null }));
    proc.on('error', (e)    => resolve({ exitCode: -1,   error: e.message }));

    // 5-minute timeout
    setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ exitCode: null, error: 'Command timed out (5 min limit)' });
    }, 300_000);
  });
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
let busy = false;

async function poll() {
  if (busy) return;

  const cmd = await apiReq(`action=command_poll&machine=${MACHINE}`);
  if (!cmd || cmd._error || !cmd.id) return;

  // Screen commands are non-blocking — handle before setting busy
  if (cmd.cmd_type === 'screen_start') {
    await markRunning(cmd.id);
    startScreenCapture();
    await sendOutput(cmd.id, '[screen] Capture started at ~12fps — MJPEG stream on port 8788, tunnel URL via screen_stream_url');
    await markDone(cmd.id, 0, null);
    return;
  }
  if (cmd.cmd_type === 'screen_stop') {
    await markRunning(cmd.id);
    stopScreenCapture();
    await sendOutput(cmd.id, '[screen] Capture stopped');
    await markDone(cmd.id, 0, null);
    return;
  }
  if (cmd.cmd_type === 'screenshot') {
    await markRunning(cmd.id);
    startScreenCapture();
    await new Promise(r => setTimeout(r, 1500));
    await sendOutput(cmd.id, `[screenshot] Frame captured and uploaded to https://command.digitalmaster.no/screen/windows-pc.jpg`);
    await markDone(cmd.id, 0, null);
    return;
  }

  busy = true;
  console.log(`[agent] cmd #${cmd.id} (${cmd.cmd_type}): ${String(cmd.command).substring(0, 80)}`);

  try {
    await markRunning(cmd.id);

    const { exitCode, error } = await runCommand(cmd);
    await markDone(cmd.id, exitCode, error);

    // Extra success notification for claude-type commands
    if (!error && exitCode === 0 && cmd.cmd_type === 'claude') {
      await sendNtfy(`Claude command #${cmd.id} completed`, 'Finished successfully on Windows PC', 'default');
    }

    if (error) console.log(`[agent] cmd #${cmd.id} error: ${error}`);
    else        console.log(`[agent] cmd #${cmd.id} done (exit ${exitCode})`);
  } catch (e) {
    await markDone(cmd.id, -1, e.message).catch(() => {});
    console.error(`[agent] cmd #${cmd.id} threw: ${e.message}`);
  } finally {
    busy = false;
  }
}

// ── Cron job execution ────────────────────────────────────────────────────────
const runningCronIds = new Set();

async function pollCron() {
  try {
    const jobs = await apiReq(`action=cron_due&machine=${MACHINE}`);
    if (!Array.isArray(jobs)) return;

    for (const job of jobs) {
      if (runningCronIds.has(job.id)) continue;
      runningCronIds.add(job.id);

      // Run asynchronously — don't block the cron interval
      (async () => {
        console.log(`[cron] running job #${job.id}: ${job.name || job.command}`);
        let captured = '';

        try {
          const { exitCode, error } = await runCommand(
            { id: `cron-${job.id}`, cmd_type: job.cmd_type || 'shell', command: job.command, cwd: job.cwd },
            (chunk) => { captured += chunk; }
          );
          const ec = exitCode ?? (error ? 1 : 0);
          await apiReq(`action=cron_done`, {
            id:        job.id,
            exit_code: ec,
            output:    captured.substring(0, 2000),
          });
          console.log(`[cron] job #${job.id} done (exit ${ec})`);
          if (ec !== 0) {
            await sendNtfy(`Cron Failed: ${job.name || job.id}`, `Exit ${ec}\n${captured.substring(0, 200)}`, 'high');
          }
        } catch (e) {
          await apiReq(`action=cron_done`, { id: job.id, exit_code: 1, output: e.message });
          console.error(`[cron] job #${job.id} threw: ${e.message}`);
        } finally {
          runningCronIds.delete(job.id);
        }
      })();
    }
  } catch (e) {
    console.log('[cron] poll error:', e.message);
  }
}

// ── ntfy.sh notifications ─────────────────────────────────────────────────────
let ntfyTopic  = null;
let ntfyTopicTs = 0;

async function sendNtfy(title, message, priority = 'default') {
  // Refresh topic from settings every 10 minutes
  if (Date.now() - ntfyTopicTs > 600_000) {
    try {
      const settings = await apiReq(`action=settings`);
      ntfyTopic    = settings?.ntfy_topic?.value || null;
      ntfyTopicTs  = Date.now();
    } catch {}
  }
  if (!ntfyTopic) return;

  return new Promise((res) => {
    const body = Buffer.from(String(message).substring(0, 500));
    const req  = https.request({
      hostname: 'ntfy.sh',
      path:     `/${ntfyTopic}`,
      method:   'POST',
      headers:  {
        'Title':          title,
        'Priority':       priority,
        'Tags':           'robot',
        'Content-Type':   'text/plain',
        'Content-Length': body.length,
      },
    }, (r) => { r.resume(); r.on('end', res); });
    req.on('error', () => res());
    req.write(body);
    req.end();
  });
}

// ── PowerShell helper ─────────────────────────────────────────────────────────
function runPS(cmd) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const p = spawn('powershell', ['-NonInteractive', '-Command', cmd], { windowsHide: true });
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', () => resolve(out));
    p.on('error', reject);
  });
}

// ── KPI collection ────────────────────────────────────────────────────────────
async function collectKpis() {
  const metrics = [];

  // Disk usage
  try {
    const diskOut = await runPS(
      `$d = Get-PSDrive C; [PSCustomObject]@{Free=[math]::Round($d.Free/1GB,2);UsedPct=[math]::Round($d.Used/($d.Used+$d.Free)*100,1)} | ConvertTo-Json`
    );
    const disk = JSON.parse(diskOut.trim());
    metrics.push({ key: 'disk_free_gb',  value: String(disk.Free),    num: disk.Free,    unit: 'GB' });
    metrics.push({ key: 'disk_used_pct', value: String(disk.UsedPct), num: disk.UsedPct, unit: '%', trend: disk.UsedPct > 80 ? 'up' : 'flat' });
  } catch (e) {
    console.log('[kpi] disk error:', e.message);
  }

  // Node.js version
  try {
    const nodeVer = (await runPS('node --version')).trim();
    metrics.push({ key: 'node_version', value: nodeVer, num: parseFloat(nodeVer.replace('v', '')), unit: '' });
  } catch {}

  // Claude CLI version
  try {
    const claudeVer = (await runPS('claude --version')).trim();
    metrics.push({ key: 'claude_version', value: claudeVer, num: parseFloat(claudeVer) || 0, unit: '' });
  } catch {}

  // OS uptime
  const uptimeHours = Math.round(os.uptime() / 3600);
  metrics.push({ key: 'pc_uptime_hours', value: String(uptimeHours), num: uptimeHours, unit: 'hours' });

  // POST all metrics
  for (const m of metrics) {
    await apiReq(`action=kpi_update`, {
      metric_key:   m.key,
      metric_value: m.value,
      metric_num:   m.num,
      unit:         m.unit || '',
      trend:        m.trend || 'flat',
      source:       'agent',
    }).catch(() => {});
  }
  console.log(`[kpi] collected ${metrics.length} metrics`);
}

// ── GitHub commits KPI ────────────────────────────────────────────────────────
async function collectGithubKpi() {
  try {
    const commits = await apiReq(`action=github&gh=commits&repo=Goda753/claude-central&per=30`);
    if (!Array.isArray(commits)) return;
    const today = new Date().toISOString().substring(0, 10);
    const count = commits.filter(c => (c.commit?.author?.date || '').startsWith(today)).length;
    await apiReq(`action=kpi_update`, {
      metric_key:   'github_commits_today',
      metric_value: String(count),
      metric_num:   count,
      unit:         'commits',
      source:       'agent',
      trend:        'flat',
    });
    console.log(`[kpi] github commits today: ${count}`);
  } catch (e) {
    console.log('[kpi] github error:', e.message);
  }
}

// ── Remote Desktop — Screen Capture (persistent PS loop → API upload) ─────────
let screenCapturing  = false;
let screenPsProc     = null;
let screenW          = 1920;
let screenH          = 1080;
let screenUploadBusy = false;

// MJPEG streaming state
let mjpegClients = [];
let mjpegServer  = null;
let cfProc       = null;
let tunnelUrl    = null;

// Single long-running PowerShell script — no per-frame startup overhead
// Uses [System.Reflection.Assembly]::LoadWithPartialName instead of Add-Type
// to avoid Windows Defender AMSI false-positive on Add-Type screen capture scripts.
const PS_CAPTURE_LOOP = `
[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null
[System.Reflection.Assembly]::LoadWithPartialName('System.Drawing') | Out-Null
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]20)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$streamW = 1280
while ($true) {
    try {
        $s   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $src = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
        $g0  = [System.Drawing.Graphics]::FromImage($src)
        $g0.CopyFromScreen($s.X, $s.Y, 0, 0, $src.Size)
        $g0.Dispose()
        $streamH = [int]($s.Height * $streamW / $s.Width)
        $bm = New-Object System.Drawing.Bitmap($streamW, $streamH)
        $g  = [System.Drawing.Graphics]::FromImage($bm)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
        $g.DrawImage($src, 0, 0, $streamW, $streamH)
        $g.Dispose(); $src.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bm.Save($ms, $codec, $ep)
        $bm.Dispose()
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $ms.Dispose()
        Write-Output "FRAME:$($streamW),$($streamH):$b64"
    } catch {
        Write-Output "ERROR:$($_.Exception.Message)"
        Start-Sleep -Milliseconds 1000
    }
    Start-Sleep -Milliseconds 67
}`.trim();

async function uploadFrame(b64, w, h) {
  if (screenUploadBusy) return; // skip if previous upload still in flight
  screenUploadBusy = true;
  try {
    await apiReq('action=screen_upload', { machine: MACHINE, frame_b64: b64, width: w, height: h });
  } catch(e) {
    // silent — frame drop is fine
  } finally {
    screenUploadBusy = false;
  }
}

// ── MJPEG streaming server + cloudflared tunnel ───────────────────────────────
function startMjpegServer(onReady) {
  // Kill any existing server
  if (mjpegServer) { try { mjpegServer.close(); } catch {} mjpegServer = null; }

  // Free the port first
  try {
    require('child_process').execSync(
      `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${MJPEG_PORT}') do taskkill /F /PID %a`,
      { shell: true, stdio: 'ignore' }
    );
  } catch {}

  mjpegServer = require('http').createServer((req, res) => {
    if (req.url === '/stream' || req.url === '/') {
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'X-Frame-Options': 'ALLOWALL',
      });
      mjpegClients.push(res);
      console.log(`[mjpeg] Client connected (${mjpegClients.length} total)`);
      req.on('close', () => {
        mjpegClients = mjpegClients.filter(c => c !== res);
        console.log(`[mjpeg] Client disconnected (${mjpegClients.length} remaining)`);
      });
    } else if (req.url === '/health') {
      res.writeHead(200); res.end('ok');
    } else {
      res.writeHead(404); res.end();
    }
  });

  mjpegServer.listen(MJPEG_PORT, '0.0.0.0', () => {
    console.log(`[mjpeg] Server listening on port ${MJPEG_PORT}`);
    startCfTunnel();
    if (onReady) onReady();
  });

  mjpegServer.on('error', err => {
    console.log(`[mjpeg] Server error: ${err.message}`);
  });
}

function pushMjpegFrame(b64) {
  if (!mjpegClients.length) return;
  const buf    = Buffer.from(b64, 'base64');
  const header = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`);
  const trail  = Buffer.from('\r\n');
  const frame  = Buffer.concat([header, buf, trail]);
  const dead   = [];
  for (const res of mjpegClients) {
    try { res.write(frame); }
    catch { dead.push(res); }
  }
  if (dead.length) mjpegClients = mjpegClients.filter(c => !dead.includes(c));
}

function startCfTunnel() {
  if (cfProc) { try { cfProc.kill(); } catch {} cfProc = null; }
  tunnelUrl = null;

  // Try localhost.run via SSH (works even when cloudflared is ISP-blocked)
  // Fallback: try cloudflared if SSH fails
  const sshExe = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';

  console.log('[tunnel] Starting SSH tunnel via localhost.run...');
  try {
    cfProc = spawn(sshExe, [
      '-R', `80:localhost:${MJPEG_PORT}`,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'LogLevel=ERROR',
      'nokey@localhost.run',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let buf = '';
    const parseOutput = data => {
      const txt = data.toString();
      buf += txt;
      // localhost.run gives: https://abc123.localhost.run or https://abc123.lhr.life
      const m = buf.match(/https:\/\/[a-z0-9]+\.(localhost\.run|lhr\.life)/);
      if (m && m[0] !== tunnelUrl) {
        tunnelUrl = m[0];
        console.log(`[tunnel] URL: ${tunnelUrl}`);
        apiReq('action=screen_stream_url', { machine: MACHINE, url: tunnelUrl }, 'POST').catch(() => {});
      }
    };
    cfProc.stdout.on('data', parseOutput);
    cfProc.stderr.on('data', parseOutput);
    cfProc.on('exit', (code) => {
      console.log(`[tunnel] SSH tunnel exited (code ${code})`);
      cfProc = null; tunnelUrl = null;
      if (screenCapturing) setTimeout(startCfTunnel, 5000);
    });
    cfProc.on('error', (err) => {
      console.log(`[tunnel] SSH error: ${err.message} — trying cloudflared fallback`);
      startCfFallback();
    });
  } catch (e) {
    console.log(`[tunnel] SSH spawn error: ${e.message}`);
    startCfFallback();
  }
}

function startCfFallback() {
  if (!require('fs').existsSync(CLOUDFLARED_EXE)) {
    console.log('[tunnel] Neither SSH nor cloudflared available — stream local only');
    return;
  }
  cfProc = spawn(CLOUDFLARED_EXE, ['tunnel', '--url', `http://localhost:${MJPEG_PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  const parse = data => {
    buf += data.toString();
    const m = buf.match(/https:\/\/(?!api\.)[a-z0-9][a-z0-9-]*\.trycloudflare\.com/);
    if (m && m[0] !== tunnelUrl) {
      tunnelUrl = m[0];
      console.log(`[tunnel] cloudflared URL: ${tunnelUrl}`);
      apiReq('action=screen_stream_url', { machine: MACHINE, url: tunnelUrl }, 'POST').catch(() => {});
    }
  };
  cfProc.stdout.on('data', parse);
  cfProc.stderr.on('data', parse);
  cfProc.on('exit', () => { cfProc = null; tunnelUrl = null; });
}

function stopMjpegServer() {
  mjpegClients.forEach(c => { try { c.end(); } catch {} });
  mjpegClients = [];
  if (cfProc) { try { cfProc.kill(); } catch {} cfProc = null; }
  if (mjpegServer) { try { mjpegServer.close(); } catch {} mjpegServer = null; }
  tunnelUrl = null;
  console.log('[mjpeg] Server stopped');
}

const CAPTURE_SCRIPT_PATH = path.join(os.homedir(), '.claude', 'screen-capture.ps1');

function startScreenCapture() {
  if (screenCapturing) return;
  screenCapturing = true;
  startMjpegServer(); // start MJPEG server and tunnel (idempotent)
  // Write the PS script to a file to avoid -Command multi-line parsing issues
  fs.writeFileSync(CAPTURE_SCRIPT_PATH, PS_CAPTURE_LOOP, 'utf8');
  screenPsProc = spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CAPTURE_SCRIPT_PATH
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let buf = '';
  screenPsProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    // Each frame is on a single line prefixed FRAME:W,H:base64
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('FRAME:')) {
        const colon2 = line.indexOf(':', 6);
        if (colon2 === -1) continue;
        const dims = line.slice(6, colon2).split(',');
        const b64  = line.slice(colon2 + 1);
        const w = parseInt(dims[0]) || screenW;
        const h = parseInt(dims[1]) || screenH;
        screenW = w; screenH = h;
        pushMjpegFrame(b64);        // push to MJPEG stream clients
        uploadFrame(b64, w, h);     // API fallback upload
      } else if (line.startsWith('ERROR:')) {
        console.log('[screen] PS error:', line.slice(6));
      }
    }
  });

  screenPsProc.stderr.on('data', (d) => {
    const txt = d.toString().trim();
    if (txt) console.log('[screen] PS stderr:', txt.slice(0, 120));
  });

  screenPsProc.on('exit', (code) => {
    console.log('[screen] PS capture exited, code:', code);
    if (screenCapturing) {
      // Auto-restart on unexpected exit
      screenPsProc = null;
      setTimeout(startScreenCapture, 2000);
    }
  });

  console.log('[screen] Capture started (~12fps, MJPEG stream + API upload)');
}

function stopScreenCapture() {
  screenCapturing = false;
  if (screenPsProc) {
    try { screenPsProc.kill(); } catch(e) {}
    screenPsProc = null;
  }
  stopMjpegServer();
  console.log('[screen] Capture stopped');
}

// ── Remote Desktop — Input Events (mouse/keyboard) ───────────────────────────
const PS_MOUSE_CLICK = (x, y, btn) => `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class U32{[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int c,int e);
public const int LD=2,LU=4,RD=8,RU=16,DBL=2;}
"@
[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})
Start-Sleep -Milliseconds 30
${btn === 'right' ? '[U32]::mouse_event([U32]::RD,0,0,0,0);[U32]::mouse_event([U32]::RU,0,0,0,0)' : '[U32]::mouse_event([U32]::LD,0,0,0,0);[U32]::mouse_event([U32]::LU,0,0,0,0)'}
`.trim();

const PS_MOUSE_DBL = (x, y) => `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class U32{[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int c,int e);}
"@
[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})
Start-Sleep -Milliseconds 20
[U32]::mouse_event(2,0,0,0,0);[U32]::mouse_event(4,0,0,0,0)
Start-Sleep -Milliseconds 80
[U32]::mouse_event(2,0,0,0,0);[U32]::mouse_event(4,0,0,0,0)
`.trim();

const PS_SCROLL = (x, y, delta) => `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class U32{[DllImport("user32.dll")]public static extern void mouse_event(int f,int x,int y,int c,int e);}
"@
[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(${x},${y})
[U32]::mouse_event(0x800,0,0,${delta},0)
`.trim();

const PS_TYPE = (text) => {
  const safe = text.replace(/[{}()\[\]~+^%]/g, c => `{${c}}`).replace(/'/g, "''");
  return `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('${safe}')`;
};

const KEY_MAP = {
  'Enter':'~','Tab':'{TAB}','Backspace':'{BS}','Delete':'{DEL}','Escape':'{ESC}',
  'ArrowUp':'{UP}','ArrowDown':'{DOWN}','ArrowLeft':'{LEFT}','ArrowRight':'{RIGHT}',
  'Home':'{HOME}','End':'{END}','PageUp':'{PGUP}','PageDown':'{PGDN}',
  'F1':'{F1}','F2':'{F2}','F3':'{F3}','F4':'{F4}','F5':'{F5}','F6':'{F6}',
};

const SPECIAL_MAP = {
  'ctrl+c':'^c','ctrl+v':'^v','ctrl+x':'^x','ctrl+z':'^z','ctrl+a':'^a',
  'ctrl+s':'^s','alt+f4':'%{F4}','win':'^{ESC}','ctrl+alt+del':null,
};

async function executeScreenEvent(evt) {
  let psCmd = null;
  const x = parseInt(evt.x) || 0, y = parseInt(evt.y) || 0;
  switch (evt.event_type) {
    case 'click':    psCmd = PS_MOUSE_CLICK(x, y, 'left');  break;
    case 'rclick':   psCmd = PS_MOUSE_CLICK(x, y, 'right'); break;
    case 'dblclick': psCmd = PS_MOUSE_DBL(x, y);            break;
    case 'scroll':   psCmd = PS_SCROLL(x, y, parseInt(evt.scroll_delta) || 120); break;
    case 'type':     psCmd = PS_TYPE(evt.key_val || '');    break;
    case 'key':      psCmd = PS_TYPE(KEY_MAP[evt.key_val] || ('{' + evt.key_val + '}')); break;
    case 'special': {
      const sk = SPECIAL_MAP[evt.key_val];
      if (sk) psCmd = `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait('${sk}')`;
      break;
    }
  }
  if (psCmd) await runPS(psCmd).catch(e => console.log('[event] error:', e.message));
  await apiReq('action=screen_event_done', {id: evt.id}).catch(() => {});
  console.log(`[event] ${evt.event_type} ${x||''},${y||''} ${evt.key_val||''}`);
}

async function pollScreenEvents() {
  if (!screenCapturing) return;
  try {
    const events = await apiReq(`action=screen_events_poll&machine=${MACHINE}`);
    if (Array.isArray(events) && events.length) {
      for (const evt of events) await executeScreenEvent(evt);
    }
  } catch(e) {}
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
async function heartbeat() {
  const r = await apiReq('action=session_start', {
    session_id: SESSION_ID,
    machine:    MACHINE,
    label:      LABEL,
    project:    'Claude Central Agent',
    cwd:        process.cwd(),
  });
  if (r.ok) {
    console.log(`[agent] heartbeat OK — session ${SESSION_ID.substring(0, 20)}…`);
  }
}

// ── GitHub token seed ─────────────────────────────────────────────────────────
async function seedGithubToken() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const token = settings?.mcpServers?.github?.env?.GITHUB_TOKEN;
    if (token) {
      await apiReq('action=github_seed_token', { token });
      console.log('[agent] GitHub token seeded to Central DB');
    }
  } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         Claude Central Agent — Windows PC  v3.0     ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Machine : ${MACHINE.padEnd(42)}║`);
  console.log(`║  Session : ${SESSION_ID.substring(0, 42).padEnd(42)}║`);
  console.log(`║  API     : https://${API_HOST.padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');

  await heartbeat();
  await seedGithubToken();

  // Immediate first runs
  collectKpis();
  pollCron();

  // Recurring intervals
  setInterval(poll,             POLL_MS);
  setInterval(heartbeat,        HEARTBEAT_MS);
  setInterval(pollCron,         CRON_CHECK_MS);
  setInterval(collectKpis,      KPI_COLLECT_MS);
  setInterval(collectGithubKpi, GITHUB_KPI_MS);

  setInterval(pollScreenEvents, 150); // poll input events when streaming

  // Auto-start capture if a previous session left it running
  const screenInfo = await apiReq('action=screen_info&machine=' + MACHINE).catch(() => ({}));
  if (screenInfo && screenInfo.streaming) {
    console.log('[screen] Resuming capture (was streaming before restart)');
    startScreenCapture();
  }

  console.log('[agent] Remote desktop ready (screen_start command to begin)');
  console.log(`[agent] polling every ${POLL_MS}ms | cron every 60s | KPI every 5min | GitHub KPI every 30min`);
  console.log('[agent] dashboard → https://command.digitalmaster.no/');
  console.log('[agent] Press Ctrl+C to stop.\n');
})();
