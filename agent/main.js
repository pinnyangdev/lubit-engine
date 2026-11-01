const { app, BrowserWindow, Menu, MenuItem, Notification, Tray, ipcMain, nativeImage, shell, dialog } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { once } = require('node:events')

const { EngineAgent } = require('./core')
const provision = require('./provision')
const backupStore = require('./backup')
const prefsStore = require('./prefs')
const importer = require('./import')

let window = null
let tray = null
let trayStatus = null
let agent = null
let config = null

// 계정 로그인 후 알게 되는 값들. 화면에는 여기를 그대로 넘깁니다.
const ctx = {
  user: null, // { email, displayName }
  device: null, // { id, token, name } — 이 PC의 기기 자격증명
  root: provision.defaultRoot(), // 서버가 생기는 폴더 (C:\LubitServers)
  servers: [], // 계정이 가진 서버 전체 (웹·앱이 같은 목록)
  provisioning: null, // 서버 만드는 중일 때 진행 상황
}

let state = {
  connected: false,
  message: '로그인해 주세요',
  servers: [],
  locals: [],
  user: null,
  root: ctx.root,
  provisioning: null,
}
// 서버별 직전 상태 — 알림을 새로 뜨는 상태 변화만 보내기 위해 씁니다.
let phase = new Map()
let quitting = false
let pollTimer = null

// Windows 알림·작업 표시줄 묶음은 이 ID로 찾습니다. 설치판과 같은 값을 써야 합니다.
app.setAppUserModelId('kr.lubit.serverengine')

function configPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function defaultConfig() {
  return {
    base: 'https://lubit.kr',
    session: '', // 계정 세션 토큰
    user: null,
    device: null, // { id, token, name }
    legacyToken: '', // 옛 버전에 수동으로 붙여 넣은 기기 토큰
    root: provision.defaultRoot(),
  }
}

function readConfig() {
  try {
    return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
  } catch {
    return defaultConfig()
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
}

// 앱 설정(자동 실행·서버 복원)과 서버별 설정(웹훅·스케줄) — prefs.json 에 둡니다.
let prefs = null

function prefsPath() {
  return path.join(app.getPath('userData'), 'prefs.json')
}

function loadPrefs() {
  prefs = prefsStore.load(prefsPath())
  return prefs
}

function savePrefs() {
  if (!prefs) return
  try {
    prefsStore.save(prefsPath(), prefs)
  } catch {
    /* 쓰지 못하는 환경 — 이번 실행의 설정만 씁니다 */
  }
}

function serverPrefs(serverId) {
  if (!prefs) loadPrefs()
  return prefsStore.forServer(prefs, serverId)
}

// 윈도우 시작 시 자동 실행 — 설치판에서만 의미가 있습니다.
function applyAutostart() {
  if (!app.isPackaged || !prefs) return
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(prefs.autostart), path: process.execPath })
  } catch {
    /* 설정을 못 바꾸는 환경 */
  }
}

// --- API -------------------------------------------------------------------

