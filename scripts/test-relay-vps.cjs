// 실제 운영(lubit.kr) + VPS 중계 서버로 끝까지 검사합니다.
//   node scripts/test-relay-vps.cjs
//
// 검사용 계정을 하나 만들었다가 쓰고, 마지막에 지워야 할 계정 이름을 알려줍니다.
//   1) 계정·기기·서버 등록 → /agent/relay 가 공인 포트를 받아오는지
//   2) 집 PC(여기)의 에이전트가 VPS 중계 서버에 연결하고 포트를 열리는지
//   3) 바깥에서 그 포트로 접속해 바이트가 왕복하는지
//
// VPS 가 꺼져 있으면 1번에서 이미 실패합니다.

const assert = require('node:assert')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const BASE = (process.env.LUBIT_BASE || 'https://lubit.kr').replace(/\/+$/, '')
const API = `${BASE}/api/engine`

const { RelayClient } = require('../agent/relay')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve))

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(API + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${pathname} → ${response.status} ${data.error ?? ''}`)
  return data
}

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function main() {
  const localPort = await freePort()
  const stamp = Date.now().toString(36)
  const email = `relay-vps-${stamp}@lubit.test`

  // 1) 검사용 계정 만들기
  const auth = await call('/auth/register', {
    method: 'POST',
    body: { email, password: `relay-${stamp}-pw`, name: '중계검증' },
  })
  const device = await call('/devices', { method: 'POST', token: auth.token, body: { name: '중계 검증 PC' } })
  const server = await call('/servers', {
    method: 'POST',
    token: auth.token,
    body: {
      name: '중계 검증 서버',
      javaCmd: 'java -Xmx1G -jar server.jar nogui',
      serverDir: os.tmpdir(),
      version: '1.21.4',
      type: 'paper',
      port: localPort,
    },
  })
  await call(`/servers/${server.id}/assign`, { method: 'POST', token: auth.token, body: { deviceId: device.id } })
  console.log(`· 검사 계정 ${email} · 서버 #${server.id}`)

  // 2) 중계 정보 받기
  const info = await call('/agent/relay', { token: device.token })
  assert.strictEqual(info.enabled, true, '중계가 켜져 있어야 합니다')
  assert.ok(info.host, '중계 주소가 있어야 합니다')
  const publicPort = Number(info.servers?.[0]?.port)
  assert.ok(publicPort > 0, '공인 포트가 배정되어야 합니다')
  console.log(`· 중계 주소 ${info.host}:${info.controlPort} · 공인 포트 ${publicPort}`)

  // 3) 집 쪽 가짜 마크 서버(에코) 띄우기
  const fake = net.createServer((socket) => socket.pipe(socket))
  await new Promise((resolve) => fake.listen(localPort, '127.0.0.1', resolve))

  // 4) 에이전트를 VPS 에 연결
  const logs = []
  const client = new RelayClient({
    host: info.host,
    port: info.controlPort,
    token: device.token,
    servers: [{ id: server.id, localPort }],
    log: (message) => logs.push(message),
  })
  client.start()

  let connected = false
  for (let i = 0; i < 30 && !connected; i++) {
    await wait(500)
    connected = logs.some((line) => line.includes('연결됨'))
  }
  assert.ok(connected, `VPS 인증에 실패했습니다: ${logs.join(' | ') || '(응답 없음)'}`)
  console.log(`· VPS 인증 완료 — ${logs.find((line) => line.includes('연결됨'))}`)

  // 5) 바깥에서 공인 포트로 접속해 왕복
  const player = net.connect(publicPort, info.host)
  const received = []
  player.on('data', (chunk) => received.push(chunk.toString('utf8')))
  player.on('error', () => undefined)
  await Promise.race([once(player, 'connect'), wait(8000)])
  assert.strictEqual(player.readyState, 'open', `공인 포트 ${publicPort} 에 연결하지 못했습니다`)

  player.write('hello vps relay')
  for (let i = 0; i < 20 && received.join('') !== 'hello vps relay'; i++) await wait(500)
  assert.strictEqual(received.join(''), 'hello vps relay', '플레이어 → VPS → 집 PC → 서버 왕복')
  console.log(`· 플레이어 경유 왕복 확인 (공인 포트 ${publicPort})`)

  player.destroy()
  client.stop()
  fake.close()
  await wait(300)

  console.log('실제 VPS 중계 검사 통과')
  console.log(`\n검사 후 정리할 계정: ${email}`)
  console.log('정리 명령을 마지막에 실행합니다.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error.message)
    process.exit(1)
  })
