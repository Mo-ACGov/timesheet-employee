# Timesheet dev server — same URL every session: http://localhost:3456
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..."
    npm install
}

Write-Host ""
Write-Host "Timesheet app: http://localhost:3456"
Write-Host "Press Ctrl+C to stop."
Write-Host ""

npm run start
