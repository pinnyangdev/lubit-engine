Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$srcPath = Join-Path $root 'public\logo-mark.png'
$src = [System.Drawing.Image]::FromFile($srcPath)

function New-Resized($image, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($image, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, $path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# --- PWA 아이콘 -------------------------------------------------------------
$public = Join-Path $root 'public'
Save-Png (New-Resized $src 192) (Join-Path $public 'icon-192.png')

# maskable 아이콘: 안전 영역 확보를 위해 62%로 축소하고 배경을 채웁니다.
$size = [int](512 * 0.62)
$off = [int]((512 - $size) / 2)
$b512 = New-Object System.Drawing.Bitmap 512, 512
$g2 = [System.Drawing.Graphics]::FromImage($b512)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g2.Clear([System.Drawing.Color]::FromArgb(255, 7, 9, 10))
$g2.DrawImage($src, $off, $off, $size, $size)
$g2.Dispose()
Save-Png $b512 (Join-Path $public 'icon-maskable-512.png')

# --- Windows 아이콘 (.ico) ---------------------------------------------------
$build = Join-Path $root 'agent\build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$parts = Join-Path $build '_parts'
New-Item -ItemType Directory -Force -Path $parts | Out-Null

foreach ($n in @(16, 24, 32, 48, 64, 128, 256)) {
  Save-Png (New-Resized $src $n) (Join-Path $parts "icon-$n.png")
}

node (Join-Path $PSScriptRoot 'ico.mjs') $parts (Join-Path $build 'icon.ico') | Write-Output
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Remove-Item -Recurse -Force $parts

# 트레이 아이콘. 작은 크기라 윤곽이 또렷하게 보이도록 32px로 따로 뽑습니다.
Save-Png (New-Resized $src 32) (Join-Path $root 'agent\tray.png')
$src.Dispose()
Write-Output 'icons generated'
