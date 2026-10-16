# dot の個人ライブラリを使う HMR 開発版を再起動する。
# 検証は pnpm run app:debug の所有 pipe セッションで行う。
#
# STOPPING: the app is asked to quit; nothing is hunted down and killed.
#
#   A throwaway launch carrying --dot-quit loses Electron's single-instance lock and
#   hands its argv to whoever holds it; the holder quits itself (app/src/main/index.ts, via
#   restart-signal.ts). The lock is keyed on app name + userData, i.e. on WHICH CONFIG DIR
#   an instance opened — which is the actual definition of "the real app" and the one thing
#   no external filter could ever read. Everything this script matched on before was a
#   proxy for it and each proxy failed on one side: a '*dot*' path substring swept up
#   worktree test instances (2026-08-05), the --remote-debugging-port marker missed
#   instances launched without it (#1004), and the exact exe path still could not tell the
#   real app from a sandbox started out of THIS tree (scripts/sandbox-app.cts runs the
#   identical binary and differs only by env). A sandbox holds a different lock, so it
#   simply never hears the signal now.
#
#   The same throwaway launch doubles as the probe for "is it gone yet": exit 3 means an
#   instance was there and has been told to quit, exit 0 means nothing was running. Polling
#   that is what lets the new instance start only once the lock is actually free — asking
#   Windows for a process list to find that out would put the guessing straight back in.
#
#   Process matching survives in Get-DotProcs as the FROZEN-APP FALLBACK only: an
#   instance whose message loop is stuck never answers the signal. It is a last resort and
#   it does over-match (a sandbox from this tree shares the exe path), so it runs only after
#   the polite path has timed out, and it says so.
#
# This used to go through a 'DotLaunch' scheduled task. TWO reasons, both now gone:
#
#   - The ORIGINAL one expired on 2026-08-06 (#1003): the automation host used to live inside
#     an MSIX package, so a directly-spawned electron.exe was a child
#     of that container with HKCU + filesystem virtualized, and the app would register the
#     native-messaging host into a private hive the real Chrome could not see. The current host
#     now runs outside the package; FS and HKCU reads and writes were all measured as real.
#     Note the layout changed once and could change back — the check is whether
#     (Get-Item <path>).Target points into ...\Packages\<pkg>\LocalCache\...
#   - After that, all the task still bought was "the launched app is not a child of the
#     calling shell". Measured on 2026-08-07 (#1008): Start-Process gives that too. An
#     Electron launched this way outlived both the powershell.exe that started it and the
#     agent shell above that, kept answering CDP (scripts/cdp-verify.cts connected to it),
#     and was selected by the command-line filter of the day — while an instance on a
#     different port was correctly NOT selected. So the ~40 lines of task registration,
#     action-drift detection and self-healing bought nothing, and cost a failure mode of
#     their own: Start-ScheduledTask reports SUCCESS even when its Execute does not exist,
#     so a stale action printed 完了 while nothing started. Start-Process throws instead.
#
# The task may still exist on this machine; this script no longer creates, repairs or uses
# it. Whether to delete it is open (the user may have a shortcut pointing at it) — #1008.
#
# What a direct launch does NOT inherit for free is the task's clean environment, so the
# env block below builds one. See the comment there.

# This script lives in scripts/ alongside the other dev-instance tooling
# (sandbox-app.cts, cdp-verify.cts), so every repo path below hangs off the PARENT of
# $PSScriptRoot. Right-clicking it still works from here.
$repoRoot = Split-Path $PSScriptRoot -Parent
$app      = Join-Path $repoRoot 'app'
$logFile  = Join-Path $HOME '.dot\restart-app.log'

# Electron は app から解決する。pnpm の hoisted 配置も確認する。
$electron = @(
  (Join-Path $app 'node_modules\electron\dist\electron.exe'),
  (Join-Path $repoRoot 'node_modules\electron\dist\electron.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# Label the window so a right-click launch is self-explanatory (guarded: some hosts lack RawUI).
try { $Host.UI.RawUI.WindowTitle = 'dot 再起動' } catch {}

# On failure: log, and keep the window open ONLY for an interactive (human) launch so the
# error is never missed. When automation runs this headlessly stdin is redirected -> skip the
# prompt so automation never blocks. Default to NOT blocking if the check itself fails.
function Stop-WithError($message) {
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format o), $message) -ErrorAction SilentlyContinue
  $interactive = $false
  try { $interactive = -not [Console]::IsInputRedirected } catch { $interactive = $false }
  if ($interactive) {
    Write-Host 'エラーを確認したら Enter キー（または×ボタン）で閉じてください。' -ForegroundColor Yellow
    try { [void](Read-Host) } catch { }
  }
  exit 1
}

