// 로컬 개발 서버에 에이전트를 연결해 둔 상태로 새 API 전부를 검사합니다.
//   node scripts/dev-fixture.cjs   # 그림 만들기
//   node agent/core.js --base http://localhost:5173 --token <기기토큰> &
//   node scripts/test-api.mjs

import { readFileSync } from 'node:fs'
import assert from 'node:assert'

const fixture = JSON.parse(readFileSync(new URL('../.fixture.tmp.json', import.meta.url), 'utf8'))
const BASE = 'http://localhost:5173/api/engine'
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${fixture.userToken}` }

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path} → ${response.status} ${data.error ?? ''}`)
  return data
}

// 결과를 되돌려받는 명령을 보내고 폴링합니다.
async function run(type, args = {}, timeoutMs = 120_000) {
  const { id } = await call(`/servers/${fixture.serverId}/commands`, { method: 'POST', body: { type, args } })
  const started = Date.now()
  for (;;) {
    const row = await call(`/commands/${id}`)
    if (row.status === 'done') return JSON.parse(row.result || '{}')
    if (row.status === 'failed') throw new Error(`${type} 실패: ${row.result}`)
    if (Date.now() - started > timeoutMs) throw new Error(`${type} 시간 초과`)
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
}

const results = []

// 1) 파일 목록
const list = await run('file_list', { path: '.' })
const names = list.entries.map((entry) => entry.name)
assert.ok(names.includes('server.properties'), 'server.properties 노출')
assert.ok(names.includes('plugins'), 'plugins 폴더 노출')
assert.ok(names.includes('world'), 'world 폴더 노출')
results.push(`file_list: ${names.join(', ')}`)

// 2) 파일 읽기
const read = await run('file_read', { path: 'server.properties' })
assert.ok(read.content.includes('level-name=world'), '파일 내용')
results.push(`file_read: ${read.content.split('\n').length}줄`)

// 3) 폴더 밖 접근 차단
const outside = await fetch(`${BASE}/servers/${fixture.serverId}/commands`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ type: 'file_read', args: { path: '../../../windows/win.ini' } }),
}).then((res) => res.json())
let outsideRow = { status: 'pending' }
for (let i = 0; i < 60 && outsideRow.status === 'pending'; i++) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  outsideRow = await call(`/commands/${outside.id}`)
}
assert.strictEqual(outsideRow.status, 'failed', '폴더 밖 접근은 실패로 돌아와야 함')
results.push(`path 차단: ${outsideRow.result}`)

// 4) 플러그인 목록
const plugins = await run('plugin_list', {})
assert.strictEqual(plugins.entries[0]?.name, 'FixturePlugin.jar', '플러그인 파일')
results.push(`plugin_list: ${plugins.entries.map((entry) => entry.name).join(', ')}`)

// 5) Modrinth 검색 (에이전트 불필요)
const search = await call(`/modrinth/search?q=${encodeURIComponent('luckperms')}`)
assert.ok(search.hits.length > 0, 'Modrinth 검색 결과')
results.push(`modrinth: ${search.hits[0].title} (${search.hits[0].downloads}회)`)

const versions = await call(`/modrinth/versions?slug=${encodeURIComponent(search.hits[0].slug)}`)
assert.ok(versions.versions.length > 0, 'Modrinth 버전 목록')
results.push(`버전: ${versions.versions[0].version} · 파일 ${versions.versions[0].file.filename}`)

// 6) 월드 지도
const drawn = await run('world_map', {})
assert.strictEqual(drawn.width, 512, '지도 가로')
const map = await call(`/servers/${fixture.serverId}/worldmap`)
const png = Buffer.from(map.png, 'base64')
assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', '지도 PNG')
results.push(`world_map: ${map.world} · ${(png.length / 1024).toFixed(1)}KB · ${map.blocksPerPixel}블록/픽셀`)

// 7) 접속 정보
const access = await call(`/servers/${fixture.serverId}/access`)
assert.strictEqual(access.configured, false, '중계 서버 미설정 상태')
assert.strictEqual(access.dnsConfigured, false, 'DNS 미설정 상태')
results.push(`access: configured=${access.configured} dns=${access.dnsConfigured}`)

// 8) 플레이어 이름 필드
const servers = await call('/servers')
assert.ok('player_names' in servers.servers[0], 'player_names 컬럼 노출')
results.push(`servers 컬럼: player_names=${servers.servers[0].player_names} relay_port=${servers.servers[0].relay_port}`)

console.log(results.map((line) => ' ✓ ' + line).join('\n'))
console.log('API 검사 통과')
