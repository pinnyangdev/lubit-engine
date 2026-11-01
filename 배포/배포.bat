@echo off
chcp 65001 >nul
title 루빗 - VPS 패키지 만들기
cd /d "%~dp0.."
set OUT=lubit-web.zip

echo ==========================================
echo   VPS 업로드용 ZIP 만들기
echo   파일: %OUT%
echo ==========================================
echo.
echo 들어가는 것 : git 에 등록된 소스 전부
echo 빠지는 것   : .env .dev.vars node_modules data dist .git .wrangler *.log
echo               (VPS 의 C:\LubitWeb 에는 기존 설정과 데이터가 그대로 남습니다)
echo.

:: 커밋하지 않은 변경이 있으면 ZIP 에 빠지는 것을 알립니다.
for /f %%i in ('git status --porcelain') do set DIRTY=1
if defined DIRTY (
    echo [주의] 커밋하지 않은 변경이 있습니다 - ZIP 에는 빠집니다.
    git status --short
    echo.
)

if exist "%OUT%" del "%OUT%"

:: git archive 는 추적 중인 파일만 담으므로 비밀이 자동으로 빠집니다.
git archive --format=zip -o "%OUT%" HEAD
if errorlevel 1 goto fail

for %%A in ("%OUT%") do echo [완료] %%~zA bytes  ^(%%~zA / 1024 / 1024 MB 단위는 아래 참조^)
powershell -NoProfile -Command "(Get-Item '%OUT%').Length / 1MB | ForEach-Object { '        ' + [math]::Round($_,1) + ' MB' }"
echo.
echo 다음 단계:
echo   1) %OUT% 를 VPS 로 복사
echo   2) VPS 에서 압축 푼 뒤 VPS배포.bat 실행
echo.
pause
exit /b 0

:fail
echo.
echo [실패] git archive 오류를 확인하세요
pause
exit /b 1
