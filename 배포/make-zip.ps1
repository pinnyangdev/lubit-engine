$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$zip = Join-Path (Get-Location) 'lubit-web.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

$files = @(git -c core.quotepath=false ls-files) | Where-Object { $_ -and (Test-Path $_) }
Compress-Archive -Path $files -DestinationPath $zip -Force

$z = Get-Item $zip
Write-Host ''
Write-Host ('  [OK] lubit-web.zip  ' + [math]::Round($z.Length / 1MB, 1) + ' MB')
Write-Host ('  files: ' + $files.Count)
Write-Host ''
Write-Host '  Copy this zip to the VPS, unzip it, then run VPS.bat'
