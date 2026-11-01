#Requires -Version 5.1
<#
  루빗 중계 서버 설치 (Windows VPS)

  사용법: 이 폴더를 압축 푼 뒤, 관리자 PowerShell에서
      powershell -ExecutionPolicy Bypass -File .\install.ps1

  하는 일
   1. Node.js 가 없으면 내려받아 C:\LubitRelay\node 에 설치
   2. 중계 서버 파일을 C:\LubitRelay 로 복사
   3. 방화벽에서 7777(에이전트) / 25565~25664(플레이어) 인바운드 열기
   4. 부팅 시 자동 실행되는 예약 작업 등록 후 지금 바로 시작
#>

$ErrorActionPreference = 'Stop'
$installDir = 'C:\LubitRelay'
$controlPort = 7777
$gamePortRange = '25565-25664'
$baseUrl = 'https://lubit.kr'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '관리자 권한이 필요합니다. PowerShell을 "관리자로 실행"해서 다시 시도해 주세요.' -ForegroundColor Red
  exit 1
}

$scriptRoot = $PSScriptRoot
if (-not (Test-Path (Join-Path $scriptRoot 'relay\server.js'))) {
  Write-Host 'relay\server.js 를 찾지 못했습니다. 압축을 폴더로 푼 뒤 그 안에서 실행해 주세요.' -ForegroundColor Red
  exit 1
}

# --- 1) Node.js -------------------------------------------------------------
Write-Step 'Node.js 확인'
$nodeExe = Join-Path $installDir 'node\node.exe'
$existing = Get-Command node.exe -ErrorAction SilentlyContinue
if (Test-Path $nodeExe) {
  Write-Host "이미 설치됨: $nodeExe"
} elseif ($existing) {
  $nodeExe = $existing.Source
  Write-Host "시스템 Node.js 사용: $nodeExe"
} else {
  Write-Host 'Node.js 를 내려받는 중…'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = @($index) | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $lts) { throw 'Node.js LTS 목록을 받지 못했습니다.' }
  $ver = $lts.version.TrimStart('v')
  $url = "https://nodejs.org/dist/$($lts.version)/node-$ver-win-x64.zip"
  $zip = Join-Path $env:TEMP 'node-win-x64.zip'
  Write-Host "  $url"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  $stage = Join-Path $env:TEMP 'node-extract'
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  Expand-Archive -Path $zip -DestinationPath $stage -Force
  $inner = Get-ChildItem -Directory $stage | Select-Object -First 1
  New-Item -ItemType Directory -Force (Join-Path $installDir 'node') | Out-Null
  Copy-Item -Path (Join-Path $inner.FullName '*') -Destination (Join-Path $installDir 'node') -Recurse -Force
  Remove-Item -Recurse -Force $stage, $zip
  $nodeExe = Join-Path $installDir 'node\node.exe'
  if (-not (Test-Path $nodeExe)) { throw 'Node.js 설치에 실패했습니다.' }
  Write-Host "설치 완료: $nodeExe" -ForegroundColor Green
}

# --- 2) 파일 복사 -----------------------------------------------------------
Write-Step '중계 서버 파일 복사'
New-Item -ItemType Directory -Force $installDir | Out-Null
Copy-Item -Path (Join-Path $scriptRoot 'relay') -Destination $installDir -Recurse -Force
Copy-Item -Path (Join-Path $scriptRoot 'agent') -Destination $installDir -Recurse -Force
Write-Host "$installDir\relay\server.js"

# --- 3) 방화벽 --------------------------------------------------------------
Write-Step '방화벽 열기'
foreach ($rule in @(
    @{ Name = 'Lubit Relay (에이전트)'; Port = "$controlPort" },
    @{ Name = 'Lubit Relay (플레이어)'; Port = $gamePortRange }
  )) {
  if (-not (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $rule.Port -Profile Any | Out-Null
  }
  Write-Host "  열림: $($rule.Name) TCP $($rule.Port)"
}

# --- 4) 자동 실행 -----------------------------------------------------------
Write-Step '부팅 시 자동 실행 등록'
$runner = Join-Path $installDir 'start.cmd'
@"
@echo off
set LUBIT_BASE=$baseUrl
set CONTROL_PORT=$controlPort
cd /d $installDir
"$nodeExe" relay\server.js >> "$installDir\relay.log" 2>&1
"@ | Set-Content -Path $runner -Encoding ASCII

$existingTask = Get-ScheduledTask -TaskName 'LubitRelay' -ErrorAction SilentlyContinue
if ($existingTask) { Stop-ScheduledTask -TaskName 'LubitRelay' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'LubitRelay' -Confirm:$false }

$action = New-ScheduledTaskAction -Execute $runner
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName 'LubitRelay' -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host '  예약 작업: LubitRelay (부팅 시 자동 시작)'

Write-Step '지금 시작'
Start-ScheduledTask -TaskName 'LubitRelay'

# 부팅·작업 시작에 시간이 걸릴 수 있어 20초 동안 몇 번씩 재확인합니다.
$listen = $null
for ($i = 0; $i -lt 10 -and -not $listen; $i++) {
  Start-Sleep -Seconds 2
  $listen = Get-NetTCPConnection -LocalPort $controlPort -State Listen -ErrorAction SilentlyContinue
}

if ($listen) {
  Write-Host "`n설치 완료 — 포트 $controlPort 대기 중입니다." -ForegroundColor Green
} else {
  $info = Get-ScheduledTaskInfo -TaskName 'LubitRelay' -ErrorAction SilentlyContinue
  Write-Host "`n아직 포트를 열지 못했습니다." -ForegroundColor Yellow
  Write-Host "  예약 작업 결과: $($info.LastTaskResult) (0 이면 정상 종료) · 실행 횟수 $($info.NumberOfRuns)"
  Write-Host "  오류 로그: $installDir\relay.log"
  Write-Host '  직접 돌려보려면:'
  Write-Host "    cd $installDir && `"$nodeExe`" relay\server.js"
}

Write-Host @"

다음 단계 (lubit.kr 쪽, 이미 반영돼 있을 수 있습니다)
  RELAY_IP   = 112.168.140.252
  RELAY_HOST = 112.168.140.252
"@
