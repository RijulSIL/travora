# Starts the Travora backend, first killing any process already bound to the
# port. uvicorn --reload spawns its actual worker via Python's multiprocessing
# on Windows, so the process holding the socket is often a *child* of the PID
# netstat reports, not that PID itself — killing just the parent with
# Stop-Process leaves the child (and the socket) alive, and it silently keeps
# answering requests with old code forever after. taskkill /T kills the whole
# tree, which is what actually frees the port.

param(
    [int]$Port = 9200
)

$owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

foreach ($procId in $owners) {
    Write-Host "Killing stale process tree on port $Port (PID $procId)"
    taskkill /PID $procId /T /F *>$null
}

# Belt-and-suspenders: also sweep any already-orphaned multiprocessing children
# left over from a previous run whose parent is long gone, regardless of port.
Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%multiprocessing.spawn%'" -ErrorAction SilentlyContinue |
    ForEach-Object {
        if (-not (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)" -ErrorAction SilentlyContinue)) {
            Write-Host "Killing orphaned multiprocessing child (PID $($_.ProcessId))"
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }

if ($owners) {
    Start-Sleep -Seconds 1
}

Set-Location $PSScriptRoot
& ".\.venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 0.0.0.0 --port $Port
