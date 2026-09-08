# Starts the Travora backend, first killing any process already bound to
# the port (leftover uvicorn --reload orphans from an improperly closed
# terminal are the #1 cause of "connection refused" on next launch).

param(
    [int]$Port = 8000
)

$owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

foreach ($procId in $owners) {
    Write-Host "Killing stale process on port $Port (PID $procId)"
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
}

if ($owners) {
    Start-Sleep -Seconds 1
}

Set-Location $PSScriptRoot
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port $Port
