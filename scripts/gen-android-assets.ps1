# 안드로이드 런처 아이콘과 시작 화면을 루빗 로고로 만듭니다.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-android-assets.ps1
#
# public/icon-maskable-512.png 를 밀도별 크기로 줄여 android/app/src/main/res/mipmap-* 에 넣고,
# 어두운 배경 위에 로고를 올린 시작 화면(splash.png)도 다시 그립니다.
# 빌드마다 새로 만들 필요는 없고, 로고가 바뀔 때만 실행하면 됩니다.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$res = Join-Path $root 'android\app\src\main\res'
$srcIcon = Join-Path $root 'public\icon-maskable-512.png'
$srcLogo = Join-Path $root 'public\logo-mark.png'

if (-not (Test-Path $res)) { throw "android/res 를 찾지 못했습니다: $res" }
if (-not (Test-Path $srcIcon)) { throw "아이콘 원본이 없습니다: $srcIcon" }

function New-Resized([System.Drawing.Image]$image, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($image, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

# 1) 밀도별 런처 아이콘
$icon = [System.Drawing.Image]::FromFile($srcIcon)
$densities = @{ 'mdpi' = 48; 'hdpi' = 72; 'xhdpi' = 96; 'xxhdpi' = 144; 'xxxhdpi' = 192 }
foreach ($density in $densities.Keys) {
  $dir = Join-Path $res "mipmap-$density"
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $size = $densities[$density]
  foreach ($name in @('ic_launcher', 'ic_launcher_round')) {
    $bmp = New-Resized $icon $size
    $bmp.Save((Join-Path $dir "$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "mipmap-$density/$name.png ($size)"
  }
}
$icon.Dispose()

# 어댑티브 아이콘 XML 을 두면(API 26+) 위 PNG 대신 그쪽이 쓰이므로 없앱니다.
$anydpi = Join-Path $res 'mipmap-anydpi-v26'
if (Test-Path $anydpi) {
  Remove-Item -Recurse -Force $anydpi
  Write-Output 'mipmap-anydpi-v26 삭제 (PNG 아이콘이 전 연령대에 적용됩니다)'
}

# 2) 시작 화면 — 어두운 배경에 로고를 가운데로
if (Test-Path $srcLogo) {
  $size = 1024
  $logo = [System.Drawing.Image]::FromFile($srcLogo)
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::FromArgb(255, 7, 9, 10)) # #07090a
  $logoSize = [int]($size * 0.36)
  $offset = [int](($size - $logoSize) / 2)
  $g.DrawImage($logo, $offset, $offset, $logoSize, $logoSize)
  $g.Dispose()
  $bmp.Save((Join-Path $res 'drawable\splash.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $logo.Dispose()
  Write-Output 'drawable/splash.png 갱신'
}