if (-not $electron) {
  Stop-WithError("electron.exe が見つかりません（app/node_modules と リポジトリ直下の node_modules の両方を確認しました）。`n" +
    "pnpm run setup を実行してください")
}

# Refuse to spawn anything when the app is not built, BEFORE the stop loop rather than at
# the launch below: `electron <app>` with no main entry puts an OS modal ("Unable to find
# Electron app at ...") in front of whatever the user is doing, once per launch — and the
# stop loop launches repeatedly, so an unbuilt tree would produce a stack of them. Same
# precondition scripts/lib-electron-path.cts enforces for the test harnesses (#460).
$appEntry = Join-Path $app 'out\main\index.js'
if (-not (Test-Path $appEntry)) {
  Stop-WithError("app がビルドされていません（$appEntry が有りません）。pnpm run app:build を実行してください")
}

# Give the app the environment a clean launch needs. Start-Process inherits THIS shell's
# environment, and the shells that run this script are
# frequently ones a verify workflow has exported into: DOT_CONFIG_DIR would point the
# "real" app at a sandbox config (measured — it comes up on an empty library and looks like
# data loss), DOT_SANDBOX would skip native-host registration, DOT_SMOKE would
# hide the window. ELECTRON_RENDERER_URL would load the renderer from a dev server that is
# not running. APPDATA is restored from the shell folder, which ignores the env override.
#
# This has to happen BEFORE the stop loop, not just before the launch: the single-instance
# lock the signal travels on is keyed on userData, so a leftover DOT_CONFIG_DIR would
# aim the "please quit" at whatever sandbox that variable names instead of at the real app.
Get-ChildItem Env: | Where-Object { $_.Name -like 'DOT_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
foreach ($debugKey in @('REMOTE_DEBUGGING_PORT', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_CLI_ARGS', 'V8_INSPECTOR_PORT', 'V8_INSPECTOR_BRK_PORT')) {
  Remove-Item ('Env:' + $debugKey) -ErrorAction SilentlyContinue
}
$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')


# FALLBACK ONLY — see the header. Front-anchored on the resolved $electron path (Windows
# quotes the exe in the command line when nothing forces it not to, but not always, so match
# both forms). It catches every instance run from this binary, INCLUDING a sandbox started
# from this tree, which is why nothing but a timed-out signal may reach it.
function Get-DotProcs {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "`"$electron`"*" -or $_.CommandLine -like "$electron *" } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

Write-Host 'dot(electron) に終了を伝えています...' -ForegroundColor Cyan
$stopped   = $false
$signalled = $false
$deadline  = (Get-Date).AddSeconds(20)
do {
  try {
    $probe = Start-Process -FilePath $electron -ArgumentList "`"$app`" --dot-quit" -WorkingDirectory $repoRoot -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
  } catch {
    Stop-WithError("終了の合図を送れませんでした: $($_.Exception.Message)")
  }
  # 0 = nothing was running, 3 = an instance was there and has been told to quit.
  # Anything else means the app died on the way up rather than answering, and retrying
  # would just repeat it — app/src/main/restart-signal.ts owns these numbers.
  if ($probe.ExitCode -eq 0) { $stopped = $true; break }
  if ($probe.ExitCode -ne 3) {
    Stop-WithError("終了の合図に予期しない終了コードが返りました（$($probe.ExitCode)）。app のビルドが壊れている可能性があります: pnpm run app:build")
  }
  $signalled = $true
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $stopped) {
  # The polite path timed out: the app is up but its message loop is not answering.
  # This is the over-matching path — say so, because it can take a sandbox instance
  # started from this same tree with it.
  Write-Host '応答がないため、実行ファイルのパス一致で強制終了します（このツリーから起動したサンドボックスも巻き添えになります）。' -ForegroundColor Yellow
  Get-DotProcs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

$pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $pnpm) { Stop-WithError('pnpm が見つかりません。pnpm run setup を実行した環境で起動してください') }
try {
  Start-Process -FilePath $pnpm -ArgumentList 'run app:dev' -WorkingDirectory $repoRoot -WindowStyle Hidden -ErrorAction Stop
} catch { Stop-WithError("dot の起動に失敗しました: $($_.Exception.Message)") }
# 非同期の HMR ランチャーの開始と、アプリの準備完了は区別する。
# 同じバイナリのサンドボックスを準備完了と誤認しない。
Write-Host 'HMR 開発版の起動処理を背面で開始しました。アプリの準備完了は未確認です。' -ForegroundColor Cyan
