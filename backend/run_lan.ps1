# Start the Amanat backend so phones and teammates' laptops on the same Wi-Fi can reach it.
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File D:\amanat\backend\run_lan.ps1
param(
    [int]$Port = 8000,
    [int]$FrontendPort = 5173
)

$backend = $PSScriptRoot
$python = Join-Path (Split-Path $backend -Parent) ".venv\Scripts\python.exe"

# Pick the Wi-Fi (or first real) IPv4 address.
$addrs = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown'
}
$ip = ($addrs | Where-Object InterfaceAlias -like '*Wi-Fi*' | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = ($addrs | Select-Object -First 1).IPAddress }
if (-not $ip) { Write-Host "No network connection found." -ForegroundColor Red; exit 1 }

# Invite links must point at a URL the contact's phone can open. Respect .env if it sets one.
$envFile = Join-Path $backend ".env"
$fromEnv = if (Test-Path $envFile) {
    (Get-Content $envFile | Where-Object { $_ -match '^\s*AMANAT_INVITE_BASE_URL\s*=\s*\S' })
}
if (-not $fromEnv) { $env:AMANAT_INVITE_BASE_URL = "http://${ip}:${FrontendPort}/circle" }

$net = (Get-NetConnectionProfile | Where-Object InterfaceAlias -like '*Wi-Fi*' | Select-Object -First 1)
Write-Host ""
Write-Host "  Amanat backend" -ForegroundColor Cyan
Write-Host "  This laptop : http://localhost:$Port/docs"
Write-Host "  Phones/team : http://${ip}:$Port/        <- open this on your phone to test" -ForegroundColor Green
Write-Host "  Frontend    : tell Ananya to use  http://${ip}:$Port  as the API base URL"
Write-Host "  Invite links: $(if ($fromEnv) { 'from .env' } else { $env:AMANAT_INVITE_BASE_URL })"
if ($net -and $net.NetworkCategory -eq 'Public') {
    Write-Host ""
    Write-Host "  Wi-Fi '$($net.Name)' is a PUBLIC network: Windows may block phones." -ForegroundColor Yellow
    Write-Host "  If Windows asks, tick BOTH Private and Public and click 'Allow access'." -ForegroundColor Yellow
}
Write-Host ""

Set-Location $backend
& $python -m uvicorn app:app --host 0.0.0.0 --port $Port
