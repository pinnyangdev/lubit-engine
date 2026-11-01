// 도메인 자동 등록을 실제로 한 번 만들어 보고 지웁니다.
//   node scripts/test-domain.cjs
//
//   1) 검사용 계정·서버 생성
//   2) 이름.lubit.kr 등록 → Cloudflare 에 A 레코드와 _minecraft._tcp SRV 가 생기는지 확인
//   3) 등록 해제 → 레코드가 사라졌는지 확인
//
// 검사 후 지워야 할 계정 이름을 마지막에 알려줍니다.

const assert = require('node:assert')
const { readFileSync, existsSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const BASE = (process.env.LUBIT_BASE || 'https://lubit.kr').replace(/\/+$/, '')
const API = `${BASE}/api/engine`

const vars = {}
const varsFile = path.join(__dirname, '..', '.dev.vars')
if (existsSync(varsFile)) {
  for (const line of readFileSync(varsFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
    if (match) vars[match[1]] = match[2].trim()
  }
}
const CF = { Authorization: `Bearer ${vars.CLOUDFLARE_API_TOKEN}` }
const ZONE = vars.CLOUDFLARE_ZONE_ID

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(API + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${pathname} → ${response.status} ${JSON.stringify(data)}`)
  return data
}

async function dnsRecords(name) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records?name=${encodeURIComponent(name)}`,
    { headers: CF },
  )
  const data = await res.json()
  if (!data.success) throw new Error(`DNS 조회 실패: ${data.errors?.[0]?.message}`)
  return data.result
}

async function main() {
  assert.ok(vars.CLOUDFLARE_API_TOKEN && ZONE, '.dev.vars 에 Cloudflare 값이 없습니다')

  const stamp = Date.now().toString(36)
  const label = `lubitcheck${stamp}`
  const email = `domain-${stamp}@lubit.test`

  const auth = await call('/auth/register', {
    method: 'POST',
    body: { email, password: `domain-${stamp}-pw`, name: '도메인검증' },
  })
  const server = await call('/servers', {
    method: 'POST',
    token: auth.token,
    body: {
      name: '도메인 검증 서버',
      javaCmd: 'java -jar server.jar nogui',
      serverDir: os.tmpdir(),
      version: '1.21.4',
      type: 'paper',
      port: 25590,
    },
  })
  console.log(`· 검사 계정 ${email} · 서버 #${server.id}`)

  // 1) 등록
  const created = await call(`/servers/${server.id}/domain`, {
    method: 'POST',
    token: auth.token,
    body: { name: label },
  })
  assert.strictEqual(created.domain, `${label}.lubit.kr`, '등록된 도메인')
  console.log(`· 등록 완료 ${created.domain} · 공인 포트 ${created.relayPort} · SRV 대상 ${created.relayHost}`)

  // 2) 레코드 확인 — SRV 는 이름 앞에 _minecraft._tcp. 가 붙습니다
  const records = await dnsRecords(created.domain)
  const srvRecords = await dnsRecords(`_minecraft._tcp.${created.domain}`)
  const a = records.find((r) => r.type === 'A')
  const srv = srvRecords.find((r) => r.type === 'SRV')
  assert.ok(a, 'A 레코드가 있어야 합니다')
  assert.strictEqual(a.content, vars.RELAY_IP, 'A 레코드 값')
  assert.strictEqual(a.proxied, false, '게임 TCP 는 프록시를 끄고 써야 합니다')
  assert.ok(srv, 'SRV 레코드가 있어야 합니다')
  assert.strictEqual(srv.data.port, created.relayPort, 'SRV 포트')
  assert.strictEqual(srv.data.target, 'relay.lubit.kr', 'SRV 는 호스트네임이어야 합니다 (IP 는 거절됩니다)')
  console.log(`· A ${a.name} → ${a.content} (프록시 ${a.proxied ? '켜짐' : '꺼짐'})`)
  console.log(`· SRV _minecraft._tcp.${created.domain} → ${srv.data.target}:${srv.data.port}`)

  // 3) 해제
  await call(`/servers/${server.id}/domain`, { method: 'DELETE', token: auth.token })
  const after = await dnsRecords(created.domain)
  const afterSrv = await dnsRecords(`_minecraft._tcp.${created.domain}`)
  assert.strictEqual(after.length + afterSrv.length, 0, `레코드가 남아 있습니다: ${JSON.stringify(after.concat(afterSrv).map((r) => r.type))}`)
  console.log('· 등록 해제 후 레코드 0건 확인')

  console.log('\n도메인 자동 등록 검사 통과')
  console.log(`검사 후 정리할 계정: ${email}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error.message)
    process.exit(1)
  })