async function api(pathname, { method = 'GET', body, token } = {}) {
  const bearer = token ?? config.session
  const response = await fetch(`${config.base}/api/engine${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let data = {}
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('API 응답이 아닙니다 — 주소를 확인하세요')
  }
  if (!response.ok) {
    const error = new Error(data.error || `오류가 발생했습니다. (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

// 이 PC가 아닌 서버(다른 기기에 등록된 서버)에는 콘솔·파일 같은 명령을 웹과 같은 경로로 보냅니다.
async function runViaApi(serverId, type, args = {}) {
  const { id } = await api(`/servers/${serverId}/commands`, { method: 'POST', body: { type, args } })
  const started = Date.now()
  for (;;) {
    const row = await api(`/commands/${id}`)
    if (row.status === 'done') return row.result || ''
    if (row.status === 'failed') throw new Error(row.result || '명령이 실패했습니다.')
    if (Date.now() - started > 60_000) {
      throw new Error('기기가 응답하지 않습니다. 그 서버를 관리하는 PC 앱이 켜져 있는지 확인해 주세요.')
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

// --- 화면 상태 -------------------------------------------------------------

function runningCount() {
  return (state.locals || []).filter((item) =>
    item.state === 'running' || item.state === 'starting' || item.state === 'stopping',
  ).length
}

function statusLine() {
  if (!ctx.user) return '로그인 필요'
  const link = state.connected ? '연결됨' : '연결 안 됨'
  const running = runningCount()
  return running > 0 ? `${link} · 실행 중 ${running}개` : link
}

function push() {
  if (window && !window.isDestroyed()) window.webContents.send('agent:state', state)
  if (tray) {
    tray.setToolTip(`루빗 서버 구동기 — ${statusLine()}`)
    if (trayStatus) trayStatus.label = `상태: ${statusLine()}`
  }
}

// 상태가 바뀔 때만 알립니다 — 로그 한 줄마다 뜨지 않게 마지막 단계를 기억합니다.
function notifyChanges(previous) {
  const supported = Notification.isSupported()
  const text = { running: '실행되었습니다', crashed: '중지되었습니다 (오류)', offline: '종료되었습니다' }
  const kindOf = { running: 'start', crashed: 'crash', offline: 'stop' }
  for (const local of state.locals || []) {
    const before = previous.get(local.id)
    const label = text[local.state]
    if (before && before !== local.state && label) {
      const server = (state.servers || []).find((item) => item.id === local.id)
      if (supported) {
        try {
          new Notification({ title: server ? server.name : '서버', body: label }).show()
        } catch {
          /* 알림을 못 띄우는 환경 */
        }
      }
      // 디스코드 웹훅도 같은 순간에 보냅니다 — 서버별로 켜져 있을 때만.
      void notifyWebhook(local.id, kindOf[local.state])
    }
    phase.set(local.id, local.state)
  }
}

// --- 디스코드 웹훅 ---------------------------------------------------------
// 서버별 설정에 주소가 있고 그 이벤트가 켜져 있을 때만 보냅니다.
// 주소는 https 만 허용하고, 실패해도 앱 동작은 그대로 둡니다.
function postWebhook(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  }).then((response) => {
    if (!response.ok) throw new Error(`웹훅이 응답하지 않습니다. (${response.status})`)
    return response
  })
}

function webhookPayload(serverName, title, note, color) {
  return {
    username: '루빗 서버 구동기',
    embeds: [
      {
        title: `${serverName} — ${title}`,
        description: note || undefined,
        color: color || 0xa0b3ae,
        timestamp: new Date().toISOString(),
        footer: { text: 'lubit.kr' },
      },
    ],
  }
}

async function notifyWebhook(serverId, kind, note = '') {
  try {
    if (!prefs) return
    const cfg = serverPrefs(serverId)
    if (!cfg.webhook || cfg.webhookEvents[kind] === false) return
    if (!/^https:\/\/[\w.-]+\//.test(cfg.webhook)) return
    const server = (state.servers || []).find((item) => item.id === serverId)
    const title = { start: '서버가 시작되었습니다', stop: '서버가 중지되었습니다', crash: '서버가 오류로 중지되었습니다', backup: '백업이 완료되었습니다' }
    const color = { start: 0x4ade80, stop: 0x22d3ee, crash: 0xfb7185, backup: 0x4ade80 }
    await postWebhook(
      cfg.webhook,
      webhookPayload(server ? server.name : '서버', title[kind] || kind, note, color[kind]),
    )
  } catch {
    /* 웹훅 실패는 알림에 맡기고 넘어갑니다 */
  }
}

// --- 자동 시작 · 종료 스케줄 ----------------------------------------------
// 이 PC에서 돌리는 서버만 대상입니다. 앱이 켜져 있는 동안만 지킵니다.
let scheduleTimer = null

function pad2(value) {
  return String(value).padStart(2, '0')
}

async function checkSchedules() {
  if (!agent || !prefs) return
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  for (const server of state.servers || []) {
    if (!server.local) continue
    const cfg = serverPrefs(server.id)
    const schedule = cfg.schedule
    if (!schedule || !schedule.enabled) continue
    if (!(Array.isArray(schedule.days) && schedule.days.includes(now.getDay()))) continue

    for (const [key, time] of [
      ['start', schedule.startAt],
      ['stop', schedule.stopAt],
    ]) {
      if (!time || !/^\d{2}:\d{2}$/.test(time)) continue
      const [hour, minute] = time.split(':').map(Number)
      const target = hour * 60 + minute
      // 시각에서 5분 안에 있을 때만 — 앱을 늦게 켜도 갑자기 켜지지 않게 합니다.
      if (nowMin < target || nowMin > target + 4) continue
      if (String(schedule.fired || '') === `${today}:${key}`) continue

      schedule.fired = `${today}:${key}`
      savePrefs()
      try {
        if (key === 'start') {
          const local = ((agent && agent.locals()) || []).find((item) => item.id === server.id)
          if (!local || !['running', 'starting'].includes(local.state)) {
            await agent.runLocal(server.id, 'start', {})
            void notifyWebhook(server.id, 'start', `예약된 시작 (${time})`)
          }
        } else {
          await agent.runLocal(server.id, 'stop', {})
          void notifyWebhook(server.id, 'stop', `예약된 중지 (${time})`)
        }
      } catch (error) {
        console.error(`[스케줄] ${key} 실패 (서버 ${server.id})`, error)
      }
    }
  }
}

function startScheduleTimer() {
  if (scheduleTimer) clearInterval(scheduleTimer)
  scheduleTimer = setInterval(() => void checkSchedules(), 30_000)
}

function applyState(patch = {}) {
  const previous = new Map(phase)
  const localIds = new Set(((agent && agent.state.servers) || []).map((item) => item.id))
  state = {
    ...state,
    ...patch,
    // 계정 서버 전체를 넘기되, 이 PC에서 돌릴 수 있는 것에 표시를 붙입니다.
    servers: ctx.servers.map((server) => ({
      ...server,
      local: localIds.has(server.id) || (ctx.device && server.device_id === ctx.device.id),
    })),
    locals: agent ? agent.locals() : [],
    user: ctx.user,
    root: ctx.root,
    provisioning: ctx.provisioning,
  }
  notifyChanges(previous)
  push()
}

function showWindow() {
  if (!window || window.isDestroyed()) createWindow()
  window.show()
  window.focus()
}

async function quitFromTray() {
  const running = runningCount()
  if (running > 0) {
    // 창이 트레이에 숨어 있으면 대화상자도 같이 보이게 앞으로 올립니다.
    const parent = window && !window.isDestroyed() ? window : undefined
    const ok = await confirmDialog({
      parent,
      title: '루빗 서버 구동기 종료',
      message: `실행 중인 서버 ${running}개가 함께 중지됩니다.`,
      detail: '창을 닫으면 트레이로 내려갈 뿐 서버는 계속 실행됩니다. 종료는 여기서만 합니다.',
      confirmLabel: '그래도 종료',
      danger: true,
    })
    if (!ok) return
  }
  quitting = true
  app.quit()
}

// --- 확인 창 ---------------------------------------------------------------
// 윈도 기본 대화상자는 글자색·버튼 배열이 앱이랑 따로 놀아서 답답해 보였습니다.
// 색과 모서리를 앱과 같은 값으로 직접 그린 작은 창을 씁니다. 닫기 · Esc 는 취소입니다.
const dialogAnswers = new Map() // webContents.id → 한 번만 부르는 답장

ipcMain.handle('dialog:answer', (event, value) => {
  const finish = dialogAnswers.get(event.sender.id)
  if (finish) finish(Boolean(value))
})

function confirmDialog({
  parent,
  title,
  message,
  detail = '',
  confirmLabel = '확인',
  danger = false,
  width = 460,
  height = 244,
}) {
  return new Promise((resolve) => {
    const host = parent && !parent.isDestroyed() ? parent : null
    if (host && !host.isVisible()) host.show()

    const box = new BrowserWindow({
      width,
      height,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      frame: false,
      modal: Boolean(host),
      parent: host || undefined,
      backgroundColor: '#0d1113',
      title,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    })

    const id = box.webContents.id
    let answered = false
    const finish = (value) => {
      if (answered) return
      answered = true
      dialogAnswers.delete(id)
      resolve(Boolean(value))
      if (!box.isDestroyed()) box.close()
    }
    dialogAnswers.set(id, finish)
    // X 로 닫거나 Esc 를 누르면 취소로 받습니다.
    box.on('closed', () => {
      dialogAnswers.delete(id)
      if (!answered) {
        answered = true
        resolve(false)
      }
    })
    box.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault()
        finish(false)
      }
    })

    // 문구는 주소 파라미터로 넘기고, 모양은 dialog.html 이 그립니다.
    box.once('ready-to-show', () => {
      // 부모 창 가운데에 뜨도록 좌표를 직접 계산합니다.
      if (host) {
        const { x: hx, y: hy, width: hw, height: hh } = host.getBounds()
        box.setBounds({
          x: Math.round(hx + (hw - width) / 2),
          y: Math.round(hy + (hh - height) / 2),
          width,
          height,
        })
      } else {
        box.center()
      }
      box.show()
      box.focus()
    })
    box.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    void box.loadFile(path.join(__dirname, 'dialog.html'), {
      query: { title, message, detail, confirmLabel, tone: danger ? 'warn' : 'info' },
    })
  })
}

// 창(렌더러)이 직접 물어볼 때 쓰는 확인 창입니다 — 플러그인 설치 후 재시작 여부 같은 것.
// 답은 true/false 이고, 닫기 · Esc 는 취소(false)로 받습니다.
ipcMain.handle('dialog:confirm', (event, options) => {
  const host = BrowserWindow.fromWebContents(event.sender)
  const opts = options || {}
  return confirmDialog({
    parent: host || undefined,
    title: String(opts.title || '확인'),
    message: String(opts.message || ''),
    detail: String(opts.detail || ''),
    confirmLabel: String(opts.confirmLabel || '확인'),
    danger: Boolean(opts.danger),
  })
})

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'))
  if (icon.isEmpty()) return
  trayStatus = new MenuItem({ label: `상태: ${statusLine()}`, enabled: false })
  const menu = Menu.buildFromTemplate([
    { label: '창 열기', click: showWindow },
    trayStatus,
    { type: 'separator' },
    { label: '서버 폴더 열기', click: () => void shell.openPath(ctx.root) },
    { label: '종료', click: () => void quitFromTray() },
  ])
  tray = new Tray(icon)
  tray.setToolTip(`루빗 서버 구동기 — ${statusLine()}`)
  tray.setContextMenu(menu)
  tray.on('click', showWindow)
}

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#07090a',
    title: '루빗 서버 구동기',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.loadFile(path.join(__dirname, 'renderer.html'))
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 닫기는 종료가 아니라 트레이로 내립니다. 서버 프로세스가 죽지 않습니다.
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    window.hide()
  })
}

