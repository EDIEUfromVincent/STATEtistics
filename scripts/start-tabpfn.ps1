$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TabPfnRepo = Join-Path $ProjectRoot "work\TabPFN"
$CodexRoot = (Resolve-Path (Join-Path $ProjectRoot "..\..")).Path
$VirtualEnv = Join-Path $CodexRoot "work\statetistic-tabpfn"
$PythonExe = Join-Path $VirtualEnv "Scripts\python.exe"
$Service = Join-Path $ProjectRoot "services\tabpfn_service.py"

if (-not (Test-Path (Join-Path $TabPfnRepo ".git"))) {
    Write-Host "TabPFN source is missing. Downloading it to work\TabPFN..."
    git clone --depth 1 https://github.com/PriorLabs/TabPFN.git $TabPfnRepo
}

if (-not (Test-Path $PythonExe)) {
    Write-Host "Creating an isolated Python environment..."
    New-Item -ItemType Directory -Path (Split-Path $VirtualEnv -Parent) -Force | Out-Null
    python -m venv $VirtualEnv
}

$PreviousPreference = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
& $PythonExe -c "import tabpfn" 2>$null
$TabPfnInstalled = $LASTEXITCODE -eq 0
$ErrorActionPreference = $PreviousPreference
if (-not $TabPfnInstalled) {
    Write-Host "Installing TabPFN and its local dependencies. The first setup can take several minutes..."
    & $PythonExe -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
    & $PythonExe -m pip install -e $TabPfnRepo
    if ($LASTEXITCODE -ne 0) { throw "TabPFN installation failed." }
}

Write-Host ""
Write-Host "Starting the STATEtistic TabPFN engine on http://127.0.0.1:8765"
& $PythonExe $Service
