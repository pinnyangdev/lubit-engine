// 로컬 E2E: 계정 → 서버 → 기기 → 에이전트 실행 → 시작 → 로그 확인 → 중지
// 실행: node e2e.cjs   (임시 파일, 검증 후 삭제)
const { spawn } = require('node:child_process')
const path = require('node:path')

const ORIGIN = 'http://localhost:5173'
const API = `${ORIGIN}/api/engine`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let agentProc = null
let agentLog = ''

async function call(method, pathname, body, token) {
  const response = await fetch(API + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

async function until(label, fn, timeoutMs = 20000) {
  const start = Date.now()
  for (;;) {
    const result = await fn()
    if (result) return result
    if (Date.now() - start > timeoutMs) throw new Error(`${label}: 타임아웃`)
    await sleep(700)
  }
}

;(async () => {
  const stamp = Date.now()
  const email = `e2e-${stamp}@example.com`
  const reg = await call('POST', '/auth/register', { email, password: 'e2e-password-1', name: 'E2E' })
  if (reg.status !== 200) throw new Error('가입 실패: ' + JSON.stringify(reg.data))
  const userToken = reg.data.token

  const server = await call('POST', '/servers', {
    name: 'E2E 서버',
    javaCmd: 'node fake-server.js',
    serverDir: path.join(__dirname),
  }, userToken)
  const serverId = server.data.id

  const device = await call('POST', '/devices', { name: 'E2E PC' }, userToken)
  const deviceToken = device.data.token
  await call('POST', `/servers/${serverId}/assign`, { deviceId: device.data.id }, userToken)

  console.log('1. 에이전트 기동')
  console.log('   계정', email)
  agentProc = spawn('node', ['core.js', '--base', ORIGIN, '--token', deviceToken], { cwd: __dirname })
  agentProc.stdout.on('data', (d) => { agentLog += d })
  agentProc.stderr.on('data', (d) => { agentLog += d })
  await sleep(2500)

  console.log('2. 시작 명령')
  await call('POST', `/servers/${serverId}/commands`, { type: 'start' }, userToken)

  console.log('3. 로그와 상태 확인')
  const logResult = await until('로그 도착', async () => {
    const r = await call('GET', `/servers/${serverId}/logs?since=0`, null, userToken)
    const text = r.data.logs?.map((l) => l.line).join('\n') ?? ''
    return text.includes('Done (') ? text : null
  })
  console.log('   로그 수신 ✓', logResult.split('\n').length, '줄')

  const running = await until('실행 상태', async () => {
    const r = await call('GET', '/servers', null, userToken)
    const row = r.data.servers.find((s) => s.id === serverId)
    return row?.state === 'running' ? row : null
  })
  console.log('   상태 = running ✓')

  const players = await until('접속 인원 파싱', async () => {
    const r = await call('GET', '/servers', null, userToken)
    const row = r.data.servers.find((s) => s.id === serverId)
    return row?.players === 2 ? row : null
  })
  console.log('   접속 인원 =', players.players, '/', players.max_players, '✓')

  console.log('4. 콘솔 명령')
  await call('POST', `/servers/${serverId}/commands`, { type: 'command', args: { line: 'say 안녕하세요' } }, userToken)
  await until('say 로그', async () => {
    const r = await call('GET', `/servers/${serverId}/logs?since=0`, null, userToken)
    const text = r.data.logs?.map((l) => l.line).join('\n') ?? ''
    return text.includes('[Server] 안녕하세요') ? true : null
  })
  console.log('   say 수신 ✓')

  console.log('5. 중지 명령')
  await call('POST', `/servers/${serverId}/commands`, { type: 'stop' }, userToken)
  await until('중지 완료', async () => {
    const r = await call('GET', '/servers', null, userToken)
    const row = r.data.servers.find((s) => s.id === serverId)
    return row?.state === 'offline' ? row : null
  })
  console.log('   상태 = offline ✓')

  agentProc.kill()
  agentProc = null
  console.log('\nE2E 전체 통과')
})().catch((error) => {
  console.error('E2E 실패:', error.message)
  console.error('--- 에이전트 로그 ---')
  console.error(agentLog.trim() || '(없음)')
  if (agentProc) agentProc.kill()
  process.exit(1)
})
