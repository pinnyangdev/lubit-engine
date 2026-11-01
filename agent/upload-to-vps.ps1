$host = "112.168.140.252"
$user = "mgraadmin"
$password = "kjm091028*"
$localFile = "release\LubitServerEngine-Setup-0.1.12.exe"
$remotePath = "/var/www/html/download/engine/LubitServerEngine-Setup-0.1.12.exe"

# scp를 사용해서 파일 업로드
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential ($user, $securePassword)

# WinSCP나 다른 도구가 필요할 수 있음
Write-Output "Please manually upload the file using:"
Write-Output "scp $localFile $user@$host`:$remotePath"
