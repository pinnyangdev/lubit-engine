// 디스코드·Cloudflare 자격증명이 제대로 들어갔는지 값 없이 확인합니다.
//   node scripts/check-credentials.cjs
//
// 하는 일
//   1) lubit.kr 이 디스코드 로그인을 켰는지
//   2) 로그인 시작 주소에 클라이언트 ID 가 제대로 들어갔는지
//   3) 클라이언트 ID/시크릿 쌍이 맞는지 — Discord 토큰 엔드포인트에 엉뚱한 코드를
//      넣어보면, 쌍이 틀리면 invalid_client, 맞으면 invalid_grant 가 나옵니다.
//   4) Cloudflare 토큰이 살아있는지, 지정한 존을 만질 권한이 있는지
//
// 시크릿은 이 파일 안에서만 읽고 화면에 절대 출력하지 않습니다.

const { readFileSync, existsSync } = require('node:fs')
const path = require('node:path')

const varsFile = path.join(__dirname, '..', '.dev.vars')
const vars = {}
if (existsSync(varsFile)) {
  for (const line of readFileSync(varsFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (match) vars[match[1]] = match[2].trim()
  }
}

const ok = (text) => console.log(`  ✓ ${text}`)
const bad = (text) => console.log(`  ✗ ${text}`)
const note = (text) => console.log(`  · ${text}`)

async function checkDiscord() {
  console.log('\n[디스코드]')

  const status = await fetch('https://lubit.kr/api/engine/auth/discord/status')
    .then((r) => r.json())
    .catch(() => null)
  if (status?.configured) ok('lubit.kr 이 디스코드 로그인을 켰습니다')
  else {
    bad('lubit.kr 이 아직 꺼져 있습니다 — DISCORD_CLIENT_ID 가 안 올라갔습니다')
    return
  }

  const start = await fetch('https://lubit.kr/api/engine/auth/discord/start', { redirect: 'manual' })
  const location = start.headers.get('location') || ''
  if (!location.includes('discord.com/oauth2/authorize')) {
    bad(`로그인 시작이 디스코드로 가지 않습니다 (${start.status})`)
    return
  }
  const url = new URL(location)
  const clientId = url.searchParams.get('client_id')
  const redirect = url.searchParams.get('redirect_uri')
  ok(`로그인 시작 주소 정상 · scope=${url.searchParams.get('scope')}`)
  note(`redirect_uri=${redirect}`)
  if (vars.DISCORD_CLIENT_ID && clientId !== vars.DISCORD_CLIENT_ID) {
    bad('주소의 클라이언트 ID 가 .dev.vars 의 것과 다릅니다')
    return
  }
  ok('클라이언트 ID 일치')

  // 쌍 검사: 엉뚱한 code 를 넣습니다. 틀린 조합이면 invalid_client.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: 'lubit-check',
    redirect_uri: redirect,
    client_id: vars.DISCORD_CLIENT_ID || clientId,
    client_secret: vars.DISCORD_CLIENT_SECRET || '',
  })
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (data.error === 'invalid_client') {
    bad('클라이언트 ID / 시크릿 조합이 맞지 않습니다 — 둘 중 하나를 다시 확인해 주세요')
  } else if (data.error === 'invalid_grant' || data.error === 'invalid_request') {
    ok('클라이언트 ID / 시크릿 조합 정상 (code 가 유효하지 않은 것만 정상입니다)')
  } else {
    note(`Discord 응답: ${data.error || res.status}`)
  }
}

async function checkCloudflare() {
  console.log('\n[클라우드플레어]')
  const token = vars.CLOUDFLARE_API_TOKEN
  const zone = vars.CLOUDFLARE_ZONE_ID
  if (!token) {
    bad('CLOUDFLARE_API_TOKEN 이 비어 있습니다')
    return
  }

  const headers = { Authorization: `Bearer ${token}` }
  const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers })
    .then((r) => r.json())
    .catch(() => null)
  if (verify?.success) ok(`토큰 유효 (${verify.result?.status ?? 'active'})`)
  else {
    bad(`토큰 확인 실패: ${verify?.errors?.[0]?.message ?? '알 수 없음'}`)
    return
  }

  if (!zone) {
    bad('CLOUDFLARE_ZONE_ID 가 비어 있습니다')
    return
  }
  const info = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}`, { headers })
    .then((r) => r.json())
    .catch(() => null)
  if (!info?.success) {
    bad(`존 조회 실패: ${info?.errors?.[0]?.message ?? '권한이 없는 것 같습니다'} (Zone:Read 권한 확인)`)
    return
  }
  ok(`존 접근 정상: ${info.result.name}`)

  const records = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?per_page=1`, {
    headers,
  })
    .then((r) => r.json())
    .catch(() => null)
  if (records?.success) ok('DNS 레코드 조회 가능 — 도메인 자동 등록에 쓰는 권한이 있습니다')
  else bad(`DNS 조회 실패: ${records?.errors?.[0]?.message ?? '권한 확인 필요 (Zone:DNS:Edit)'}`)
}

async function main() {
  console.log('자격증명 확인 (값은 출력하지 않습니다)')
  await checkDiscord()
  await checkCloudflare()
}

main().catch((error) => console.error('실패:', error.message))
