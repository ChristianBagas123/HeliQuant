# agents-LocalReady — run your local HeliQuant engine on Windows (no Docker).
$ErrorActionPreference = "Stop"

if (-not $env:HQ_REPO_URL) { throw "set HQ_REPO_URL to the project's public repository URL" }
if (-not (Test-Path repo)) { Write-Host "cloning firm..."; git clone --depth 1 $env:HQ_REPO_URL repo }
Push-Location repo\agents
if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install --upgrade pip | Out-Null
& $py -m pip install -r requirements.txt "uvicorn[standard]"

# load ..\..\.env into the process environment so the firm sees HQ_OWNER_ACCOUNT etc.
if (Test-Path ..\..\.env) {
  Get-Content ..\..\.env | ForEach-Object {
    if ($_ -match "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$") {
      [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2].Trim())
    }
  }
}

# self-pinger: drive the cycle locally every 4 min
Start-Job -ScriptBlock {
  while ($true) { Start-Sleep 240; try { Invoke-WebRequest "http://127.0.0.1:8000/run-cycle" -UseBasicParsing -TimeoutSec 10 | Out-Null } catch {} }
} | Out-Null

Write-Host "engine on http://localhost:8000 — in another terminal run:  ngrok http 8000"
& $py -m uvicorn app:app --host 0.0.0.0 --port 8000
