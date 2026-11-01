# 루빗 사이트 — VPS(Windows) 이전 절차

클라우드플레어 Workers 에서 돌던 사이트를 일반 서버에서 그대로 돌리는 방법입니다.
코드는 거의 그대로고, **D1 → SQLite** 와 **ASSETS → 파일 서빙** 두 가지만 바뀝니다.

> 지금 단계 (2026-11-01)
>
> - **클라우드플레어 Worker 는 삭제했습니다.** `lubit.kr` 은 이제 워커가 없어
>   `Error 1016` 이 뜹니다 (정상 — 도메인이 빈 상태).
> - D1 데이터는 백업해 두었습니다: `data/d1-export-20261101.sql` (2,366행)
> - VPS 에 그대로 복사하면 되는 DB 도 만들어 두었습니다: `data/lubit-vps.sqlite`
> - 로컬에서 `node server/index.mjs` 로 띄워 페이지 · API · 20MB 설치판 다운로드 ·
>   DB 쓰기까지 확인했습니다.
>
> 남은 일은 **파일 옮기고 DNS 넘기는 것** 뿐입니다. 1단계부터 순서대로 하면 됩니다.

---

## 필요한 파일 (VPS 로 옮길 것)

| 경로 | 역할 |
|---|---|
| `dist/lubit/index.js` (+ `.map`) | 사이트 본체 (워커 번들 — Hono 가 이미 들어 있습니다) |
| `dist/client/` | 웹 페이지 · 설치판 조각 (약 261MB) |
| `server/` | Node 어댑터 + 이 문서 |
| `package.json` / `package-lock.json` | 의존성 |
| `.env` | 시크릿 (직접 만듭니다 — **git 에 넣지 마세요**) |
| `data/lubit-vps.sqlite` | 백업에서 옮긴 사이트 DB (VPS 에서 `data\lubit.sqlite` 로) |

`node_modules` 는 VPS 에서 다시 받는 편이 안전합니다.

> `dist/lubit/.dev.vars` 가 빌드 결과물에 같이 복사돼 있습니다. 시크릿이 들어 있으니
> zip 을 다른 사람에게 넘길 일이 있으면 빼세요. VPS 에서는 이 파일 대신 `.env` 를 쓰면 됩니다.

---

## 1단계 — 파일 전달

`lubit-web.zip` 을 **이미 만들어 뒀습니다.** 탐색기 더블클릭으로도, PowerShell 로도 풀리며
둘 다 확인했습니다. (`.dev.vars` 같은 시크릿은 빼 두었습니다.)

| 항목 | 값 |
|---|---|
| 크기 · SHA256 | zip 옆 `lubit-web.sha256` 파일 참고 |

272MB 를 RDP 로 넘기면 중간에 끊기기 쉬우니, VPS 에서 **크기를 한 번 확인하세요**:

```powershell
(Get-Item C:\Users\<계정>\Downloads\lubit-web.zip).Length      # sha256 파일의 SIZE 와 일치해야 함
Get-FileHash C:\Users\<계정>\Downloads\lubit-web.zip -Algorithm SHA256
```

숫자가 다르면 복사가 깨진 것이니 다시 받으세요.

```powershell
# 탐색기에서 더블클릭해도 되고, 아래가 더 확실합니다
Expand-Archive -Path lubit-web.zip -DestinationPath C:\LubitWeb -Force
```

> **"올바르지 않습니다" 오류가 뜬다면** — `tar`(bsdtar) 로 만든 zip 은 탐색기 내장 압축
> 해제기가 읽지 못해 0개만 뜹니다. 이 zip 은 `Compress-Archive` 로 만들었고 탐색기에서
> 상위 5개 항목이 인식되는 것까지 확인했습니다. 그래도 실패하면 위 크기 대조부터 하세요.

zip 구성

```
dist\lubit\index.js      사이트 본체
dist\client\             페이지 · 설치판 조각 (261MB)
server\                  Node 어댑터 · 이 문서 · Caddyfile
.env.example             빈 시크릿 템플릿
package.json / package-lock.json
```

> DB(`lubit-vps.sqlite`)는 zip 에 넣지 않았습니다. 4단계에서 따로 복사하세요.

