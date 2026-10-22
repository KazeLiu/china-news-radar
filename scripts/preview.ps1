param([switch]$Restart)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$root = Split-Path -Parent $PSScriptRoot
$worker = Join-Path $PSScriptRoot 'preview-service.cjs'
$stateDir = Join-Path $root '.cache\preview'
$services = @(
    @{ Name = 'server'; Port = 3421; Url = 'http://127.0.0.1:3421/api/news/health' },
    @{ Name = 'client'; Port = 3420; Url = 'http://127.0.0.1:3420/admin' }
)

function Get-ManagedProcess($service) {
    $record = Join-Path $stateDir "$($service.Name).json"
    if (!(Test-Path -LiteralPath $record)) { return $null }
    $saved = Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
    $running = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$saved.Id)"
    if ($running -and $running.CommandLine -and $running.CommandLine.Contains($worker) -and
        $running.CommandLine.TrimEnd().EndsWith(" $($service.Name)") -and
        $running.CreationDate.ToUniversalTime().ToString('o') -eq ([datetime]$saved.CreatedAt).ToUniversalTime().ToString('o')) { return $running }
    return $null
}

function Get-Listeners($service) {
    @(Get-NetTCPConnection -State Listen -LocalPort $service.Port -ErrorAction SilentlyContinue)
}

function Start-ManagedService($service) {
    if (!(Get-ManagedProcess $service)) {
        if ((Get-Listeners $service).Count) { throw "Port $($service.Port) is occupied; no unrelated process was stopped." }
        $output = Join-Path $stateDir "$($service.Name).log"
        $errors = Join-Path $stateDir "$($service.Name).error.log"
        $child = Start-Process -FilePath $node -ArgumentList @("`"$worker`"", $service.Name) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru
        $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)"
        if (!$running) { throw "$($service.Name) stopped during startup. See $errors" }
        @{ Id = $child.Id; CreatedAt = $running.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir "$($service.Name).json") -Encoding UTF8
    }
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (!(Get-ManagedProcess $service)) { throw "$($service.Name) exited. See $stateDir\$($service.Name).error.log" }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $service.Url -TimeoutSec 3
            if ($response.StatusCode -eq 200) { Write-Host "$($service.Name) ready on port $($service.Port)"; return }
        } catch [System.Net.WebException] { }
          catch [System.Net.Http.HttpRequestException] { }
          catch [System.Threading.Tasks.TaskCanceledException] { }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    throw "$($service.Name) is not ready. See $stateDir\$($service.Name).log and .error.log; its process was left running."
}

$lock = $null
try {
    $node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    $lock = [IO.File]::Open((Join-Path $stateDir 'launcher.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    foreach ($service in $services) {
        if ((Get-Listeners $service).Count -and !(Get-ManagedProcess $service)) {
            throw "Port $($service.Port) is occupied by an unmanaged process; no process was stopped."
        }
    }
    if ($Restart) {
        foreach ($service in $services) {
            $running = Get-ManagedProcess $service
            if ($running) {
                & taskkill.exe /PID $running.ProcessId /T /F | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Could not stop managed $($service.Name)." }
            }
        }
    }
    foreach ($service in $services) { Start-ManagedService $service }
    Write-Host "`nAdmin: http://localhost:3420/admin"
    Write-Host "Logs:  $stateDir"
    Write-Host 'Services run independently of this window. Closing it will not stop them.'
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
