param()
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskBuild = Join-Path $taskRoot '.sandbox/native-host-launcher-build'
$taskOutput = Join-Path $taskRoot 'app/vendor/native-host-launcher'
$taskSource = Join-Path $taskRoot 'native-host-launcher'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path -LiteralPath $vswhere)) { throw 'MSIX のホスト入口をビルドするには Visual Studio C++ Build Tools が必要です。' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual Studio の x64 C++ Build Tools が見つかりません。' }
$developerCommand = Join-Path $installation 'Common7/Tools/VsDevCmd.bat'
New-Item -ItemType Directory -Force -Path $taskBuild | Out-Null
$taskCompilerCommand = 'call "{0}" -arch=x64 -host_arch=x64 >nul && cl.exe /nologo /utf-8 /O2 /MT /EHsc /std:c++17 /DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /DNOMINMAX "{1}" /Fo"{2}" /Fe"{3}" /link /SUBSYSTEM:CONSOLE' -f $developerCommand, (Join-Path $taskSource 'launcher.cpp'), (Join-Path $taskBuild 'launcher.obj'), (Join-Path $taskBuild 'dot-native-host.exe')
& $env:ComSpec /d /s /c $taskCompilerCommand
if ($LASTEXITCODE -ne 0) { throw 'ホスト入口のビルドに失敗しました。' }
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
Copy-Item -LiteralPath (Join-Path $taskBuild 'dot-native-host.exe') -Destination (Join-Path $taskOutput 'dot-native-host.exe') -Force
