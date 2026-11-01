# VPS 배포 스크립트 — GitHub Actions 러너가 push 마다 실행합니다.
#
#   1. 체크아웃한 소스를 C:\LubitWeb 으로 복사 (.env · data · node_modules 는 건드리지 않음)
#   2. 클라이언트·워커 번들 빌드 (설치판 분할은 건너뜀 — 설치판은 저장소에 들어 있는 조각을 씁니다)
#   3. 실행 중인 서버를 내리고 예약 작업 LubitWeb 으로 다시 띄움
#   4. /api/health 로 살아났는지 확인
#
# 로컬에서 직접 실행할 때: pwsh -File scripts/deploy-vps.ps1 -Target C:\LubitWeb
param(
  [string]$Target = 'C:\LubitWeb',
  [int]$Port = 8080,
  [string]$TaskName = 'LubitWeb'
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot

function Invoke-Checked([string]$what, [scriptblock]$command) {
  & $command
  if ($LASTEXITCODE -ne 0) { throw "$what 실패 (exit $LASTEXITCODE)" }
}

# 1. 소스 복사. robocopy 는 0~7 이 성공입니다.
New-Item -ItemType Directory -Force -Path $Target | Out-Null
robocopy $source $Target /E /XD node_modules dist .git .wrangler /XF .env .dev.vars server.log | Out-Null
if ($LASTEXITCODE -ge 8) { throw "소스 복사 실패 (robocopy exit $LASTEXITCODE)" }

# 2. 의존성 설치 · 빌드
Push-Location $Target
try {
  Invoke-Checked 'npm ci' { npm ci }
  Invoke-Checked 'vite build' { npx vite build }
  Invoke-Checked 'postbuild' { node scripts/postbuild.mjs }
} finally {
  Pop-Location
}

# 3. 기존 서버 종료 (포트를 듣고 있는 프로세스)
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) {
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
}
for ($i = 0; $i -lt 20; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 500
}

# 4. 예약 작업으로 다시 시작하고 상태 확인
Invoke-Checked 'schtasks /Run' { schtasks /Run /TN $TaskName }

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $res = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/api/health" -TimeoutSec 3
    if ($res.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
}
if (-not $healthy) { throw "서버가 /api/health 에 응답하지 않습니다. server.log 를 확인하세요." }

Write-Host "배포 완료: http://localhost:$Port"
