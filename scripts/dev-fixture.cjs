// 로컬 검증용 그림입니다.
//   node scripts/dev-fixture.cjs
// 가짜 서버 폴더를 만들고, 계정·기기·서버를 API 에 등록한 뒤 에이전트가 쓸
// 토큰과 서버 id 를 JSON 으로 돌려줍니다. 로컬 개발 서버(5173)에만 씁니다.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createFakeWorld } = require('./fake-world.cjs')

const BASE = process.env.LUBIT_BASE || 'http://localhost:5173'
const API = `${BASE}/api/engine`

async function call(pathname, { method = 'GET', token, body } = {}) {
  const response = await fetch(API + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${pathname} → ${response.status} ${data.error ?? ''}`)
  return data
}

async function main() {
  // 1) 가짜 서버 폴더
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubit-fixture-'))
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'server.properties'),
    ['level-name=world', 'server-port=25565', 'motd=fixture', 'online-mode=true'].join('\n'),
  )
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(dir, 'bukkit.yml'), 'settings:\n  allow-end: true\n')
  fs.writeFileSync(path.join(dir, 'plugins', 'FixturePlugin.jar'), Buffer.alloc(2048))
  createFakeWorld(path.join(dir, 'world'))

  // 2) 계정 · 기기 · 서버 등록
  const stamp = Date.now().toString(36)
  const email = `fixture-${stamp}@lubit.test`
  const password = `fixture-${stamp}-pw`
  const auth = await call('/auth/register', {
    method: 'POST',
    body: { email, password, name: '검증용' },
  })
  const token = auth.token

  const device = await call('/devices', { method: 'POST', token, body: { name: '검증 PC' } })
  const server = await call('/servers', {
    method: 'POST',
    token,
    body: {
      name: '검증 서버',
      javaCmd: 'java -Xmx1G -jar server.jar nogui',
      serverDir: dir,
      version: '1.21.1',
      type: 'paper',
      port: 25565,
    },
  })
  await call(`/servers/${server.id}/assign`, { method: 'POST', token, body: { deviceId: device.id } })

  console.log(
    JSON.stringify({ email, password, userToken: token, deviceToken: device.token, serverId: server.id, dir }, null, 2),
  )
}

main().catch((error) => {
  console.error('실패:', error.message)
  process.exit(1)
})
