# 루빗 중계 서버 (relay)

집에서 돌리는 마크 서버로 **포트포워딩 없이** 플레이어가 접속하게 해 주는 중계
서비스입니다. 방향은 항상 바깥으로만 뜹니다.

```
플레이어 ──▶ 중계 서버(VPS):25565 ──▶ 에이전트(집 PC) ──▶ 127.0.0.1:25565
```

집 공유기에서 아무 포트도 열지 않아도 됩니다.

## 올리는 방법 (VPS)

```bash
# 1) 이 저장소를 VPS 에 받고
git clone <저장소주소> lubit && cd lubit

# 2) 중계 서비스를 켭니다
LUBIT_BASE=https://lubit.kr \
CONTROL_PORT=7777 \
node relay/server.js
```

의존성은 없습니다. Node 18 이상이면 그대로 돕니다.

포트는 512MB짜리 저사양 VPS 로도 충분합니다. 다만 아래 포트는 방화벽에서
열어 주세요.

| 용도 | 포트 | 비고 |
| --- | --- | --- |
| 에이전트 연결 | `CONTROL_PORT` (기본 7777) | 에이전트가 밖으로 연결합니다 |
| 플레이어 접속 | 서버마다 `25565, 25566, …` | lubit.kr 이 서버마다 하나씩 배정합니다 |

## 부팅 시 자동 실행 (systemd)

이 저장소의 [lubit-relay.service](./lubit-relay.service) 를 그대로 쓰면 됩니다.
아래는 그 내용입니다. `/etc/systemd/system/lubit-relay.service` 에 놓고:

```ini
[Unit]
Description=Lubit relay
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/lubit/relay/server.js
WorkingDirectory=/opt/lubit
Environment=LUBIT_BASE=https://lubit.kr
Environment=CONTROL_PORT=7777
Restart=always
User=lubit

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now lubit-relay
```

## Windows VPS 에 올리는 방법

이 서버가 Windows 라면 RDP 로 붙어서 설치 스크립트를 한 번 실행하면 됩니다.

1. 저장소의 `relay/win/` + `relay/server.js` + `relay/package.json` + `agent/protocol.js`
   를 한 폴더로 묶어 VPS 로 옮깁니다. (미리 만든 압축: `dist/lubit-relay-win.zip`)
2. 압축을 푼 폴더에서 관리자 PowerShell 로
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
3. 스크립트가 Node.js 내려받기 → 파일 복사 → 방화벽(7777, 25565~25664) →
   부팅 시 자동 실행 등록 → 시작까지 다 합니다.

자세한 내용은 [relay/win/README.txt](./win/README.txt) 에 있습니다.

## lubit.kr 쪽 설정

웹 콘솔이 이 중계 서버 주소를 알도록 Worker 시크릿을 넣습니다.

```bash
npx wrangler secret put RELAY_HOST        # 예: kr1.lubit.kr  (VPS 도메인)
npx wrangler secret put RELAY_IP          # 예: 1.2.3.4       (VPS 공인 IP)
npx wrangler secret put RELAY_CONTROL_PORT # 기본 7777, 생략 가능
```

도메인 자동 등록(`이름.lubit.kr`)까지 쓰려면 Cloudflare 토큰도 함께 넣습니다.

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN  # Zone.DNS 편집 권한
npx wrangler secret put CLOUDFLARE_ZONE_ID
```

설정이 끝나면 데스크톱 앱(서버 구동기)이 자동으로 이 중계 서버에 연결하고,
웹 콘솔의 **접속** 탭에서 접속 주소를 확인할 수 있습니다.

## 확인

```bash
# 에이전트 없이 포트만 열리는지
node -e "require('net').connect(7777,'127.0.0.1',()=>console.log('ok')).on('error',e=>console.error(e.message))"
```

로컬에서 통신까지 검사하려면 프로젝트 루트에서:

```bash
node scripts/test-relay.cjs
```

## 보안 메모

- 이 서비스는 TCP 바이트만 옮기며 로그인·암호화를 하지 않습니다. 마인크래프트
  자체가 평문 프로토콜이라 TLS 는 쓰지 않습니다.
- `CONTROL_PORT` 를 퍼블릭 7777 대신 임의의 포트로 바꾸고 방화벽에서 VPS IP
  제한을 걸면 더 안전합니다. 기기 토큰 없이는 연결이 거절됩니다.
- lubit.kr 은 기기 토큰으로 서버 목록만 돌려주며, 이 중계 서버는 그 목록에
  있는 포트만 엽니다.
