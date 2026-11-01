$host = "112.168.140.252"
$user = "mgraadmin"
$password = "kjm091028*"

$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential ($user, $securePassword)

# plink 사용 (PuTTY의 명령줄 도구)
$plinkPath = "C:\Program Files\PuTTY\plink.exe"
if (Test-Path $plinkPath) {
    & $plinkPath -pw $password "$user@$host" "find / -name 'lubit-web.zip' 2>/dev/null | head -5"
} else {
    Write-Output "plink not found. Please install PuTTY or use WinSCP to find the path."
    Write-Output "Manual command: ssh $user@$host 'find / -name lubit-web.zip 2>/dev/null'"
}
