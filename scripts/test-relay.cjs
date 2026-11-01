// 중계 서버 ↔ 에이전트 연결을 실제로 띄워 검사합니다.
//   node scripts/test-relay.cjs
// 가짜 마크 서버(에코) → 중계 → 에이전트 → 가짜 마크 서버 순으로 바이트가
// 왕복하는지, 기기가 없을 때 접속이 거절되는지까지 봅니다.

const assert = require('node:assert')
const net = require('node:net')

const { createRelay } = require('../relay/server')
const { RelayClient } = require('../agent/relay')

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const playerPort = await freePort()
  const localPort = await freePort()
  const controlPort = await freePort()

  // 가짜 마크 서버 — 받은 내용을 그대로 돌려줍니다.
  const fakeServer = net.createServer((socket) => socket.pipe(socket))
  await new Promise((resolve) => fakeServer.listen(localPort, '127.0.0.1', resolve))

  // 인증은 서버 목록을 스텁으로 대신합니다. (실제 서버는 lubit.kr 에서 받습니다)
  const relay = createRelay({
    auth: async (token) => {
      assert.strictEqual(token, 'device-token', '기기 토큰 전달')
      return [{ id: 7, port: playerPort }]
    },
    onLog: () => undefined,
  })
  await relay.listenControl(controlPort)

  const logs = []
  const client = new RelayClient({
    host: '127.0.0.1',
    port: controlPort,
    token: 'device-token',
    servers: [{ id: 7, localPort }],
    log: (message) => logs.push(message),
  })
  client.start()

  // 인증 handshake 가 끝날 때까지
  await wait(300)

  // 1) 플레이어가 중계 포트로 들어와 에코 서버까지 왕복합니다.
  const player = net.connect(playerPort, '127.0.0.1')
  await once(player, 'connect')
  const received = []
  player.on('data', (chunk) => received.push(chunk.toString('utf8')))
  player.write('hello relay')
  await wait(300)
  assert.strictEqual(received.join(''), 'hello relay', '바이트 왕복')
  player.destroy()

  // 2) 접속이 끊기면 양쪽 소켓이 정리됩니다.
  await wait(150)
  assert.strictEqual(client.conns.size, 0, '끊긴 접속 정리')

  // 3) 기기가 내려가면 새 플레이어는 받지 않습니다.
  client.stop()
  await wait(250)
  const refused = net.connect(playerPort, '127.0.0.1')
  refused.on('error', () => undefined)
  const closed = await Promise.race([
    once(refused, 'close').then(() => true),
    once(refused, 'error').then(() => true),
    wait(1500).then(() => false),
  ])
  refused.destroy()
  assert.ok(closed, '기기 없을 때 접속 종료')

  console.log(`relay 세션 ${relay.sessionCount} · 에이전트 로그 ${logs.length}줄`)
  console.log('중계 프로토콜 검사 통과')

  relay.close()
  fakeServer.close()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error)
    process.exit(1)
  })
