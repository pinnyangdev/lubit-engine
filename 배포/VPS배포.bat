@echo off
chcp 65001 >nul
title 루빗 - VPS 배포
:: 이 파일은 VPS 에서 실행합니다. ZIP 을 푼 폴더 안에 두면 그 폴더 기준으로 돕니다.

echo ==========================================
echo   VPS 배포 - 소스 복사 · 빌드 · 서버 재시작
echo ==========================================
echo.
echo   대상  : C:\LubitWeb  (기존 .env 와 data 는 그대로 유지됩니다)
echo   단계  : 소스 복사 - npm ci - vite build - 서버 재시작 - 헬스체크
echo.

set SCRIPT=%~dp0scripts\deploy-vps.ps1
if not exist "%SCRIPT%" set SCRIPT=%~dp0..\scripts\deploy-vps.ps1
if not exist "%SCRIPT%" goto nofile

where pwsh >nul 2>&1
if errorlevel 1 (
    echo   pwsh 가 없어 powershell 로 실행합니다.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
) else (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)
if errorlevel 1 goto fail

echo.
echo ==========================================
echo   완료
echo   확인: curl https://lubit.kr/api/health
echo         https://lubit.kr/sitemap.xml
echo ==========================================
pause
exit /b 0

:nofile
echo [오류] scripts\deploy-vps.ps1 을 찾지 못했습니다.
echo        ZIP 을 푼 폴더 안에서 이 배치 파일을 실행하세요.
pause
exit /b 1

:fail
echo.
echo [실패] 위 오류를 확인하세요. 서버가 안 뜨면 C:\LubitWeb\server.log 를 보세요.
pause
exit /b 1