다시 묶어야 할 때 (빌드를 새로 했을 때만):

```powershell
# 필수: 임시 폴더(OneDrive 밖)로 옮긴 뒤 압축합니다. 프로젝트 폴더가 OneDrive 안에 있으면
# Compress-Archive 가 "LastWriteTime" 오류로 죽습니다.
$s = "$env:TEMP\lubit-stage"
Remove-Item $s -Recurse -Force -EA 0; New-Item -ItemType Directory $s | Out-Null
Copy-Item dist, server, package.json, package-lock.json, .env.example $s -Recurse
Remove-Item "$s\dist\lubit\.dev.vars","$s\dist\lubit\.vite","$s\dist\relay-win","$s\dist\lubit-relay-win.zip" -Recurse -Force -EA 0
# zip 은 1980년 이전 시각을 못 담습니다 (dist/client/favicon.svg 가 1970년 타임스탬프)
Get-ChildItem $s -Recurse -File | ForEach-Object { $_.LastWriteTime = Get-Date }
Compress-Archive -Path "$s\*" -DestinationPath .\lubit-web.zip -Force -CompressionLevel Fastest
Remove-Item $s -Recurse -Force
# 새로 만든 zip 의 해시는 옆에 남깁니다
$h = Get-FileHash .\lubit-web.zip -Algorithm SHA256
"SIZE  $((Get-Item .\lubit-web.zip).Length)" | Set-Content .\lubit-web.sha256
"SHA256 $($h.Hash)  lubit-web.zip" | Add-Content .\lubit-web.sha256
```

## 2단계 — Node 설치

VPS 에서 (Node 22 이상 필요 — `node:sqlite` 을 씁니다):

```powershell
winget install OpenJS.NodeJS.LTS
# 설치 후 PowerShell 새로 열기
node -v          # v22 이상 확인
cd C:\LubitWeb
npm ci --omit=dev
```

## 3단계 — 시크릿 `.env` 만들기

zip 에 같이 들어 있는 `.env.example` 을 `.env` 로 복사한 뒤 **값만** 채우면 됩니다.
값은 로컬 `.dev.vars` 에서 복사합니다. (값을 채팅에 붙여넣지 마세요.)

```powershell
cd C:\LubitWeb
Copy-Item .env.example .env
notepad .env
```

필요한 항목: `ORIGIN` `PORT` `INBOX_TOKEN` `DISCORD_WEBHOOK_URL`
`DISCORD_CLIENT_ID/SECRET` `GOOGLE_CLIENT_ID/SECRET` `CLOUDFLARE_API_TOKEN/ZONE_ID` `RELAY_*`

> `BACKUPS`(R2 클라우드 백업)는 Cloudflare 전용이라 VPS 에 없습니다. 그 기능만
> "저장소가 연결되지 않았습니다" 로 응답하고 나머지는 전부 정상입니다.

## 4단계 — 데이터베이스 이전 (이미 끝남)

아래는 **이미 해 둔 상태**입니다. 그냥 `data/lubit-vps.sqlite` 를 VPS `C:\LubitWeb\data\lubit.sqlite`
로 복사하면 됩니다. (실행 중에 새로 쌓인 데이터까지 다시 받고 싶을 때만 아래를 반복하세요.)

```powershell
npx wrangler d1 export lubit --remote --output=data/d1-export-20261101.sql
node server/import-d1.mjs data/d1-export-20261101.sql data/lubit-vps.sqlite --force
```

마지막 백업 기준 행 수입니다.

| 표 | 행 |
|---|---|
| engine_logs | 2,219 |
| engine_commands | 85 |
| engine_sessions | 28 |
| engine_devices / engine_servers | 7 / 7 |
| engine_users | 6 |
| chat_messages | 7 |
| contact_messages | 1 |

## 5단계 — 실행 · 확인

```powershell
$env:PORT=8080; node server/index.mjs
```

새 PowerShell 창에서:

```powershell
curl.exe http://localhost:8080/api/health            # {"ok":true}
curl.exe -I http://localhost:8080/download/engine/p000.bin   # 200, 20971520
curl.exe http://localhost:8080/api/engine/auth/discord/status # {"configured":true}
```

