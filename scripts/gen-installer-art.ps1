# NSIS 설치 마법사에 쓰는 BMP 를 그립니다. (24비트, 알파 없음)
#
#   agent/build/installerSidebar.bmp    164 x 314  설치 왼쪽 배너
#   agent/build/uninstallerSidebar.bmp  164 x 314  제거 왼쪽 배너
#   agent/build/installerHeader.bmp     150 x 57   페이지 상단 배너
#
# BMP 는 반드시 24비트 RGB 여야 NSIS 가 정상적으로 붙입니다. (알파가 있으면 흰 판으로 나옵니다)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$build = Join-Path $root 'agent\build'
New-Item -ItemType Directory -Force -Path $build | Out-Null

$markPath = Join-Path $root 'public\logo-mark.png'
$mark = if (Test-Path $markPath) { [System.Drawing.Image]::FromFile($markPath) } else { $null }

$bgTop = [System.Drawing.Color]::FromArgb(255, 16, 22, 26)
$bgBot = [System.Drawing.Color]::FromArgb(255, 7, 9, 10)
$grid  = [System.Drawing.Color]::FromArgb(255, 24, 33, 36)
$white = [System.Drawing.Color]::FromArgb(255, 238, 247, 244)
$muted = [System.Drawing.Color]::FromArgb(255, 160, 179, 174)
$faint = [System.Drawing.Color]::FromArgb(255, 96, 112, 108)
$amber = [System.Drawing.Color]::FromArgb(255, 255, 179, 71)
$green = [System.Drawing.Color]::FromArgb(255, 74, 222, 128)

$fonts = @{}

function Get-Font([float]$size, [bool]$bold) {
  $key = "$size-$bold"
  if ($fonts.ContainsKey($key)) { return $fonts[$key] }

  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $family = $null
  foreach ($name in @('Malgun Gothic', 'Segoe UI', 'Arial')) {
    foreach ($candidate in [System.Drawing.FontFamily]::Families) {
      if ($candidate.Name -eq $name) { $family = $candidate; break }
    }
    if ($family) { break }
  }
  if (-not $family) { $family = [System.Drawing.FontFamily]::GenericSansSerif }

  $font = [System.Drawing.Font]::new($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $fonts[$key] = $font
  return $font
}

function New-Canvas([int]$w, [int]$h) {
  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $bgTop, $bgBot, 90)
  $g.FillRectangle($gradient, $rect)
  $gradient.Dispose()

  # 옅은 격자 — 앱 배경의 그리드와 같은 인상을 줍니다.
  $pen = [System.Drawing.Pen]::new($grid, 1)
  for ($x = 0; $x -lt $w; $x += 26) { $g.DrawLine($pen, $x, 0, $x, $h) }
  for ($y = 0; $y -lt $h; $y += 26) { $g.DrawLine($pen, 0, $y, $w, $y) }
  $pen.Dispose()

  return $g
}

function Draw-Center($g, [string]$text, $font, $color, [float]$y, [int]$w) {
  $size = $g.MeasureString($text, $font)
  $brush = [System.Drawing.SolidBrush]::new($color)
  $g.DrawString($text, $font, $brush, ($w - $size.Width) / 2, $y)
  $brush.Dispose()
}

function Save-Bmp($g, $bmp, [string]$path) {
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Output ("  " + (Split-Path $path -Leaf))
}

# --- 왼쪽 배너 (설치 / 제거) -------------------------------------------------
function New-Sidebar([string]$path, [string]$caption) {
  $w = 164
  $h = 314
  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $bgTop, $bgBot, 90)
  $g.FillRectangle($gradient, $rect)
  $gradient.Dispose()

  $pen = [System.Drawing.Pen]::new($grid, 1)
  for ($x = 0; $x -lt $w; $x += 26) { $g.DrawLine($pen, $x, 0, $x, $h) }
  for ($y = 0; $y -lt $h; $y += 26) { $g.DrawLine($pen, 0, $y, $w, $y) }
  $pen.Dispose()

  # 상단 액센트 라인
  $accentPen = [System.Drawing.Pen]::new($amber, 2)
  $g.DrawLine($accentPen, 0, 1, $w, 1)
  $accentPen.Dispose()

  if ($mark) { $g.DrawImage($mark, [float](($w - 64) / 2), 52.0, 64.0, 64.0) }

  Draw-Center $g '루빗' (Get-Font 17 $true) $white 130 $w
  Draw-Center $g '서버 구동기' (Get-Font 11 $false) $muted 154 $w

  $barPen = [System.Drawing.Pen]::new($green, 2)
  $g.DrawLine($barPen, ($w - 34) / 2, 184, ($w + 34) / 2, 184)
  $barPen.Dispose()

  Draw-Center $g $caption (Get-Font 11 $false) $faint 206 $w
  Draw-Center $g 'lubit.kr' (Get-Font 10 $true) $muted 288 $w

  Save-Bmp $g $bmp $path
}

# --- 상단 배너 --------------------------------------------------------------
function New-Header([string]$path) {
  $w = 150
  $h = 57
  $bmp = [System.Drawing.Bitmap]::new($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $rect = [System.Drawing.Rectangle]::new(0, 0, $w, $h)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $bgTop, $bgBot, 45)
  $g.FillRectangle($gradient, $rect)
  $gradient.Dispose()

  if ($mark) { $g.DrawImage($mark, 9.0, 14.0, 30.0, 30.0) }

  $title = Get-Font 11.5 $true
  $sub = Get-Font 9.5 $false
  $brushWhite = [System.Drawing.SolidBrush]::new($white)
  $brushMuted = [System.Drawing.SolidBrush]::new($muted)
  $g.DrawString('루빗 서버 구동기', $title, $brushWhite, 45, 13)
  $g.DrawString('Lubit Server Engine', $sub, $brushMuted, 45, 30)
  $brushWhite.Dispose()
  $brushMuted.Dispose()

  $accentPen = [System.Drawing.Pen]::new($amber, 2)
  $g.DrawLine($accentPen, 0, $h - 1, $w, $h - 1)
  $accentPen.Dispose()

  Save-Bmp $g $bmp $path
}

Write-Output 'installer images:'
New-Sidebar (Join-Path $build 'installerSidebar.bmp') '설치'
New-Sidebar (Join-Path $build 'uninstallerSidebar.bmp') '설치 제거'
New-Header (Join-Path $build 'installerHeader.bmp')

if ($mark) { $mark.Dispose() }
Write-Output 'done'
