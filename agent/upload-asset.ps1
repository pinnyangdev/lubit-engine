if (-not $env:GH_TOKEN) { throw 'GH_TOKEN 환경변수가 없습니다. GitHub 에서 토큰을 발급받아 $env:GH_TOKEN 으로 설정하세요.' }
$filePath = "release\LubitServerEngine-Setup-0.1.12.exe"
$fileName = "LubitServerEngine-Setup-0.1.12.exe"
$releaseId = "430168213"

$uploadUrl = "https://uploads.github.com/repos/pinnyangdev/lubit-engine/releases/$releaseId/assets?name=$fileName"

$headers = @{
    Authorization = "token $env:GH_TOKEN"
    Accept = "application/vnd.github.v3+json"
    "Content-Type" = "application/octet-stream"
}

$fileBytes = [System.IO.File]::ReadAllBytes($filePath)

$result = Invoke-RestMethod -Uri $uploadUrl -Method POST -Headers $headers -Body $fileBytes

Write-Output "Asset uploaded: $($result.browser_download_url)"
