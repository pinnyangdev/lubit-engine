$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
Add-Type -AssemblyName System.IO.Compression.FileSystem

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$zip = Join-Path (Get-Location) 'lubit-web.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

$files = @(git -c core.quotepath=false ls-files) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
    foreach ($rel in $files) {
        $full = Join-Path (Get-Location) $rel
        $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        # OneDrive 로 동기화된 파일은 타임스탬프가 ZIP 범위(1980~2107)를 벗어나는 경우가 있어
        # 무시하고 현재 시각으로 넣습니다. 압축 내용은 전혀 변하지 않습니다.
        try { $entry.LastWriteTime = [DateTimeOffset]::Now } catch { }

        $input = [System.IO.File]::OpenRead($full)
        try {
            $output = $entry.Open()
            try { $input.CopyTo($output) } finally { $output.Dispose() }
        } finally { $input.Dispose() }
    }
} finally { $archive.Dispose() }

$z = Get-Item $zip
Write-Host ''
Write-Host ('  [OK] lubit-web.zip  ' + [math]::Round($z.Length / 1MB, 1) + ' MB  (' + $files.Count + ' files)')
Write-Host ''
Write-Host '  Copy it to the VPS, unzip, then run VPS.bat'