셋 다 나오면 사이트는 Cloudflare 와 같은 동작입니다.

## 6단계 — 부팅 시 자동 시작

relay 와 같은 방식으로 예약 작업을 씁니다.

```powershell
schtasks /Create /TN "LubitWeb" /SC ONLOGON /RL LIMITED `
  /TR "cmd /c cd /d C:\LubitWeb && node server\index.mjs >> C:\LubitWeb\server.log 2>&1"
schtasks /Run /TN "LubitWeb"
```

## 7단계 — HTTPS (Caddy 권장)

1. <https://caddyserver.com/download> 에서 Windows 용 받기 → `C:\caddy\caddy.exe`
2. `server\Caddyfile` 을 `C:\caddy\Caddyfile` 로 복사 (압축·느린 업로드·로그까지 설정돼 있음):

```powershell
Copy-Item C:\LubitWeb\server\Caddyfile C:\caddy\Caddyfile
```

3. 방화벽에서 80 · 443 열기:

```powershell
New-NetFirewallRule -DisplayName "LubitWeb 80"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "LubitWeb 443" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

4. `caddy run --config C:\caddy\Caddyfile` — 인증서는 알아서 발급·갱신됩니다.
   (Caddy 를 서비스로 등록하려면 `caddy.exe start` 대신 [WinSW](https://github.com/winsw/winsw) 를 씁니다.)

## 8단계 — DNS 넘기기 (마지막에!)

Cloudflare DNS 에서

```
lubit.kr        A   112.168.140.252     ← 프록시 끄기(DNS only, 회색 구름)
www.lubit.kr    CNAME lubit.kr           ← 역시 DNS only
```

> **주의 — 워커를 지웠기 때문에 `lubit.kr` 레코드가 지금 빈 껍데기로 남아 있습니다.**
> (지금 열면 `Error 1016`.) 새로 만들지 말고 **그 레코드를 수정**해서 VPS IP 로 바꾸고
> 프록시를 끄세요. 레코드 타입이 `Worker` 로 고정돼 있어 수정이 안 되면, 그 레코드를
> 지우고 위처럼 `A` 레코드로 다시 만들면 됩니다.

**반드시 프록시를 끄고(DNS only)** 넘겨야 합니다. 주황색(프록시)으로 두면 요청이 다시
클라우드플레어로 돌아가 지금 Workers 를 그대로 쓰게 되어 이전이 안 됩니다.

### 검증 체크리스트

- [ ] `https://lubit.kr` 메인 페이지 열림 · 콘솔(`/console`) 열림
- [ ] 브라우저 주소창 자물쇠 있음 (HTTPS)
- [ ] 디스코드·구글 로그인 완주 (리다이렉트 URI 는 도메인이 그대로라 손댈 것 없음)
- [ ] 데스크톱 구동기 로그인 · 서버 목록 정상
- [ ] 설치판 내려받기 (83MB) 정상
- [ ] 문의·채팅 남기기 → `/api/inbox` 에서 확인
- [ ] VPS 재부팅 후 `LubitWeb` 작업이 살아 있음

### 롤백

DNS 를 다시 클라우드플레어 프록시(주황색)로 되돌리면 즉시 예전 Workers 로 돌아갑니다.
DB 는 이전 시점의 데이터만 남으므로, 돌린 뒤 생긴 변경분은 `wrangler d1 export` 로 한 번
더 내보내 두는 편이 안전합니다.

---

## 정리 — 이전 후 달라지는 점

| 항목 | 이전 전 | 이전 후 |
|---|---|---|
| 사이트 호스팅 | Cloudflare Workers (무료) | 내 VPS |
| 데이터베이스 | D1 | `data/lubit.sqlite` 파일 |
| 백업 | 클라우드플레어가 알아서 | **매주 파일 복사**를 직접 (예: `Copy-Item C:\LubitWeb\data\lubit.sqlite D:\backup\lubit-$(Get-Date -f yyyyMMdd).sqlite`) |
| 가용성 | CDN · 장애 복구 포함 | VPS 재부팅·대역폭에 의존 |
| 다운로드 대역폭 | Cloudflare 부담 | VPS 대역폭에서 나감 |
