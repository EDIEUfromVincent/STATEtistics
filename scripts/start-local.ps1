$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TabPfnScript = Join-Path $PSScriptRoot "start-tabpfn.ps1"

Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$TabPfnScript`"" -WorkingDirectory $ProjectRoot -WindowStyle Hidden
Set-Location $ProjectRoot
npm run dev