// --- 로그인 / 기기 ---------------------------------------------------------

function stopAgent() {
  if (agent) {
    // 핑 타이머를 끄지 않으면, 로그아웃·재로그인으로 agent 가 비어 있는 뒤에도
    // 30초마다 agent.ping() 을 찍다가 오류창이 뜹니다.
    if (agent.pingTimer) clearInterval(agent.pingTimer)
    agent.pingTimer = null
    agent.stop()
    agent = null
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  void pollServers()
  pollTimer = setInterval(() => void pollServers(), 3000)
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// 계정이 가진 서버를 받아옵니다. 웹·안드로이드 콘솔과 같은 목록입니다.
async function pollServers() {
  if (!config.session) return
  try {
    const data = await api('/servers')
    ctx.servers = data.servers || []
    applyState({})
  } catch (error) {
    if (error.status === 401) {
      // 세션이 만료되면 로그인 화면으로 돌려보냅니다.
      ctx.user = null
      config.session = ''
      saveConfig()
      stopAgent()
      stopPolling()
      applyState({ connected: false, message: '로그인이 만료되었습니다. 다시 로그인해 주세요.' })
    }
    // 잠시 실패해도 다음 폴링에서 다시 받습니다.
  }
}

// 로그인 → 내 계정 확인 → 이 PC를 기기로 등록 → 에이전트 시작
async function boot() {
  applyState({ connected: false, message: '계정 확인 중…' })

  try {
    const me = await api('/auth/me')
    ctx.user = { email: me.user.email, displayName: me.user.displayName }
    config.user = ctx.user
    saveConfig()
  } catch (error) {
    ctx.user = null
    config.session = ''
    saveConfig()
    applyState({ connected: false, message: error.message })
    return { ok: false, error: error.message }
  }

  try {
    const device = await api('/devices/ensure', {
      method: 'POST',
      body: {
        name: os.hostname().slice(0, 40) || '내 PC',
        deviceId: config.device?.id,
        token: config.device?.token || config.legacyToken || undefined,
      },
    })
    config.device = { id: device.id, token: device.token, name: device.name }
    config.legacyToken = ''
    ctx.device = config.device
    saveConfig()
  } catch (error) {
    applyState({ connected: false, message: `PC 연결 실패 — ${error.message}` })
    return { ok: false, error: error.message }
  }

  stopAgent()
  phase = new Map()
  agent = new EngineAgent({
    base: config.base,
    token: config.device.token,
    onUpdate: (next) => applyState(next),
  })
  applyState({ connected: false, message: '연결 중…' })
  void agent.start()
  void agent.ping()
  if (!agent.pingTimer) {
    agent.pingTimer = setInterval(() => {
      // 로그아웃·재로그인 사이에 끊긴 타이머가 남아 돌 수 있으므로 한 번 더 확인합니다.
      if (agent && agent.pingTimer) void agent.ping()
    }, 30000)
  }

  startPolling()
  void resumeServers()
  return { ok: true, user: ctx.user }
}

// 마지막에 돌던 서버를 다시 켭니다 — 설정이 켜져 있고 에이전트 목록이 도착한 뒤에 시도합니다.
async function resumeServers() {
  if (!prefs || !prefs.resume || !prefs.lastRunning.length) return
  const ids = prefs.lastRunning.map(Number).filter((id) => Number.isFinite(id))
  prefs.lastRunning = []
  savePrefs()
  if (!ids.length) return

  for (let wait = 0; wait < 30 && agent && !(agent.state.connected && agent.state.servers.length); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (!agent) return
  for (const id of ids) {
    const server = ctx.servers.find((item) => item.id === id)
    if (!server || !server.local) continue
    try {
      await agent.runLocal(id, 'start', {})
      console.log(`[자동 복원] 서버 ${id} 를 다시 시작합니다`)
    } catch (error) {
      // 이미 켜져 있거나 아직 준비 전인 경우는 다음 실행 때 스케줄이 잡습니다.
      console.error(`[자동 복원] 서버 ${id} 시작 실패:`, error && error.message)
    }
  }
}

function logoutLocal(message = '로그아웃되었습니다.') {
  stopAgent()
  stopPolling()
  ctx.user = null
  ctx.servers = []
  ctx.device = null
  config.session = ''
  config.user = null
  saveConfig()
  applyState({ connected: false, message, servers: [], locals: [] })
}

// --- IPC -------------------------------------------------------------------

// 설치판 안의 package.json 버전. 매 수정마다 올라가는 버전을 화면에서 확인합니다.
ipcMain.handle('app:version', () => require('./package.json').version)

ipcMain.handle('config:get', () => ({
  base: config.base,
  user: ctx.user,
  root: ctx.root,
  saved: config.user,
}))

ipcMain.handle('state:get', () => state)

ipcMain.handle('auth:submit', async (_event, payload) => {
  const mode = payload?.mode === 'register' ? 'register' : 'login'
  const email = String(payload?.email ?? '').trim()
  const password = String(payload?.password ?? '')
  const name = String(payload?.name ?? '').trim()

  try {
    const data = await api(mode === 'register' ? '/auth/register' : '/auth/login', {
      method: 'POST',
      body: { email, password, name },
      token: '',
    })
    config.session = data.token
    config.user = data.user
    saveConfig()
    return await boot()
  } catch (error) {
    return { ok: false, error: error.message }
  }
})

ipcMain.handle('auth:logout', () => {
  logoutLocal()
  return { ok: true }
})

// 로그인 화면 — 어떤 소셜 로그인이 켜져 있는지 알려줍니다. 안 켜진 쪽은 버튼을 숨깁니다.
ipcMain.handle('auth:status', async () => {
  try {
    const [discord, google] = await Promise.all([
      api('/auth/discord/status'),
      api('/auth/google/status'),
    ])
    return { discord: Boolean(discord.configured), google: Boolean(google.configured) }
  } catch {
    return { discord: false, google: false }
  }
})

// --- 디스코드 로그인 (앱) --------------------------------------------------
// 브라우저에서 로그인하면 결과가 이 PC의 로컬 주소로 돌아옵니다.
// 주소는 서버에 미리 등록해 둔 것만 쓸 수 있습니다.
const DISCORD_CALLBACK_PORT = 51555
const LOCAL_CALLBACK = `http://127.0.0.1:${DISCORD_CALLBACK_PORT}/callback`

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#07090a;color:#eef7f4;font-family:system-ui;display:grid;place-items:center;height:100vh"><div style="text-align:center"><p style="font-size:18px;font-weight:600">로그인 완료</p><p style="font-size:14px;color:#a0b3ae;margin-top:8px">이 창은 자동으로 닫힙니다. 구동기로 돌아가세요.</p></div><script>setTimeout(()=>window.close(),2500)</script>`

// 로컬 콜백 서버 — 한 번의 로그인만 받고 바로 닫습니다.
function waitForOAuthCode(state) {
  let settled = false
  let timer = null
  let server = null

  const done = (error, code) => {
    if (settled) return
    settled = true
    if (timer) clearTimeout(timer)
    if (server && server.listening) server.close()
    if (error) reject(error)
    else resolve(code)
  }

  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', LOCAL_CALLBACK)
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE)

    const error = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    if (error) done(new Error('디스코드 로그인을 취소하셨습니다.'))
    else if (!code) done(new Error('인증 코드를 받지 못했습니다.'))
    else if (url.searchParams.get('state') !== state) done(new Error('확인에 실패했습니다. 다시 시도해 주세요.'))
    else done(null, code)
  })

  server.once('error', (error) => {
    done(
      error && error.code === 'EADDRINUSE'
        ? new Error('로그인 대기 중인 창이 이미 있습니다. 잠시 후 다시 시도해 주세요.')
        : error,
    )
  })
  timer = setTimeout(
    () => done(new Error('로그인 대기 시간이 지났습니다. 다시 시도해 주세요.')),
    3 * 60 * 1000,
  )
  server.listen(DISCORD_CALLBACK_PORT, '127.0.0.1')

  return { promise, cancel: () => done(new Error('로그인을 취소했습니다.')) }
}

