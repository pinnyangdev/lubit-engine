@echo off
title루빗 - VPS 패키지 만들기
cd /d "%~dp0.."

if not exist .git goto nogit

if exist lubit-web.zip del lubit-web.zip

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $l = @(git ls-files) | Where-Object { $_ }; Compress-Archive -Path $l -DestinationPath 'lubit-web.zip' -Force; $z = Get-Item 'lubit-web.zip'; Write-Host ('[완료] lubit-web.zip  ' + [math]::Round($z.Length/1MB,1) + ' MB'); $h = Select-String -Path 'lubit-web.zip' -Pattern 'changelog' -Quiet; Write-Host ('  소스 파일 수: ' + $l.Count)"
if errorlevel 1 goto fail

echo.
echo VPS로 복사한 뒤 압축을 풀고 VPS배포.bat 를 실행하세요.
pause
exit /b 0

:nogit
echo [오류] git 저장소 폴더에서만 실행할 수 있습니다.
pause
exit /b 1

:fail
echo [실패] 위 메시지를 확인하세요.
pause
exit /b 1
