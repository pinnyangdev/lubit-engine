from pathlib import Path

p = Path(__file__).resolve().parent.parent / 'src' / 'worker' / 'engine.ts'
s = p.read_text(encoding='utf-8')

# 1) siteOrigin 헬퍼 추가 (DESKTOP_CALLBACKS 다음)
anchor = "const DESKTOP_CALLBACKS = ['http://127.0.0.1:51555/callback', 'http://localhost:51555/callback']"
helper = anchor + """

// Cloudflare Tunnel이 Host 헤더를 localhost로 덮어써도 OAuth 돌아오는 주소는
// 사이트 도메인으로 고정한다. (localhost로 보내면 provider가 redirect_uri_mismatch로 거절)
const siteOrigin = (url: string) => {
  const origin = new URL(url).origin
  return /localhost|127\\.0\\.0\\.1/.test(origin) ? origin : 'https://lubit.kr'
}"""
if 'const siteOrigin' not in s:
    s = s.replace(anchor, helper, 1)

# 2) start 2곳
s = s.replace(
    "const webRedirect = `${new URL(c.req.url).origin}/api/engine/auth/discord/callback`",
    "const webRedirect = `${siteOrigin(c.req.url)}/api/engine/auth/discord/callback`")
s = s.replace(
    "const webRedirect = `${new URL(c.req.url).origin}/api/engine/auth/google/callback`",
    "const webRedirect = `${siteOrigin(c.req.url)}/api/engine/auth/google/callback`")

# 3) callback 2곳 (token 교환 시 redirect_uri)
s = s.replace(
    "`${new URL(c.req.url).origin}/api/engine/auth/discord/callback`,",
    "`${siteOrigin(c.req.url)}/api/engine/auth/discord/callback`,")
s = s.replace(
    "`${new URL(c.req.url).origin}/api/engine/auth/google/callback`,",
    "`${siteOrigin(c.req.url)}/api/engine/auth/google/callback`,")

p.write_text(s, encoding='utf-8')
left = s.count('new URL(c.req.url).origin')
print('남은 미교체 origin:', left)
print('siteOrigin 사용처:', s.count('siteOrigin('))