// 소셜 로그인(디스코드·구글)은 같은 흐름입니다. 브라우저가 이 PC의 로컬 주소로
// 인증 결과를 돌려주고, 앱이 그 code 를 서버와 바꿉니다.
async function socialLogin(kind) {
  const state = crypto.randomBytes(16).toString('hex')
  const pending = waitForOAuthCode(state)
  const url = `${config.base}/api/engine/auth/${kind}/start?redirect_uri=${encodeURIComponent(LOCAL_CALLBACK)}&state=${state}`

  try {
    await shell.openExternal(url)
  } catch (error) {
    pending.cancel()
    throw new Error(`브라우저를 열지 못했습니다: ${error.message}`)
  }

  let code
  try {
    code = await pending.promise
  } catch (error) {
    throw error
  }

  const response = await fetch(`${config.base}/api/engine/auth/${kind}/desktop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri: LOCAL_CALLBACK }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `로그인하지 못했습니다. (${response.status})`)
  return data
}

// 로그인 완료 후 세션을 저장하고 다시 부팅하는 건 두 소셜이 똑같습니다.
async function finishSocialLogin(kind) {
  try {
    const data = await socialLogin(kind)
    config.session = data.token
    config.user = data.user
    saveConfig()
    return await boot()
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

ipcMain.handle('auth:discord', () => finishSocialLogin('discord'))
ipcMain.handle('auth:google', () => finishSocialLogin('google'))

// 앱 안의 시작·중지·재시작·명령과 파일·플러그인·지도 조회. 웹 콘솔과 같은 경로를 씁니다.
// 결과가 필요한 명령은 실행한 값을 문자열로 돌려줘서 화면이 그대로 그립니다.
ipcMain.handle('control:run', async (_event, payload) => {
  const id = Number(payload?.serverId)
  const type = String(payload?.type || '')
  const args = payload?.args ?? {}
  const server = (state.servers || []).find((item) => item.id === id)
  if (!server) throw new Error('서버를 찾을 수 없습니다.')

  let result = ''
  if (server.local && !agent) throw new Error('에이전트가 연결되어 있지 않습니다. 잠시 후 다시 시도해 주세요.')
  if (server.local) {
    result = (await agent.runLocal(id, type, args)) || ''
    applyState({})
  } else {
    result = (await runViaApi(id, type, args)) || ''
    await pollServers()
  }
  return { ok: true, result }
})

// --- 탭용 조회: Modrinth · 월드 지도 · 접속/도메인 -------------------------
ipcMain.handle('modrinth:search', (_event, query) =>
  api(`/modrinth/search?q=${encodeURIComponent(String(query ?? ''))}`),
)

ipcMain.handle('modrinth:versions', (_event, slug) =>
  api(`/modrinth/versions?slug=${encodeURIComponent(String(slug ?? ''))}`),
)

ipcMain.handle('worldmap:get', (_event, serverId) => api(`/servers/${Number(serverId)}/worldmap`))

ipcMain.handle('access:get', (_event, serverId) => api(`/servers/${Number(serverId)}/access`))

ipcMain.handle('domain:make', (_event, payload) =>
  api(`/servers/${Number(payload?.id)}/domain`, {
    method: 'POST',
    body: { name: String(payload?.name ?? '').trim() },
  }),
)

ipcMain.handle('domain:delete', (_event, payload) =>
  api(`/servers/${Number(payload?.id)}/domain`, { method: 'DELETE' }),
)

// 관리자 — 주인이 이메일로 등록하면 그 사람도 서버를 함께 관리합니다.
ipcMain.handle('admins:list', (_event, serverId) => api(`/servers/${Number(serverId)}/admins`))
ipcMain.handle('admins:add', (_event, payload) =>
  api(`/servers/${Number(payload?.id)}/admins`, {
    method: 'POST',
    body: { email: String(payload?.email ?? '') },
  }),
)
ipcMain.handle('admins:remove', (_event, payload) =>
  api(`/servers/${Number(payload?.id)}/admins?email=${encodeURIComponent(String(payload?.email ?? ''))}`, {
    method: 'DELETE',
  }),
)

// --- 백업 · 복원 -----------------------------------------------------------
// 이 PC(루트 안) 서버만 백업할 수 있다고 가정하지 않습니다 — 가져온 서버(루트 밖)도
// 백업·업그레이드가 되어야 "그대로 적용"됩니다. 폴더가 실제로 있는지만 봅니다.
function localServerForBackup(id) {
  const server = (state.servers || []).find((item) => item.id === id)
  if (!server) throw new Error('서버를 찾을 수 없습니다.')
  if (!server.local) throw new Error('이 서버의 폴더는 다른 PC에 있습니다 — 거기서 백업하세요.')
  const dir = String(server.server_dir || '')
  if (!dir || !fs.existsSync(dir)) throw new Error('서버 폴더를 찾을 수 없습니다.')
  return { server, dir }
}

function backupReporter(serverId) {
  return (line) => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('backup:progress', { serverId, line: line || '' })
    }
  }
}

ipcMain.handle('backup:list', (_event, serverId) => {
  const { dir } = localServerForBackup(Number(serverId))
  return backupStore.list(dir, ctx.root)
})

ipcMain.handle('backup:create', async (_event, serverId) => {
  const id = Number(serverId)
  const { dir } = localServerForBackup(id)
  const send = backupReporter(id)
  const local = (state.locals || []).find((item) => item.id === id)
  const running = Boolean(local && (local.state === 'running' || local.state === 'starting'))
  try {
    if (running && agent) {
      // 실행 중에는 월드를 먼저 디스크에 기록하게 한 뒤에 담습니다.
      try {
        await agent.runLocal(id, 'command', { line: 'save-all flush' })
      } catch {
        /* 명령을 못 받는 상태면 그냥 진행합니다 */
      }
      send('월드 저장을 기다리는 중…')
      await new Promise((resolve) => setTimeout(resolve, 2500))
    }
    const result = await backupStore.create(dir, ctx.root, send)
    send('')
    void notifyWebhook(id, 'backup', `${result.file} · ${(result.size / 1024 / 1024).toFixed(1)}MB`)
    return { ok: true, ...result }
  } catch (error) {
    send('')
    throw error
  }
})

ipcMain.handle('backup:restore', async (_event, payload) => {
  const id = Number(payload?.serverId)
  const file = String(payload?.file || '')
  const { dir } = localServerForBackup(id)
  const server = (state.servers || []).find((item) => item.id === id)
  const local = (state.locals || []).find((item) => item.id === id)
  const running = Boolean(local && ['running', 'starting', 'stopping'].includes(local.state))

  const parent = window && !window.isDestroyed() ? window : undefined
  const ok = await confirmDialog({
    parent,
    title: '백업 복원',
    message: `${file} 백업으로 되돌릴까요?`,
    detail: running
      ? '지금 실행 중이라 먼저 중지한 뒤, 현재 서버 폴더를 백업 내용으로 바꿉니다. 되돌릴 수 없습니다.'
      : '현재 서버 폴더를 백업 내용으로 바꿉니다. 되돌릴 수 없습니다.',
    confirmLabel: '복원',
    danger: true,
  })
  if (!ok) return { ok: false, cancelled: true }

  if (running && agent) {
    try {
      await agent.runLocal(id, 'stop', {})
    } catch {
      /* 이미 내려갔을 수 있습니다 */
    }
    await waitForStop(id, 30_000)
  }

  const send = backupReporter(id)
  try {
    const result = await backupStore.restore(dir, ctx.root, file, send)
    send('')
    // 복원한 폴더에 실행 명령이 적힌 파일이 있으면 콘솔 등록도 되돌립니다.
    // (업그레이드 후 복원하면 새 명령이 그대로 남아 서버가 뜨지 않기 때문입니다.)
    try {
      const sidecar = JSON.parse(fs.readFileSync(path.join(dir, 'lubit.json'), 'utf8'))
      if (sidecar.javaCmd) {
        await api(`/servers/${id}/upgrade`, {
          method: 'POST',
          body: { javaCmd: sidecar.javaCmd, version: sidecar.version || '' },
        })
        await pollServers()
      }
    } catch {
      /* 실행 명령 파일이 없으면 등록된 명령을 그대로 씁니다 */
    }
    return { ok: true, ...result }
  } catch (error) {
    send('')
    throw error
  }
})

ipcMain.handle('backup:delete', async (_event, payload) => {
  const id = Number(payload?.serverId)
  const { dir } = localServerForBackup(id)
  await backupStore.remove(dir, ctx.root, String(payload?.file || ''))
  return { ok: true }
})

ipcMain.handle('backup:open', () => shell.openPath(backupStore.backupRoot(ctx.root)))

// --- 설정: 자동 실행 · 서버 복원 · 웹훅 · 스케줄 ---------------------------

ipcMain.handle('prefs:get', () => {
  if (!prefs) loadPrefs()
  return { autostart: prefs.autostart, resume: prefs.resume }
})

ipcMain.handle('prefs:set', (_event, patch) => {
  if (!prefs) loadPrefs()
  if (patch && typeof patch.autostart === 'boolean') prefs.autostart = patch.autostart
  if (patch && typeof patch.resume === 'boolean') prefs.resume = patch.resume
  savePrefs()
  applyAutostart()
  return { autostart: prefs.autostart, resume: prefs.resume }
})

ipcMain.handle('serverprefs:get', (_event, serverId) => serverPrefs(Number(serverId)))

ipcMain.handle('serverprefs:set', (_event, payload) => {
  if (!prefs) loadPrefs()
  const id = Number(payload?.id)
  const patch = payload?.patch || {}
  const current = prefsStore.forServer(prefs, id)
  const next = {
    ...current,
    ...(typeof patch.webhook === 'string' ? { webhook: patch.webhook.trim() } : {}),
    webhookEvents: { ...current.webhookEvents, ...(patch.webhookEvents || {}) },
    schedule: { ...current.schedule, ...(patch.schedule || {}) },
  }
  prefs.servers[String(id)] = next
  savePrefs()
  return next
})

// 저장한 주소로 테스트 메시지 한 통 — 실패면 화면에 이유를 보여 줍니다.
ipcMain.handle('webhook:test', async (_event, serverId) => {
  const cfg = serverPrefs(Number(serverId))
  if (!cfg.webhook) throw new Error('웹훅 주소를 먼저 저장해 주세요.')
  if (!/^https:\/\/[\w.-]+\//.test(cfg.webhook)) {
    throw new Error('웹훅 주소는 https 로 시작해야 합니다.')
  }
  const server = (state.servers || []).find((item) => item.id === Number(serverId))
  await postWebhook(
    cfg.webhook,
    webhookPayload(server ? server.name : '서버', '테스트 메시지입니다', '이 주소로 알림이 잘 옵니다.', 0x22d3ee),
  )
  return { ok: true }
})

// --- 버전 업그레이드 -------------------------------------------------------
// 새 jar 를 받기 전에 반드시 백업을 먼저 만듭니다 — 실패하면 업그레이드를 멈춥니다.
ipcMain.handle('server:upgrade', async (_event, payload) => {
  const id = Number(payload?.id)
  const version = String(payload?.version || '')
  if (!version) throw new Error('바꿀 버전을 골라 주세요.')
  const { server, dir } = localServerForBackup(id)
  const local = (state.locals || []).find((item) => item.id === id)
  if (local && ['running', 'starting', 'stopping'].includes(local.state)) {
    throw new Error('먼저 서버를 중지해 주세요.')
  }

  const parent = window && !window.isDestroyed() ? window : undefined
  const ok = await confirmDialog({
    parent,
    title: '서버 버전 올리기',
    message: `${server.name}: ${server.mc_version || '현재 버전'} → ${version}`,
    detail: '바꾸기 전에 자동으로 백업을 만듭니다. 월드 · 설정 · 플러그인은 그대로 두고 서버 파일(jar)만 교체합니다.',
    confirmLabel: '올리기',
  })
  if (!ok) return { ok: false, cancelled: true }

  const send = backupReporter(id)
  try {
    send('업그레이드 전 백업 만드는 중…')
    const backup = await backupStore.create(dir, ctx.root, send)
    send(`백업 완료 — ${backup.file}`)

    const result = await provision.upgradeServer({
      dir,
      type: server.server_type,
      version,
      javaCmd: server.java_cmd,
      onProgress: (line) => send(String(line || '')),
    })
    send('콘솔에 새 실행 명령을 기록하는 중…')
    await api(`/servers/${id}/upgrade`, {
      method: 'POST',
      body: { javaCmd: result.javaCmd, version: result.version },
    })
    await pollServers()
    send('')
    return { ok: true, version: result.version }
  } catch (error) {
    send('')
    throw error
  }
})

// --- 기존 서버 가져오기 (드래그앤드롭 · 폴더 선택) ---------------------------
// 폴더를 옮기지 않습니다 — 원래 자리에서 실행되도록 등록만 합니다.

ipcMain.handle('dialog:pickFolder', async () => {
  const parent = window && !window.isDestroyed() ? window : undefined
  const result = await dialog.showOpenDialog(parent, {
    title: '가져올 서버 폴더 선택',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return { ok: false, cancelled: true }
  return { ok: true, dir: result.filePaths[0] }
})

ipcMain.handle('server:import', async (_event, payload) => {
  if (!ctx.device) throw new Error('먼저 계정으로 로그인해 주세요.')

  const dir = path.resolve(String(payload?.dir || '').trim())
  if (!dir) throw new Error('폴더를 선택해 주세요.')
  const root = path.resolve(ctx.root)
  if (dir === root) throw new Error('루트 폴더 자체는 서버로 등록할 수 없습니다.')

  const normalized = dir.replace(/[\\/]+$/, '')
  const already = (state.servers || []).find(
    (item) => String(item.server_dir || '').replace(/[\\/]+$/, '') === normalized,
  )
  if (already) throw new Error(`이미 “${already.name}”(으)로 등록되어 있습니다.`)

  // 서버 폴더인지 판별합니다 — 아니면 이유와 함께 여기서 멈춥니다.
  const plan = importer.detect(dir)

  const parent = window && !window.isDestroyed() ? window : undefined
  const detail = [
    `실행: ${plan.javaCmd}`,
    `종류: ${plan.type || '자동 판별 안됨'}${plan.version ? ` · 마인크래프트 ${plan.version}` : ''} · 포트 ${plan.port}`,
    '폴더는 옮기지 않습니다 — 원래 자리에서 실행되고, 콘솔·파일·모드·지도·백업이 그대로 됩니다.',
    ...plan.warnings,
  ].join('\n')
  const ok = await confirmDialog({
    parent,
    title: '서버 가져오기',
    message: `${plan.name} 폴더를 서버로 등록할까요?`,
    detail,
    confirmLabel: '등록',
    width: 540,
    height: 330,
  })
  if (!ok) return { ok: false, cancelled: true }

  const created = await api('/servers', {
    method: 'POST',
    body: {
      name: plan.name,
      javaCmd: plan.javaCmd,
      serverDir: plan.dir,
      version: plan.version,
      type: plan.type,
      memoryMb: plan.memoryMb,
      port: plan.port,
    },
  })
  await api(`/servers/${created.id}/assign`, {
    method: 'POST',
    body: { deviceId: ctx.device.id },
  })
  await pollServers()
  return { ok: true, id: created.id, dir: plan.dir, warnings: plan.warnings }
})

// --- 클라우드 백업 (루빗 계정 저장소) ---------------------------------------
// 로컬 zip 을 만들어 계정 저장소에 올리고, 내려받기는 그 파일을 다시 백업 폴더로
// 받아 복원 절차(중지 · 확인 · 교체)를 그대로 탑니다.

function cloudRoom(serverDir) {
  return path.join(backupStore.backupRoot(ctx.root), path.basename(path.resolve(serverDir)))
}

ipcMain.handle('cloudbackups:list', async (_event, serverId) => {
  const id = Number(serverId)
  localServerForBackup(id)
  return api(`/servers/${id}/backups`)
})

ipcMain.handle('cloudbackups:upload', async (_event, serverId) => {
  const id = Number(serverId)
  const { dir } = localServerForBackup(id)
  const send = backupReporter(id)
  try {
    // 1) 로컬 zip 부터 만듭니다 — 남겨 두는 편이 좋고, 업로드 원본으로도 씁니다.
    const local = await backupStore.create(dir, ctx.root, send)
    const filePath = path.join(cloudRoom(dir), local.file)
    if (local.size > 2 * 1024 * 1024 * 1024) {
      throw new Error('백업이 2GB 를 넘어 클라우드에 올릴 수 없습니다.')
    }

    // 2) 올릴 주소를 받습니다.
    const presigned = await api(`/servers/${id}/backups/presign`, {
      method: 'POST',
      body: { name: local.file },
    })
    const uploadUrl = new URL(String(presigned.uploadUrl || ''), config.base).toString()

    // 3) 올립니다. ( presign 주소에는 Content-Type 을 붙이지 않습니다 — 서명에 들어갈 수 있기 때문입니다.)
    send(`클라우드에 올리는 중… (${(local.size / 1024 / 1024).toFixed(1)}MB)`)
    const body = await fs.promises.readFile(filePath)
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      body,
      signal: AbortSignal.timeout(10 * 60 * 1000),
    })
    if (!response.ok && response.status !== 200) {
      throw new Error(`업로드에 실패했습니다. (${response.status})`)
    }

    // 4) 목록에 남깁니다.
    send('확인 중…')
    await api(`/servers/${id}/backups`, {
      method: 'POST',
      body: { name: local.file, size: local.size },
    })
    send('')
    return { ok: true, name: local.file, size: local.size }
  } catch (error) {
    send('')
    throw error
  }
})

ipcMain.handle('cloudbackups:download', async (_event, payload) => {
  const id = Number(payload?.serverId)
  const bid = Number(payload?.id)
  const name = path.basename(String(payload?.name || ''))
  const { dir } = localServerForBackup(id)
  if (!name.endsWith('.zip')) throw new Error('내려받을 파일 이름이 올바르지 않습니다.')

  const send = backupReporter(id)
  const room = cloudRoom(dir)
  await fs.promises.mkdir(room, { recursive: true })
  const target = path.join(room, name)
  try {
    const { url } = await api(`/servers/${id}/backups/${bid}/url`)
    const absolute = new URL(String(url || ''), config.base).toString()
    send('클라우드에서 내려받는 중…')
    const response = await fetch(absolute, { signal: AbortSignal.timeout(15 * 60 * 1000) })
    if (!response.ok || !response.body) {
      throw new Error(`내려받기에 실패했습니다. (${response.status})`)
    }
    const file = fs.createWriteStream(target)
    let received = 0
    let shown = 0
    for await (const chunk of Readable.fromWeb(response.body)) {
      received += chunk.length
      if (!file.write(chunk)) await once(file, 'drain')
      if (received - shown > 5 * 1024 * 1024) {
        shown = received
        send(`클라우드에서 내려받는 중… ${(received / 1024 / 1024).toFixed(1)}MB`)
      }
    }
    await new Promise((resolve, reject) => file.end((error) => (error ? reject(error) : resolve())))
    send('')
    return { ok: true, file: name, size: received }
  } catch (error) {
    await fs.promises.rm(target, { force: true }).catch(() => undefined)
    send('')
    throw error
  }
})

ipcMain.handle('cloudbackups:delete', async (_event, payload) => {
  const id = Number(payload?.serverId)
  const bid = Number(payload?.id)
  localServerForBackup(id)
  await api(`/servers/${id}/backups/${bid}`, { method: 'DELETE' })
  return { ok: true }
})

// 웹에서는 서버를 만들 수 없습니다. 이 PC에서만 만듭니다.
ipcMain.handle('server:create', async (_event, payload) => {
  if (!ctx.device) throw new Error('먼저 계정으로 로그인해 주세요.')
  if (ctx.provisioning) throw new Error('이미 서버를 만드는 중입니다.')

  const report = (step, line) => {
    if (!line) return
    ctx.provisioning = { step, line }
    if (window && !window.isDestroyed()) window.webContents.send('agent:progress', { step, line })
    applyState({})
  }

  try {
    const result = await provision.createServer({ root: ctx.root, ...payload, onProgress: report })
    report('save', '콘솔에 서버 등록 중')
    const created = await api('/servers', {
      method: 'POST',
      body: {
        name: payload.name,
        javaCmd: result.javaCmd,
        serverDir: result.dir,
        version: result.version,
        type: result.type,
        memoryMb: result.memoryMb,
        port: result.port,
      },
    })
    await api(`/servers/${created.id}/assign`, {
      method: 'POST',
      body: { deviceId: ctx.device.id },
    })
    report('done', `${result.dir} 준비 완료`)
    ctx.provisioning = null
    await pollServers()
    applyState({})
    return { ok: true, id: created.id, dir: result.dir }
  } catch (error) {
    ctx.provisioning = null
    applyState({})
    return { ok: false, error: error.message }
  }
})

// 다른 기기에 등록된 서버를 이 PC로 가져옵니다.
ipcMain.handle('server:assign', async (_event, payload) => {
  if (!ctx.device) throw new Error('먼저 계정으로 로그인해 주세요.')
  await api(`/servers/${Number(payload?.id)}/assign`, {
    method: 'POST',
    body: { deviceId: ctx.device.id },
  })
  await pollServers()
  return { ok: true }
})

// 서버를 콘솔에서 삭제합니다. 확인 대화상자를 먼저 띄우고, 실행 중이면 멈춘 뒤 지웁니다.
// 이 PC(루트 폴더) 안에 있는 서버라면 폴더와 파일도 함께 영구히 삭제합니다 —
// 되돌릴 수 없으므로 확인 창에 분명히 적어 두고, 루트 밖 경로는 건드리지 않습니다.
// 다른 PC 의 서버는 콘솔 목록에서만 없어집니다(폴더는 그쪽 기기에 남습니다).
ipcMain.handle('server:delete', async (_event, payload) => {
  const id = Number(payload?.id)
  const server = (state.servers || []).find((item) => item.id === id)
  if (!server) throw new Error('서버를 찾을 수 없습니다.')
  // 관리자로 보이는 서버는 지울 수 없습니다 — 주인만 삭제할 수 있습니다.
  if (server.is_owner === 0) throw new Error('주인만 서버를 삭제할 수 있습니다.')

  const running = (state.locals || []).some(
    (item) => item.id === id && (item.state === 'running' || item.state === 'starting' || item.state === 'stopping'),
  )

  const dir = folderToDelete(server)
  const parent = window && !window.isDestroyed() ? window : undefined
  const ok = await confirmDialog({
    parent,
    title: '서버 삭제',
    message: `${server.name} 서버를 콘솔에서 삭제할까요?`,
    detail: dir
      ? running
        ? '지금 실행 중이라 먼저 멈춘 뒤, 서버 폴더와 파일도 함께 영구히 삭제합니다. 되돌릴 수 없습니다.'
        : '서버 폴더와 파일도 함께 영구히 삭제합니다. 되돌릴 수 없습니다.'
      : running
        ? '지금 실행 중이라 먼저 중지합니다. 콘솔 목록에서만 없어집니다.'
        : '콘솔 목록에서만 없어집니다. 서버 폴더는 그대로 남습니다.',
    confirmLabel: '삭제',
    danger: true,
  })
  if (!ok) return { ok: false, cancelled: true }

  if (running && agent) {
    try {
      await agent.runLocal(id, 'stop', {})
    } catch {
      /* 이미 내려갔거나 다른 기기의 서버일 수 있습니다 */
    }
  }

  // 콘솔 등록을 먼저 지우고, 성공한 뒤에 폴더를 지웁니다 —
  // 등록이 실패하면 목록과 폴더가 어긋나지 않도록 폴더는 그대로 둡니다.
  await api(`/servers/${id}`, { method: 'DELETE' })

  let folderDeleted = false
  if (dir) {
    try {
      await waitForStop(id)
      fs.rmSync(dir, { recursive: true, force: true })
      folderDeleted = true
      console.log(`[삭제] 서버 폴더 제거: ${dir}`)
    } catch (error) {
      console.error(`[삭제] 폴더를 지우지 못했습니다: ${dir}`, error)
    }
    // 남아 있는 백업도 함께 지웁니다 — 폴더를 영구히 지우기로 한 김에 한꺼번에.
    await backupStore.deleteAll(dir, ctx.root).catch(() => undefined)
  }

  await pollServers()
  return { ok: true, folderDeleted }
})

// 삭제할 폴더 — 이 PC(루트 폴더) 안에 있는 서버만 해당하고, 밖의 경로는 null 로 둡니다.
function folderToDelete(server) {
  if (!server || !server.local) return null
  const dir = String(server.server_dir || '')
  if (!dir || !ctx.root) return null
  const target = path.resolve(dir)
  const base = path.resolve(ctx.root)
  const rel = path.relative(base, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

// 파일을 지우기 전에 프로세스가 완전히 내려갈 때까지 기다립니다.
// 열려 있는 파일은 윈도우에서 바로 지우지 못하기 때문입니다.
async function waitForStop(id, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const local = ((agent && agent.locals()) || []).find((item) => item.id === id)
    if (!local || !['running', 'starting', 'stopping'].includes(local.state)) return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

ipcMain.handle('versions:get', (_event, type) => provision.listVersions(String(type)))
ipcMain.handle('types:get', () => provision.SERVER_TYPES)
ipcMain.handle('folder:open', () => shell.openPath(ctx.root))

// --- 자동 업데이트 ---------------------------------------------------------
// 설치판에서만 동작합니다. 새 버전을 백그라운드로 받고, 받은 뒤 재시작을 묻습니다.
// 서버가 돌고 있으면 묻지 않고, 다음 종료 때 설치됩니다.
function setupAutoUpdate() {
  if (!app.isPackaged) return
  // 패키징된 앱에서만 불러옵니다. 최상위에서 불러오면 스모크 테스트가 깨집니다.
  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // 업데이트 서버에 닿지 못해도 앱은 그대로 동작해야 하므로 오류는 조용히 넘깁니다.
  autoUpdater.on('error', () => {})
  autoUpdater.on('update-downloaded', async (info) => {
    if (runningCount() > 0) return
    const parent = window && !window.isDestroyed() ? window : undefined
    const ok = await confirmDialog({
      parent,
      title: '업데이트 준비 완료',
      message: `새 버전 ${info.version} 이 준비되었습니다.`,
      detail: '지금 재시작하면 바로 설치됩니다.',
      confirmLabel: '지금 재시작',
    })
    if (ok) {
      quitting = true
      autoUpdater.quitAndInstall()
    }
  })
  const check = () => void autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 5000)
  setInterval(check, 60 * 60 * 1000)
}

app.whenReady().then(() => {
  config = readConfig()
  loadPrefs()
  // 설치 직후 첫 실행에서 바로 C:\LubitServers 를 만듭니다.
  try {
    ctx.root = config.root || provision.defaultRoot()
    provision.ensureRoot(ctx.root)
  } catch {
    /* 폴더를 못 만드는 환경 — 서버를 만들 때 다시 시도합니다 */
  }

  applyAutostart()
  startScheduleTimer()
  createTray()
  createWindow()
  setupAutoUpdate()

  if (config.session) {
    void boot()
  } else {
    applyState({ connected: false, message: '로그인해 주세요' })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // 창을 닫아도 트레이에서 살아 있으므로 여기서 종료하지 않습니다.
  if (process.platform === 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  // 재시작용 기록 — 지금 돌고 있던 서버를 다음 실행 때 다시 켭니다.
  if (prefs) {
    prefs.lastRunning = (state.locals || [])
      .filter((item) => item.state === 'running' || item.state === 'starting')
      .map((item) => item.id)
    savePrefs()
  }
  if (scheduleTimer) {
    clearInterval(scheduleTimer)
    scheduleTimer = null
  }
  stopPolling()
  if (agent) agent.stop()
  if (tray) {
    tray.destroy()
    tray = null
  }
})
