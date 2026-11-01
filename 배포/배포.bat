@echo off
title ��� - VPS ��Ű�� �����
cd /d "%~dp0.."

if not exist .git goto nogit

if exist lubit-web.zip del lubit-web.zip

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $l=@(git -c core.quotepath=false ls-files) | Where-Object { $_ }; Compress-Archive -Path $l -DestinationPath 'lubit-web.zip' -Force; $z=Get-Item 'lubit-web.zip'; Write-Host ('[완료] lubit-web.zip '+[math]::Round($z.Length/1MB,1)+' MB / 파일 '+$l.Count+' 개')"
if errorlevel 1 goto fail

echo.
echo VPS�� ������ �� ������ Ǯ�� VPS����.bat �� �����ϼ���.
pause
exit /b 0

:nogit
echo [����] git ����� ���������� ������ �� �ֽ��ϴ�.
pause
exit /b 1

:fail
echo [����] �� �޽����� Ȯ���ϼ���.
pause
exit /b 1
