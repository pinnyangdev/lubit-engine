@echo off
chcp 65001 >nul
title 루빗 - 빌드
cd /d "%~dp0.."
echo ==========================================
echo   루빗 웹사이트 빌드
echo   위치: %cd%
echo ==========================================
echo.

echo [1/3] 의존성 확인
if exist node_modules (
    echo       node_modules 있음 - 건너뜁니다
) else (
    echo       npm ci 실행
    call npm ci
    if errorlevel 1 goto fail
)
echo.

echo [2/3] 타입 검사
call npm run typecheck
if errorlevel 1 goto fail
echo.

echo [3/3] 웹 빌드
call npm run build
if errorlevel 1 goto fail
echo.

echo ==========================================
echo   완료 - dist\client 에 만들어졌습니다
echo   사이트맵: dist\client\sitemap.xml
echo ==========================================
pause
exit /b 0

:fail
echo.
echo ==========================================
echo   실패 - 위 오류 메시지를 확인하세요
echo ==========================================
pause
exit /b 1
