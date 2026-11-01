// 실제 API로 중계 서버를 검사합니다.
//   node scripts/test-relay-live.cjs            (개발 서버 5174)
//   LUBIT_BASE=http://localhost:5173 node ...
//
// 계정·기기·서버를 만들고, 중계 서버가 lubit.kr 대신 로컬 API에서 공인 포트를
// 받아 열리는지, 그 포트로 들어온 바이트가 집에 있는(가짜) 서버까지 왕복하는지까지 봅니다.

const assert = require('node:assert')
const net = require('node:net')

const BASE = (process.env.LUBIT_BASE || 'http://localhost:5174').replace(/\/+$/, '')
process.env.LUBIT_BASE = BASE

const API = `${BASE}/api/engine`
const LOCAL_PORT = 25599 // 집 쪽 마크 서버 자리 (공인 포트 25565와 겹치지 않게)

const { createRelay, fetchServers } = require('../relay/server')
const { RelayClient } = require('../agent/relay')

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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const once = (emitter, event) => new Promise((resolve) => emitter.once(event, resolve))

async function main() {
  // 1) 계정 · 기기 · 서버 만들기
  const stamp = Date.now().toString(36)
  const auth = await call('/auth/register', {
    method: 'POST',
    body: { email: `relay-${stamp}@lubit.test`, password: `relay-${stamp}-pw`, name: '중계검증' },
  })
  const device = await call('/devices', { method: 'POST', token: auth.token, body: { name: '중계 검증 PC' } })
  const server = await call('/servers', {
    method: 'POST',
    token: auth.token,
    body: {
      name: '중계 검증 서버',
      javaCmd: 'java -jar server.jar nogui',
      serverDir: require('node:os').tmpdir(),
      version: '1.21.1',
      type: 'paper',
      port: LOCAL_PORT,
    },
  })
  await call(`/servers/${server.id}/assign`, { method: 'POST', token: auth.token, body: { deviceId: device.id } })

  // 2) 에이전트가 물어보는 중계 정보
  const info = await call('/agent/relay', { token: device.token })
  assert.strictEqual(info.enabled, true, '중계 활성화')
  assert.ok(Number(info.controlPort) > 0, '중계 제어 포트')
  assert.strictEqual(info.servers.length, 1, '배정된 서버 1대')
  const publicPort = Number(info.servers[0].port)
  console.log(`· 중계 정보 host=${info.host || '(미설정)'} control=${info.controlPort} 공인포트=${publicPort}`)

  // 3) 집 쪽 가짜 마크 서버 + 중계 서버 + 에이전트
  const fake = net.createServer((socket) => socket.pipe(socket)) // 받은 내용을 그대로
  await new Promise((resolve) => fake.listen(LOCAL_PORT, '127.0.0.1', resolve))

  const logs = []
  const relay = createRelay({ auth: fetchServers, onLog: (line) => logs.push(line) })
  await relay.listenControl(info.controlPort)

  const client = new RelayClient({
    host: '127.0.0.1',
    port: info.controlPort,
    token: device.token,
    servers: [{ id: server.id, localPort: LOCAL_PORT }],
    log: (message) => logs.push(message),
  })
  client.start()
  await wait(600)

  assert.strictEqual(relay.sessionCount, 1, '중계 서버에 기기 연결')
  const authed = logs.some((line) => line.includes('연결됨'))
  assert.ok(authed, `에이전트 인증 성공 (${logs.join(' | ')})`)

  // 4) 플레이어가 공인 포트로 들어와 바이트가 왕복합니다.
  const player = net.connect(publicPort, '127.0.0.1')
  await once(player, 'connect')
  const got = []
  player.on('data', (chunk) => got.push(chunk.toString('utf8')))
  player.write('hello relay live')
  await wait(500)
  assert.strictEqual(got.join(''), 'hello relay live', '플레이어 → 중계 → 에이전트 → 서버 왕복')

  player.destroy()
  await wait(200)
  assert.strictEqual(client.conns.size, 0, '끊긴 접속 정리')

  console.log('실제 API 중계 검사 통과')

  client.stop()
  relay.close()
  fake.close()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error.message)
    process.exit(1)
  })
