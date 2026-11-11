import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const POLL_PS1 = String.raw`param([string]$OutFile)
$ErrorActionPreference = 'SilentlyContinue'
# Add-Type needs a writable %TEMP% for its compile temp file. Restricted
# environments may deny it, so point TEMP at the app's own data\tmp folder.
# NOTE: keep this script ASCII-only - it is written without a BOM.
$tmp = Join-Path (Split-Path -Parent $OutFile) 'tmp'
if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Force -Path $tmp | Out-Null }
$env:TEMP = $tmp
$env:TMP = $tmp
$fg = $null
$wins = @()
$reason = ''
try {
  Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class FGWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
}
"@
  $map = @{}
  foreach ($p in (Get-Process)) { $map[[uint32]$p.Id] = $p.ProcessName }
  $script:fgp = [FGWin]::GetForegroundWindow()
  if ($script:fgp -ne [IntPtr]::Zero) {
    $sb = New-Object System.Text.StringBuilder 1024
    [void][FGWin]::GetWindowText($script:fgp, $sb, 1024)
    $fpid = [uint32]0
    [void][FGWin]::GetWindowThreadProcessId($script:fgp, [ref]$fpid)
    $fgname = $map[$fpid]
    if (-not $fgname) { $fgname = (Get-Process -Id $fpid).ProcessName }
    $fg = @{ title = $sb.ToString().Trim(); proc = [string]$fgname; pid = [int]$fpid }
  }
  $collected = New-Object System.Collections.ArrayList
  $cb = [FGWin+EnumWindowsProc]{
    param($h, $extra)
    if ($collected.Count -ge 24) { return $true }
    if (-not [FGWin]::IsWindowVisible($h)) { return $true }
    $sb2 = New-Object System.Text.StringBuilder 1024
    [void][FGWin]::GetWindowText($h, $sb2, 1024)
    $t = $sb2.ToString().Trim()
    if ($t.Length -eq 0) { return $true }
    $wpid = [uint32]0
    [void][FGWin]::GetWindowThreadProcessId($h, [ref]$wpid)
    $wname = $map[$wpid]
    if (-not $wname) { $wname = (Get-Process -Id $wpid).ProcessName }
    [void]$collected.Add(@{ title = $t; proc = [string]$wname; pid = [int]$wpid })
    return $true
  }
  [void][FGWin]::EnumWindows($cb, [IntPtr]::Zero)
  $wins = @($collected)
} catch {
  $reason = 'addtype: ' + $_.Exception.Message
}
if ($null -eq $fg -and $wins.Count -eq 0) {
  $wins = @(Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 24 | ForEach-Object { @{ title = $_.MainWindowTitle; proc = $_.ProcessName; pid = $_.Id } })
  if ($null -eq $fg -and $wins.Count -eq 0 -and $reason -eq '') { $reason = 'no-windows' }
}
$result = @{ foreground = $fg; windows = $wins; reason = $reason }
$json = $result | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
`

export class ForegroundReader {
  constructor(dataDir) {
    this.dataDir = dataDir
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    this.scriptPath = join(dataDir, 'poll-foreground.ps1')
    this.outPath = join(dataDir, 'poll-out.txt')
    writeFileSync(this.scriptPath, POLL_PS1, 'utf8')
    this.lastError = ''
  }

  /**
   * 读取前台窗口。优先使用 GetForegroundWindow，读不到时退化为 Z 序最顶层可见窗口。
   * @returns {{title:string, proc:string, source:string}|null}
   */
  read() {
    this.lastError = ''
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath, '-OutFile', this.outPath,
    ], { timeout: 12000, windowsHide: true, stdio: 'ignore' })
    if (result.error) {
      this.lastError = 'PowerShell 启动失败：' + result.error.message
      return null
    }
    let data = null
    try {
      data = JSON.parse(readFileSync(this.outPath, 'utf8').replace(/^\uFEFF/, '').trim())
    } catch (error) {
      this.lastError = '读取窗口信息失败：' + (error.message || error)
      return null
    }
    if (!data || typeof data !== 'object') {
      this.lastError = '窗口信息格式异常'
      return null
    }
    const fg = data.foreground
    if (fg && typeof fg.title === 'string' && fg.title.trim()) {
      return { title: fg.title.trim(), proc: String(fg.proc || ''), source: 'foreground' }
    }
    const list = Array.isArray(data.windows) ? data.windows : []
    const top = list.find((item) => item && typeof item.title === 'string' && item.title.trim())
    if (top) return { title: top.title.trim(), proc: String(top.proc || ''), source: 'zorder' }
    const reason = String(data.reason || '')
    if (reason.startsWith('addtype')) {
      this.lastError = '读不到窗口：PowerShell 无法编译 P/Invoke（' + reason.slice(8).trim().slice(0, 120) + '）。多半被组策略/AppLocker 限制，请运行应用目录下的 diagnose.cmd 查看详情'
    } else if (reason === 'no-windows') {
      this.lastError = '看不到任何窗口：请用当前登录账户直接双击桌面快捷方式启动（不要用别的账户的管理员身份、任务计划或服务启动）'
    } else {
      this.lastError = '前台窗口为空，且没有可见窗口'
    }
    return null
  }
}
