if (-not $env:GH_TOKEN) { throw 'GH_TOKEN 환경변수가 없습니다. GitHub 에서 토큰을 발급받아 $env:GH_TOKEN 으로 설정하세요.' }
$body = @{
    tag_name = "v0.1.12"
    name = "v0.1.12"
    body = "버그 수정"
    draft = $false
    prerelease = $false
} | ConvertTo-Json

$result = Invoke-RestMethod -Uri "https://api.github.com/repos/pinnyangdev/lubit-engine/releases" -Method POST -Headers @{
    Authorization = "token $env:GH_TOKEN"
    Accept = "application/vnd.github.v3+json"
} -Body $body -ContentType "application/json"

Write-Output "Release created: $($result.html_url)"
Write-Output "Upload URL: $($result.upload_url)"
