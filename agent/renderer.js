let state = {
  connected: false,
  message: '로그인해 주세요',
  servers: [],
  locals: [],
  user: null,
  root: '',
  provisioning: null,
}
let selected = null
let activeTab = 'console' // 콘솔 | 파일 | 플러그인 | 플레이어 | map | access
let loginMode = 'login'
let authBusy = false
let busy = false
let stick = true
let lastLogText = null

// 서버 만들기 마법사
let types = []
let activeType = null
let wizardOpen = false
let creating = false
let progressLines = []

const $ = (id) => document.getElementById(id)

const STATE = {
  running: { text: '실행 중', cls: 'on' },
  starting: { text: '시작 중', cls: 'busy' },
  stopping: { text: '중지 중', cls: 'busy' },
  crashed: { text: '오류', cls: 'bad' },
  offline: { text: '중지됨', cls: '' },
}

// 에이전트가 들고 오는 원시 오류를 사람이 읽는 문장으로 바꿉니다.
function friendly(message) {
  const text = String(message || '').replace(/^Error invoking remote method '[^']+': Error: /, '')
  if (/401|로그인이 필요/.test(text)) return '로그인이 필요합니다.'
  if (/403/.test(text)) return '접근 권한이 없습니다.'
  if (/404/.test(text)) return '서버를 찾을 수 없습니다.'
  if (/API 응답이 아닙니다/.test(text)) return '서버 주소가 올바르지 않습니다.'
  if (/Failed to fetch|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed/i.test(text)) {
    return '루빗 서버에 연결되지 않습니다. 인터넷 연결을 확인해 주세요.'
  }
  if (/이미 실행 중/.test(text)) return '이미 실행 중인 서버입니다.'
  if (/실행되고 있지 않습니다|이미 종료된 서버/.test(text)) return '실행 중인 서버가 아닙니다.'
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

function localFor(id) {
  return (state.locals || []).find((entry) => entry.id === id)
}

function serverFor(id) {
  return (state.servers || []).find((item) => item.id === id)
}

// 팩토리·포지 계열은 플러그인 대신 모드를 씁니다 — 탭 이름과 폴더가 달라집니다.
const MOD_SERVER_TYPES = ['fabric', 'forge', 'neoforge', 'quilt']
function isModServer(server) {
  return MOD_SERVER_TYPES.includes(String(server?.server_type || '').toLowerCase())
}

function phaseOf(id) {
  const local = localFor(id)
  if (local) return local.state
  const server = serverFor(id)
  return server ? server.state : 'offline'
}

// --- 로그인 ----------------------------------------------------------------

function setLoginMode(mode) {
  loginMode = mode
  $('tabLogin').classList.toggle('active', mode === 'login')
  $('tabRegister').classList.toggle('active', mode === 'register')
  $('nameField').hidden = mode !== 'register'
  $('authSubmit').textContent = mode === 'login' ? '로그인' : '계정 만들기'
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password'
  $('authError').hidden = true
}

async function submitAuth(event) {
  event.preventDefault()
  if (authBusy) return
  authBusy = true
  $('authSubmit').disabled = true
  $('authError').hidden = true

  try {
    const payload = {
      email: $('authEmail').value.trim(),
      password: $('authPassword').value,
      name: $('authName').value.trim(),
    }
    const result =
      loginMode === 'login' ? await window.engine.login(payload) : await window.engine.register(payload)
    if (!result.ok) throw new Error(result.error || '로그인하지 못했습니다.')
    $('authPassword').value = ''
  } catch (error) {
    $('authError').hidden = false
    $('authError').textContent = friendly(error?.message)
  } finally {
    authBusy = false
    $('authSubmit').disabled = false
  }
}

// --- 서버 만들기 -----------------------------------------------------------

// server.properties 기본값 — 마법사 4번 칸에 미리 채워 둡니다.
const DEFAULT_PROPERTIES = [
  'motd=Lubit Server',
  'level-name=world',
  'difficulty=normal',
  'gamemode=survival',
  'max-players=20',
  'online-mode=true',
  'pvp=true',
].join('\n')

// 편집기 내용을 키=값 목록으로 바꿉니다. 문제가 있는 줄은 번호와 함께 오류로 돌립니다.
function parseProperties() {
  const out = {}
  const lines = ($('propText').value || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`${i + 1}번째 줄에 '=' 가 없습니다 — ${line}`)
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
      throw new Error(`${i + 1}번째 줄의 항목 이름이 올바르지 않습니다 — ${key}`)
    }
    out[key] = line.slice(eq + 1).trim()
  }
  // 포트는 3번 항목의 값을 따릅니다. 적어 뒀어도 그쪽이 우선합니다.
  delete out['server-port']
  return out
}

async function loadTypes() {
  if (types.length) return
  try {
    types = await window.engine.types()
  } catch {
    types = []
  }
  if (!activeType && types.length) activeType = types[0].key
}

function renderTypes() {
  const box = $('typeChips')
  box.textContent = ''
  for (const type of types) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip' + (type.key === activeType ? ' active' : '')
    chip.textContent = type.name
    chip.addEventListener('click', () => {
      activeType = type.key
      renderTypes()
      void loadVersions()
    })
    box.appendChild(chip)
  }
  const current = types.find((type) => type.key === activeType)
  $('typeNote').textContent = current ? current.note : ''
}

async function loadVersions() {
  const select = $('version')
  select.textContent = ''
  const loading = document.createElement('option')
  loading.value = ''
  loading.textContent = '버전 목록 불러오는 중…'
  select.appendChild(loading)
  try {
    const versions = await window.engine.versions(activeType)
    select.textContent = ''
    versions.slice(0, 400).forEach((version) => {
      const option = document.createElement('option')
      option.value = version
      option.textContent = version
      select.appendChild(option)
    })
    if (versions.length > 400) {
      const note = document.createElement('option')
      note.disabled = true
      note.textContent = `— 최신 400개만 표시 (${versions.length}개) —`
      select.appendChild(note)
    }
  } catch (error) {
    select.textContent = ''
    const option = document.createElement('option')
    option.value = ''
    option.textContent = `불러오기 실패 — ${friendly(error?.message)}`
    select.appendChild(option)
  }
}

async function openWizard() {
  wizardOpen = true
  progressLines = []
  $('progress').hidden = true
  $('progress').textContent = ''
  $('runPanel').hidden = true
  $('wizardError').hidden = true
  $('rootPath').textContent = state.root || 'C:\\LubitServers'
  $('wizard').hidden = false
  await loadTypes()
  renderTypes()
  await loadVersions()
  // 한 번 지우지 않는 한 새 서버를 만들 때마다 같은 설정값을 유지합니다.
  if (!$('propText').value.trim()) $('propText').value = DEFAULT_PROPERTIES
  $('serverName').focus()
}

function closeWizard() {
  if (creating) return
  wizardOpen = false
  $('wizard').hidden = true
}

function pushProgress(line) {
  if (!line) return
  progressLines.push(line)
  if (progressLines.length > 400) progressLines.splice(0, progressLines.length - 400)
  const box = $('progress')
  box.hidden = false
  box.textContent = progressLines.join('\n')
  box.scrollTop = box.scrollHeight
  // 진행 표시줄에는 가장 최근 줄을 그대로 보여 줍니다.
  const label = progressLines[progressLines.length - 1]
  $('runLabel').textContent = label.length > 96 ? `${label.slice(0, 96)}…` : label
}

async function createServer() {
  if (creating) return
  const error = $('wizardError')
  error.hidden = true

  const name = $('serverName').value.trim()
  const version = $('version').value
  if (!name) {
    error.hidden = false
    error.textContent = '서버 이름을 입력해 주세요.'
    return
  }
  if (!activeType) {
    error.hidden = false
    error.textContent = '서버 종류를 골라 주세요.'
    return
  }
  if (!version) {
    error.hidden = false
    error.textContent = '버전을 골라 주세요.'
    return
  }
  if (!$('eula').checked) {
    error.hidden = false
    error.textContent = 'Minecraft EULA 에 동의해야 서버를 만들 수 있습니다.'
    return
  }

  let properties
  try {
    properties = parseProperties()
  } catch (err) {
    error.hidden = false
    error.textContent = err?.message || 'server.properties 를 읽지 못했습니다.'
    return
  }

  creating = true
  $('createBtn').disabled = true
  $('createBtn').textContent = '만드는 중…'
  $('runLabel').textContent = '서버 폴더와 파일을 준비합니다…'
  $('runPanel').hidden = false
  progressLines = []
  pushProgress('서버 폴더와 파일을 준비합니다…')

  try {
    const result = await window.engine.createServer({
      name,
      type: activeType,
      version,
      memoryMb: Number($('memory').value) || 2048,
      port: Number($('port').value) || 25565,
      eula: true,
      properties,
    })
    if (!result.ok) throw new Error(result.error)
    $('runLabel').textContent = '완료되었습니다.'
    pushProgress('완료되었습니다.')
    selected = result.id
    wizardOpen = false
    window.setTimeout(() => {
      creating = false
      $('createBtn').disabled = false
      $('createBtn').textContent = '서버 만들기'
      $('wizard').hidden = true
    }, 700)
  } catch (err) {
    error.hidden = false
    error.textContent = friendly(err?.message)
    creating = false
    $('createBtn').disabled = false
    $('createBtn').textContent = '서버 만들기'
    $('runPanel').hidden = true
  }
}

// --- 제어 ------------------------------------------------------------------

async function control(type, args = {}) {
  if (!selected || busy) return
  const server = serverFor(selected)
  if (!server || !server.local) return
  busy = true
  $('ctrlError').hidden = true
  paintButtons()
  try {
    await window.engine.run({ serverId: selected, type, args })
  } catch (err) {
    $('ctrlError').hidden = false
    $('ctrlError').textContent = friendly(err?.message)
  } finally {
    // 너무 빨리 또 누르는 것을 막습니다.
    window.setTimeout(() => {
      busy = false
      paintButtons()
    }, 450)
  }
}

async function assignToThisPc() {
  if (!selected) return
  $('assignBtn').disabled = true
  try {
    await window.engine.assign(selected)
  } catch (err) {
    $('ctrlError').hidden = false
    $('ctrlError').textContent = friendly(err?.message)
  } finally {
    $('assignBtn').disabled = false
    render()
  }
}

// 서버를 콘솔에서 삭제합니다. 확인은 메인 프로세스의 대화상자가 합니다.
async function deleteServer() {
  if (!selected) return
  const button = $('deleteBtn')
  button.disabled = true
  $('ctrlError').hidden = true
  try {
    const result = await window.engine.deleteServer(selected)
    if (result && result.ok) {
      selected = null
      lastLogText = null
      render()
    }
  } catch (err) {
    $('ctrlError').hidden = false
    $('ctrlError').textContent = friendly(err?.message)
  } finally {
    button.disabled = false
  }
}

// --- 기존 서버 가져오기 -----------------------------------------------------

function importError(message) {
  const box = $('ctrlError')
  box.hidden = false
  box.textContent = friendly(message)
}

async function importFrom(dir) {
  $('ctrlError').hidden = true
  try {
    const result = await window.engine.importServer(dir)
    if (!result || result.cancelled) return
    if (result.ok) {
      selected = result.id
      stick = true
      render()
    }
  } catch (error) {
    importError(error?.message)
  }
}

function paintButtons() {
  const server = serverFor(selected)
  const local = Boolean(server && server.local)
  const on = local && !busy
  $('btnStart').disabled = !on
  $('btnStop').disabled = !on
  $('btnRestart').disabled = !on
  $('cmdInput').disabled = !local
  $('assignBtn').disabled = !server || local || creating
}

// --- 탭: 콘솔 · 파일 · 플러그인 · 플레이어 · 월드 지도 · 접속 ---------------

const panel = {
  serverId: null,
  tab: 'console',
  version: 0,
  renderKey: '',
  requested: new Set(),
  error: { files: '', plugins: '', players: '', map: '', access: '', admins: '', backups: '', settings: '' },
  files: { folder: '.', entries: null, editing: null, saved: false, busy: false },
  plugins: { installed: null, query: '', hits: null, busy: '' },
  players: { banned: null, target: '', busy: '', whitelist: null },
  map: { data: null, busy: false, loaded: false },
  access: { data: null, name: '', busy: false, loaded: false },
  admins: { list: null, email: '', busy: false },
  // 백업/업그레이드 진행 상황 — 메인 프로세스가 보내는 줄을 그대로 보여 줍니다.
  progress: { serverId: null, line: '' },
  backups: { list: null, cloud: null, busy: '' },
  settings: {
    loaded: false,
    prefs: null,
    versions: null,
    version: '',
    busy: '',
    scope: 'upgrade',
    webhook: '',
    events: { start: true, stop: true, crash: true, backup: true },
    schedule: { enabled: false, startAt: '', stopAt: '', days: [0, 1, 2, 3, 4, 5, 6], fired: '' },
    note: '',
  },
}

function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  )
}

function formatBytes(bytes) {
  const size = Number(bytes) || 0
  if (size < 1024) return `${size}B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)}KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)}MB`
  return `${(size / 1024 ** 3).toFixed(1)}GB`
}

function bump() {
  panel.version += 1
  renderPanel()
}

function setPanelError(tab, message) {
  panel.error[tab] = friendly(message)
}

function panelNotice(tab) {
  const message = panel.error[tab]
  return message ? `<p class="notice">${esc(message)}</p>` : ''
}

function resetPanels() {
  panel.error = { files: '', plugins: '', players: '', map: '', access: '', admins: '', backups: '', settings: '' }
  panel.files = { folder: '.', entries: null, editing: null, saved: false, busy: false }
  panel.plugins = { installed: null, query: '', hits: null, busy: '' }
  panel.players = { banned: null, target: '', busy: '', whitelist: null }
  panel.map = { data: null, busy: false, loaded: false }
  panel.access = { data: null, name: '', busy: false, loaded: false }
  panel.admins = { list: null, email: '', busy: false }
  panel.backups = { list: null, cloud: null, busy: '' }
  panel.settings = {
    loaded: false,
    prefs: null,
    versions: null,
    version: '',
    busy: '',
    scope: 'upgrade',
    webhook: '',
    events: { start: true, stop: true, crash: true, backup: true },
    schedule: { enabled: false, startAt: '', stopAt: '', days: [0, 1, 2, 3, 4, 5, 6], fired: '' },
    note: '',
  }
  panel.progress = { serverId: null, line: '' }
  panel.requested.clear()
  panel.version += 1
}

// 상태 폴링마다 부릅니다. 서버가 바뀌었을 때만 패널을 다시 그립니다.
function syncPanels() {
  const server = serverFor(selected)
  if (selected !== panel.serverId) {
    panel.serverId = selected
    resetPanels()
    panel.renderKey = ''
  }
  if (!server && activeTab !== 'console') {
    activeTab = 'console'
    panel.renderKey = ''
  }
  renderPanel()
  ensureTab()
}

// 서버를 고르거나 탭을 바꿀 때 한 번만 호출합니다.
function setTab(tab) {
  activeTab = tab
  panel.renderKey = ''
  renderPanel()
  ensureTab()
}

// 같은 서버·탭에서 데이터를 반복해서 요청하지 않도록 막습니다.
function ensureTab(force = false) {
  const server = serverFor(selected)
  if (!server || activeTab === 'console') return
  const key = `${server.id}|${activeTab}`
  if (!force && panel.requested.has(key)) return
  panel.requested.add(key)

  if (activeTab === 'files' && panel.files.entries === null) void filesLoad('.')
  else if (activeTab === 'plugins' && panel.plugins.installed === null) void pluginsLoad()
  else if (activeTab === 'players' && panel.players.whitelist === null) void playersLoadWhitelist()
  else if (activeTab === 'map' && !panel.map.loaded) void mapLoad()
  else if (activeTab === 'access' && !panel.access.loaded) void accessLoad()
  else if (activeTab === 'admins' && panel.admins.list === null && !panel.error.admins) void adminsLoad()
  else if (activeTab === 'backups' && panel.backups.list === null && !panel.error.backups) void backupsLoad()
  else if (activeTab === 'settings' && !panel.settings.loaded) void settingsLoad()
}

// 콘솔/패널 전환과 탭 표시를 그립니다. 상태 폴링마다 다시 그리지 않도록 키를 비교합니다.
function renderPanel() {
  const server = serverFor(selected)
  const consoleView = !server || activeTab === 'console'
  // 플레이어가 들어오거나 상태·도메인이 바뀌면 같은 탭도 바로 다시 그립니다.
  const local = server ? localFor(server.id) : null
  const sig = server
    ? [
        server.state,
        server.players,
        server.max_players,
        server.domain,
        server.device_id,
        server.last_error,
        local ? `${local.players}:${(local.names || []).join(',')}` : '',
      ].join('|')
    : ''
  const key = `${selected ?? '-'}|${activeTab}|${sig}|${panel.version}`

  $('tabbar').hidden = !server
  for (const button of document.querySelectorAll('.ptab')) {
    const on = button.dataset.tab === activeTab
    button.classList.toggle('active', on)
    button.setAttribute('aria-selected', on ? 'true' : 'false')
    // 모드 서버에서는 플러그인 탭을 "모드" 로 부릅니다.
    if (button.dataset.tab === 'plugins') {
      button.textContent = isModServer(server) ? '모드' : '플러그인'
    }
  }

  $('logwrap').hidden = !consoleView
  $('cmdForm').hidden = !consoleView
  $('panel').hidden = consoleView
  if (consoleView) {
    panel.renderKey = key
    return
  }
  if (key === panel.renderKey) return

  const html =
    activeTab === 'files'
      ? filesHtml()
      : activeTab === 'plugins'
        ? pluginsHtml(server)
        : activeTab === 'players'
          ? playersHtml(server)
          : activeTab === 'map'
            ? mapHtml()
            : activeTab === 'admins'
              ? adminsHtml(server)
              : activeTab === 'backups'
                ? backupsHtml(server)
                : activeTab === 'settings'
                  ? settingsHtml(server)
                  : accessHtml()
  $('panel').innerHTML = html
  panel.renderKey = key
}

// 결과를 돌려받는 명령 하나. 웹 콘솔과 같은 명령 이름을 씁니다.
async function runCmd(type, args = {}) {
  const res = await window.engine.run({ serverId: selected, type, args })
  if (!res || res.ok !== true) throw new Error((res && res.error) || '명령에 실패했습니다.')
  if (!res.result) return {}
  try {
    return JSON.parse(res.result)
  } catch {
    return {}
  }
}

// 서버 종류에 맞는 로더만 골라 설치합니다. (예: Paper 서버에 NeoForge 짝은 안 맞음)
const PLUGIN_LOADERS = {
  paper: ['paper', 'bukkit', 'spigot', 'folia'],
  purpur: ['purpur', 'paper'],
  velocity: ['velocity'],
  fabric: ['fabric'],
  forge: ['forge', 'neoforge'],
  vanilla: [],
}

function playerNamesOf(server) {
  if (!server) return []
  const local = localFor(server.id)
  if (local && Array.isArray(local.names) && local.names.length) return local.names
  if (server.player_names) {
    try {
      const parsed = JSON.parse(server.player_names)
      if (Array.isArray(parsed)) return parsed.filter((name) => typeof name === 'string')
    } catch {
      /* 읽지 못하면 목록 없이 그립니다 */
    }
  }
  return []
}

// --- 파일 탭 ---------------------------------------------------------------

async function filesLoad(path) {
  const files = panel.files
  files.busy = true
  panel.error.files = ''
  bump()
  try {
    const data = await runCmd('file_list', { path })
    files.folder = path
    files.entries = Array.isArray(data.entries) ? data.entries : []
    files.editing = null
  } catch (error) {
    setPanelError('files', error?.message)
    files.entries = []
  } finally {
    files.busy = false
    bump()
  }
}

async function filesOpen(name) {
  const files = panel.files
  const path = files.folder === '.' ? name : `${files.folder}/${name}`
  files.busy = true
  panel.error.files = ''
  bump()
  try {
    const data = await runCmd('file_read', { path })
    files.editing = { path: data.path || path, content: String(data.content ?? ''), saved: false }
  } catch (error) {
    setPanelError('files', error?.message)
  } finally {
    files.busy = false
    bump()
  }
}

async function filesSave() {
  const files = panel.files
  if (!files.editing) return
  files.busy = true
  panel.error.files = ''
  bump()
  try {
    await runCmd('file_write', { path: files.editing.path, content: files.editing.content })
    files.editing.saved = true
    window.setTimeout(() => {
      if (files.editing) files.editing.saved = false
      bump()
    }, 1600)
  } catch (error) {
    setPanelError('files', error?.message)
  } finally {
    files.busy = false
    bump()
  }
}

function filesHtml() {
  const files = panel.files
  const parts = files.folder === '.' ? [] : files.folder.split('/')
  let acc = ''
  const crumbs = ['<button type="button" data-act="files-root">서버 폴더</button>']
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part
    crumbs.push(`<span class="sep">/</span><button type="button" data-act="files-crumb" data-arg="${esc(acc)}">${esc(part)}</button>`)
  }

  let body
  if (files.entries === null) {
    body = '<p class="loading">폴더 내용을 받는 중…</p>'
  } else if (files.entries.length === 0) {
    body = '<p class="blank">비어 있습니다.</p>'
  } else {
    body = `<div class="rowlist">${files.entries
      .map(
        (entry) => `
          <button type="button" class="rowbtn" data-act="${entry.type === 'dir' ? 'files-dir' : 'files-open'}" data-arg="${esc(entry.name)}" ${files.busy ? 'disabled' : ''}>
            <span class="ico ${entry.type === 'dir' ? 'folder' : ''}">${entry.type === 'dir' ? '▸' : '≡'}</span>
            <span class="grow">${esc(entry.name)}</span>
            <span class="right">${entry.type === 'file' ? formatBytes(entry.size) : ''}</span>
          </button>`,
      )
      .join('')}</div>`
  }

  const editor = files.editing
    ? `<div class="toolbar">
        <p style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:var(--muted)">${esc(files.editing.path)}</p>
        <button type="button" class="btn sm ghost" data-act="files-back">목록</button>
        <button type="button" class="btn sm primary" data-act="files-save" ${files.busy ? 'disabled' : ''}>${files.editing.saved ? '저장됨' : '저장'}</button>
      </div>
      <textarea class="editor" data-input="files-content" spellcheck="false">${esc(files.editing.content)}</textarea>`
    : body

  return `<div class="card">
    <div class="toolbar">
      <button type="button" class="btn sm ghost" data-act="files-up" ${files.folder === '.' || files.busy ? 'disabled' : ''}>상위</button>
      <div class="crumbs">${crumbs.join('')}</div>
      <button type="button" class="btn sm ghost" data-act="files-refresh" ${files.busy ? 'disabled' : ''}>${files.busy ? '받는 중…' : '새로고침'}</button>
    </div>
    ${panelNotice('files')}
    <div style="margin-top:12px">${editor}</div>
  </div>`
}

// --- 플러그인 탭 -----------------------------------------------------------

async function pluginsLoad() {
  const plugins = panel.plugins
  plugins.installed = null
  panel.error.plugins = ''
  bump()
  try {
    const data = await runCmd('plugin_list', {})
    plugins.installed = Array.isArray(data.entries) ? data.entries : []
  } catch (error) {
    setPanelError('plugins', error?.message)
    plugins.installed = []
  } finally {
    bump()
  }
}

async function pluginsSearch() {
  const plugins = panel.plugins
  const query = plugins.query.trim()
  if (!query || plugins.busy) return
  plugins.busy = '검색 중'
  panel.error.plugins = ''
  bump()
  try {
    const data = await window.engine.searchModrinth(query)
    let hits = Array.isArray(data.hits) ? data.hits : []
    // 서버 타입에 따라 적절한 로더가 있는 항목만 필터링
    const server = serverFor(selected)
    if (server) {
      const mods = isModServer(server)
      const wanted = PLUGIN_LOADERS[server?.server_type ?? ''] ?? []
      if (wanted.length > 0) {
        // 서버 타입에 맞는 로더가 있는 항목만 남김
        hits = hits.filter((hit) => {
          const loaders = hit.loaders || []
          return loaders.some((loader) => wanted.includes(loader))
        })
      }
    }
    plugins.hits = hits
  } catch (error) {
    setPanelError('plugins', error?.message)
    plugins.hits = []
  } finally {
    plugins.busy = ''
    bump()
  }
}

// 플러그인 · 모드를 바꾼 뒤에는 서버를 재시작해야 새 파일이 적용됩니다.
// 그럴지 말지 그 자리에서 묻습니다 — 서버가 켜져 있을 때만 묻는 이유는,
// 꺼져 있는 동안 설치하면 다음에 켜질 때 자연히 적용되기 때문입니다.
async function askRestartAfterChange(summary) {
  const local = localFor(selected)
  const running = Boolean(local && (local.state === 'running' || local.state === 'starting'))
  if (!running) return

  let ok = false
  try {
    ok = await window.engine.confirm({
      title: '서버 재시작',
      message: summary + ' 적용하려면 서버를 재시작해야 합니다.',
      detail: '지금 재시작하면 잠깐 접속이 끊깁니다. 나중에 하면 지금 상태로 그대로 남습니다.',
      confirmLabel: '지금 재시작',
    })
  } catch {
    return // 확인 창을 띄우지 못하면 재시작하지 않고 지나갑니다.
  }
  if (!ok) return

  try {
    await runCmd('restart', {})
  } catch (error) {
    setPanelError('plugins', error?.message)
    bump()
  }
}

async function pluginsInstall(slug) {
  const plugins = panel.plugins
  const hit = (plugins.hits || []).find((item) => item.slug === slug)
  if (!hit || plugins.busy) return
  plugins.busy = `설치 중 · ${hit.title}`
  panel.error.plugins = ''
  bump()
  try {
    const data = await window.engine.modrinthVersions(slug)
    const versions = Array.isArray(data.versions) ? data.versions : []
    if (versions.length === 0) throw new Error('설치할 수 있는 버전이 없습니다.')
    const server = serverFor(selected)
    const wanted = PLUGIN_LOADERS[server?.server_type ?? ''] ?? []
    const matched = wanted.length
      ? versions.filter((item) => (item.loaders || []).some((loader) => wanted.includes(loader)))
      : versions
    const latest = (matched.length ? matched : versions)[0]
    if (!latest) throw new Error('이 서버 종류에 맞는 버전이 없습니다.')
    await runCmd('plugin_install', { versionId: latest.id })
    await pluginsLoad()
    // 성공 경로에서 busy 를 풀지 않으면 그 뒤로 버튼이 계속 눌리지 않습니다.
    plugins.busy = ''
    bump()
    await askRestartAfterChange(hit.title + ' 설치가 끝났습니다.')
    return
  } catch (error) {
    setPanelError('plugins', error?.message)
  }
  plugins.busy = ''
  bump()
}

async function pluginsRemove(name) {
  const plugins = panel.plugins
  if (plugins.busy) return
  plugins.busy = `삭제 중 · ${name}`
  panel.error.plugins = ''
  bump()
  try {
    await runCmd('plugin_remove', { file: name })
    await pluginsLoad()
    // 성공 경로에서 busy 를 풀지 않으면 그 뒤로 버튼이 계속 눌리지 않습니다.
    plugins.busy = ''
    bump()
    await askRestartAfterChange(name + ' 제거가 끝났습니다.')
    return
  } catch (error) {
    setPanelError('plugins', error?.message)
  }
  plugins.busy = ''
  bump()
}

function pluginsHtml(server) {
  const plugins = panel.plugins
  const mods = isModServer(server)
  const folder = mods ? 'mods' : 'plugins'
  const kind = mods ? '모드' : '플러그인'

  let hits = ''
  if (plugins.hits !== null) {
    hits =
      plugins.hits.length === 0
        ? '<p class="blank">검색 결과가 없습니다.</p>'
        : `<div class="rowlist">${plugins.hits
            .slice(0, 8)
            .map(
              (hit) => `
            <div class="rowbtn" style="cursor:default;align-items:flex-start">
              ${
                hit.icon
                  ? `<img src="${esc(hit.icon)}" alt="" style="width:34px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0" />`
                  : '<span class="ico">+</span>'
              }
              <span class="grow" style="white-space:normal">
                <span style="display:flex;gap:8px;align-items:baseline">
                  <span style="font-weight:500">${esc(hit.title)}</span>
                  <span class="right">${Number(hit.downloads || 0).toLocaleString()}회</span>
                </span>
                <span class="sub" style="display:block">${esc(hit.description)}</span>
              </span>
              <button type="button" class="btn sm primary" data-act="plugin-install" data-arg="${esc(hit.slug)}" ${plugins.busy ? 'disabled' : ''}>설치</button>
            </div>`,
            )
            .join('')}</div>`
  }

  let installed
  if (plugins.installed === null) {
    installed = `<p class="loading">${folder} 폴더를 확인하는 중…</p>`
  } else if (plugins.installed.length === 0) {
    installed = `<p class="blank">아직 설치된 ${mods ? '모드가' : '플러그인이'} 없습니다. 위에서 검색해 보세요.</p>`
  } else {
    installed = `<div class="rowlist">${plugins.installed
      .map(
        (plugin) => `
        <div class="rowbtn" style="cursor:default">
          <span class="ico">≡</span>
          <span class="grow">${esc(plugin.name)}</span>
          <span class="right">${formatBytes(plugin.size)}</span>
          <button type="button" class="mini danger" data-act="plugin-remove" data-arg="${esc(plugin.name)}" title="삭제" ${plugins.busy ? 'disabled' : ''}>✕</button>
        </div>`,
      )
      .join('')}</div>`
  }

  return `<div class="card">
    <form class="searchrow" data-form="plugin-search">
      <input type="text" data-input="plugin-query" value="${esc(plugins.query)}" placeholder="Modrinth 에서 ${kind} 검색 (예: ${mods ? 'Sodium, Lithium' : 'Essentials, LuckPerms'})" />
      <button type="submit" class="btn primary" ${plugins.busy ? 'disabled' : ''}>검색</button>
    </form>
    ${panelNotice('plugins')}
    ${plugins.busy ? `<p class="busy"><span class="spin">◌</span>${esc(plugins.busy)}</p>` : ''}
    ${hits ? `<div style="margin-top:12px">${hits}</div>` : ''}
    <div class="toolbar" style="margin-top:18px">
      <p style="flex:1;font-size:13px;font-weight:600">설치된 ${kind}</p>
      <button type="button" class="btn sm ghost" data-act="plugins-refresh" ${plugins.busy ? 'disabled' : ''}>새로고침</button>
    </div>
    <div style="margin-top:8px">${installed}</div>
    ${server && !server.local ? '<p class="sub">이 서버는 다른 PC에 있습니다. 설치·삭제는 그 PC가 켜져 있어야 실행됩니다.</p>' : ''}
  </div>`
}

// --- 플레이어 탭 -----------------------------------------------------------

async function sendLine(line) {
  panel.error.players = ''
  panel.players.busy = line
  bump()
  try {
    await runCmd('command', { line })
  } catch (error) {
    setPanelError('players', `${error?.message}`)
  } finally {
    panel.players.busy = ''
    bump()
  }
}

// server.properties 에서 white-list 값을 읽습니다.
// 파일이 없어 못 읽으면 null 로 두어 "모름"과 실제 꺼짐을 구분합니다.
async function playersLoadWhitelist() {
  const players = panel.players
  try {
    const data = await runCmd('file_read', { path: 'server.properties' })
    const hit = /(^|\n)\s*white-list\s*=\s*(true|false)/i.exec(String(data.content || ''))
    players.whitelist = hit ? hit[2].toLowerCase() === 'true' : false
  } catch {
    players.whitelist = null
  }
  bump()
}

// white-list 를 파일에 기록하고, 서버가 떠 있으면 바로 꺼집니다.
// (Minecraft 는 파일 값만 읽어 켜기 때문에 두 가지를 다 해야 즉시 + 영구히 반영됩니다.)
async function playersToggleWhitelist() {
  const players = panel.players
  if (players.busy || players.whitelist === null) return

  const next = !players.whitelist
  const written = next ? 'true' : 'false'
  players.busy = '화이트리스트 설정 중…'
  panel.error.players = ''
  bump()
  try {
    const data = await runCmd('file_read', { path: 'server.properties' })
    const text = String(data.content || '')
    const hasLine = /(^|\n)\s*white-list\s*=\s*(true|false)/i.test(text)
    const updated = hasLine
      ? text.replace(/(^|\n)(\s*white-list\s*=\s*)(true|false)/gi, (whole, newline, head) => newline + head + written)
      : text.replace(/\s+$/, '') + (text.trim() ? '\n' : '') + 'white-list=' + written
    await runCmd('file_write', { path: 'server.properties', content: updated })
    players.whitelist = next

    const local = localFor(selected)
    if (local && (local.state === 'running' || local.state === 'starting')) {
      await runCmd('command', { line: next ? 'whitelist on' : 'whitelist off' })
    }
  } catch (error) {
    setPanelError('players', error?.message)
  }
  players.busy = ''
  bump()
}

async function playersLoadBanned() {
  panel.error.players = ''
  panel.players.banned = []
  bump()
  try {
    const data = await runCmd('file_read', { path: 'banned-players.json' })
    const parsed = JSON.parse(String(data.content || '[]'))
    panel.players.banned = Array.isArray(parsed)
      ? parsed.map((entry) => entry && entry.name).filter((name) => typeof name === 'string')
      : []
  } catch {
    panel.players.banned = []
  } finally {
    bump()
  }
}

// 사진 목업과 같은 라인 아이콘 — stroke 는 currentColor 를 따라 버튼 색과 함께 바뀝니다.
const ICONS = {
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  shieldPlus: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9 12h6"/><path d="M12 9v6"/>',
  shieldMinus: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M9 12h6"/>',
  eyeOff: '<path d="M10.7 5.1a10.7 10.7 0 0 1 11.2 6.6 1 1 0 0 1 0 .7 10.7 10.7 0 0 1-1.4 2.5"/><path d="M14.1 14.2a3 3 0 0 1-4.2-4.3"/><path d="M17.5 17.5a10.8 10.8 0 0 1-15.4-5.2 1 1 0 0 1 0-.7 10.8 10.8 0 0 1 4.4-5.1"/><path d="m2 2 20 20"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  starOff: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/><path d="M4 4l16 16"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
}

function icon(name, size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`
}

function playersHtml(server) {
  const players = panel.players
  const local = server ? localFor(server.id) : null
  const names = playerNamesOf(server)
  const count = local && local.players !== null ? local.players : (server?.players ?? names.length)
  const max = local && local.maxPlayers ? local.maxPlayers : (server?.max_players ?? null)
  const target = players.target.trim()

  const chips = names.length
    ? `<div class="badges">${names
        .map(
          (name) => `<span class="badge">${esc(name)}
            <button type="button" class="mini" data-act="player-kick" data-arg="${esc(name)}" title="강퇴" aria-label="강퇴">${icon('user', 14)}</button>
            <button type="button" class="mini danger" data-act="player-ban" data-arg="${esc(name)}" title="밴" aria-label="밴">${icon('ban', 14)}</button>
          </span>`,
        )
        .join('')}</div>`
    : '<p class="blank">지금 접속한 플레이어가 없습니다.</p>'

  const actions = [
    ['wl-add', '화이트리스트 추가', 'shieldPlus'],
    ['wl-remove', '화이트리스트 제거', 'shieldMinus'],
    ['do-ban', '밴', 'ban'],
    ['do-pardon', '밴 해제', 'eyeOff'],
    ['do-op', 'OP 부여', 'star'],
    ['do-deop', 'OP 회수', 'starOff'],
  ]
    .map(
      ([act, label, ic]) =>
        `<button type="button" class="ibtn" data-act="${act}" title="${label}" aria-label="${label}" ${target ? '' : 'disabled'}>${icon(ic, 16)}</button>`,
    )
    .join('')

  let banned
  if (players.banned === null) {
    banned = '<p class="sub">banned-players.json 을 불러오면 여기에 표시됩니다.</p>'
  } else if (players.banned.length === 0) {
    banned = '<p class="blank">밴된 플레이어가 없습니다.</p>'
  } else {
    banned = `<div class="badges" style="margin-top:8px">${players.banned
      .map(
        (name) => `<span class="badge ban">${esc(name)}
          <button type="button" class="mini" data-act="ban-unban" data-arg="${esc(name)}" title="해제">해제</button>
        </span>`,
      )
      .join('')}</div>`
  }

  return `<div class="card">
    <div class="toolbar">
      <p style="flex:1;font-size:13px;font-weight:600">접속 중인 플레이어</p>
      <span class="right">${count}${max ? ` / ${max}` : ''}명</span>
    </div>
    <div style="margin-top:10px">${chips}</div>
    ${players.busy ? `<p class="busy"><span class="spin">◌</span>${esc(players.busy)} 보내는 중…</p>` : ''}
    ${panelNotice('players')}
    <label class="check" style="margin-top:14px">
      <input type="checkbox" data-act="wl-toggle" ${players.whitelist ? 'checked' : ''} ${
        players.whitelist === null || players.busy ? 'disabled' : ''
      } />
      <span>화이트리스트 켜기 — server.properties 의 white-list 를 바꿉니다</span>
    </label>
    ${players.whitelist === null ? '<p class="sub">server.properties 를 읽지 못해 상태를 모릅니다.</p>' : ''}
    <div class="searchrow" style="margin-top:16px">
      <input type="text" data-input="player-target" value="${esc(players.target)}" placeholder="플레이어 이름" />
      ${actions}
    </div>
  </div>
  <div class="card">
    <div class="toolbar">
      <p style="flex:1;font-size:13px;font-weight:600">밴 목록</p>
      <button type="button" class="ibtn" data-act="banned-load" title="불러오기" aria-label="불러오기">${icon('refresh', 16)}</button>
    </div>
    ${banned}
  </div>`
}

// --- 월드 지도 탭 -----------------------------------------------------------

async function mapLoad() {
  const map = panel.map
  map.loaded = true
  map.busy = false
  bump()
  try {
    map.data = await window.engine.getWorldMap(selected)
    panel.error.map = ''
  } catch (error) {
    map.data = null
    // 아직 그려둔 지도가 없다는 답은 오류가 아니라 "없음"으로 둡니다.
    const message = String(error?.message || '')
    // 아직 준비 전인 상태는 오류가 아니라 "지도 없음" 안내로 넘깁니다.
    const notReady = /아직 그려둔|가 아직 없습니다|저장된 청크/.test(message)
    panel.error.map = notReady ? '' : friendly(message)
  } finally {
    bump()
  }
}

async function mapDraw() {
  const map = panel.map
  if (map.busy) return
  map.busy = true
  panel.error.map = ''
  bump()

  const server = serverFor(selected)
  const local = server ? localFor(server.id) : null
  const active = Boolean(local && ['running', 'starting'].includes(local.state))

  let failure = ''
  try {
    if (active) {
      // 실행 중이면 그림을 그리기 전에 월드를 디스크에 기록시킵니다 —
      // 서버를 켜자마자 는 region 파일이 아직 없어 지도가 안 나오는 경우가 많습니다.
      try {
        await runCmd('command', { line: 'save-all flush' })
      } catch {
        /* 아직 명령을 받지 못하는 시작 단계일 수 있습니다 */
      }
      await new Promise((resolve) => window.setTimeout(resolve, 3000))
    }
    await runCmd('world_map', {})
  } catch (error) {
    failure = friendly(error?.message)
  }
  await mapLoad()
  // 그림에 실패한 이유를 지도 없음 안내가 덮어쓰지 않도록 마지막에 다시 올립니다.
  if (failure) {
    panel.error.map = failure
    bump()
  }
}

function mapHtml() {
  const map = panel.map
  const info = map.data
    ? `${map.data.world} · ${new Date(map.data.updatedAt).toLocaleString('ko-KR')} 그림`
    : '서버 폴더의 월드 파일을 읽어 그립니다. 서버는 꺼져 있어도 됩니다.'

  return `<div class="card">
    <div class="toolbar">
      <div style="flex:1;min-width:0">
        <p style="font-size:13px;font-weight:600">월드 지도</p>
        <p class="sub">${esc(info)}</p>
      </div>
      <button type="button" class="btn sm primary" data-act="map-draw" ${map.busy ? 'disabled' : ''}>${map.busy ? '그리는 중…' : map.data ? '다시 그리기' : '지도 그리기'}</button>
    </div>
    ${panelNotice('map')}
    <div style="margin-top:12px">
      ${
        map.data
          ? `<div class="imgbox"><img src="data:image/png;base64,${esc(map.data.png)}" alt="${esc(map.data.world)} 지도" /></div>`
          : map.busy
            ? '<p class="loading">지도를 그리는 중…</p>'
            : '<p class="blank">아직 그려둔 지도가 없습니다. 오른쪽 위의 “지도 그리기”를 누르세요.</p>'
      }
    </div>
  </div>`
}

// --- 접속 탭 ---------------------------------------------------------------

async function accessLoad() {
  const access = panel.access
  access.loaded = true
  access.busy = false
  bump()
  try {
    access.data = await window.engine.getAccess(selected)
    panel.error.access = ''
  } catch (error) {
    access.data = null
    setPanelError('access', error?.message)
  } finally {
    bump()
  }
}

async function domainMake() {
  const access = panel.access
  const name = access.name.trim()
  if (!name || access.busy) return
  access.busy = true
  panel.error.access = ''
  bump()
  try {
    await window.engine.makeDomain(selected, name)
    access.name = ''
    await accessLoad()
    return
  } catch (error) {
    setPanelError('access', error?.message)
  }
  access.busy = false
  bump()
}

async function domainDelete() {
  const access = panel.access
  if (access.busy) return
  access.busy = true
  panel.error.access = ''
  bump()
  try {
    await window.engine.deleteDomain(selected)
    await accessLoad()
    return
  } catch (error) {
    setPanelError('access', error?.message)
  }
  access.busy = false
  bump()
}

async function copyText(text) {
  if (!text) return
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* 아래 방식으로 다시 시도합니다 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  } catch {
    /* 복사를 막는 환경 */
  }
}

function accessHtml() {
  const access = panel.access
  const info = access.data
  const address =
    (info && info.domain) || (info && info.relayHost && info.relayPort ? `${info.relayHost}:${info.relayPort}` : '')

  const hints = []
  if (info && !info.configured) {
    hints.push('중계 서버 설정이 필요합니다 — relay/ 폴더를 VPS 에서 돌리고 RELAY_HOST · RELAY_IP 를 넣어주세요.')
  }
  if (info && !info.dnsConfigured) {
    hints.push('도메인 자동 등록에는 CLOUDFLARE_API_TOKEN 과 CLOUDFLARE_ZONE_ID 시크릿이 필요합니다.')
  }
  hints.push('접속 방식 — 플레이어는 중계 서버로 들어오고, 그 연결을 에이전트가 집 PC의 서버 포트로 이어 붙입니다. 집 공유기에서 아무것도 열지 않아도 됩니다.')

  return `<div class="card">
    <p style="font-size:13px;font-weight:600">접속 주소</p>
    ${
      address
        ? `<div class="searchrow" style="margin-top:8px">
            <span class="addr">${esc(address)}</span>
            <button type="button" class="btn" data-act="access-copy" data-arg="${esc(address)}">복사</button>
          </div>`
        : '<p class="sub">아직 중계 서버가 연결되지 않았습니다. 중계 서버를 준비하면 포트포워딩 없이도 이 주소로 접속할 수 있습니다.</p>'
    }
  </div>

  <div class="card">
    <p style="font-size:13px;font-weight:600">◎ 내 도메인 만들기</p>
    <p class="sub">${
      info && info.domain
        ? `현재 <b>${esc(info.domain)}</b> · 마인크래프트 서버 주소창에 이 이름만 입력하면 됩니다.`
        : '이름을 정하면 내 서버 이름.lubit.kr 주소가 생깁니다.'
    }</p>
    <div style="margin-top:10px">
      ${
        info && info.domain
          ? `<button type="button" class="btn sm ghost" data-act="domain-delete" ${access.busy ? 'disabled' : ''}>도메인 삭제</button>`
          : `<form class="searchrow" data-form="domain">
              <input type="text" data-input="domain-name" value="${esc(access.name)}" placeholder="내 서버 이름 (영문)" />
              <button type="submit" class="btn primary" ${access.busy || !access.name.trim() ? 'disabled' : ''}>만들기</button>
            </form>`
      }
    </div>
    ${access.busy ? '<p class="busy" style="margin-top:8px"><span class="spin">◌</span>처리 중…</p>' : ''}
    ${panelNotice('access')}
  </div>

  <div class="card">${hints.map((hint) => `<p class="hintline">${esc(hint)}</p>`).join('')}</div>`
}

// --- 관리자 탭 (이메일로 사람을 등록해 함께 관리) --------------------------

async function adminsLoad() {
  const admins = panel.admins
  bump()
  try {
    admins.list = await window.engine.listAdmins(selected)
    panel.error.admins = ''
    admins.busy = false
  } catch (error) {
    admins.list = null
    setPanelError('admins', error?.message)
    admins.busy = false
  } finally {
    bump()
  }
}

async function adminsAdd() {
  const admins = panel.admins
  const email = admins.email.trim()
  if (!email || admins.busy) return
  admins.busy = true
  panel.error.admins = ''
  bump()
  try {
    await window.engine.addAdmin(selected, email)
    admins.email = ''
    await adminsLoad()
    // 관리자 추가 후 도메인 정보도 다시 로드하여 동기화
    if (activeTab === 'access') {
      panel.access.loaded = false
      await accessLoad()
    }
    // 관리자 추가 후 콘솔 탭으로 전환하여 콘솔이 보이게 함
    setTab('console')
    return
  } catch (error) {
    setPanelError('admins', error?.message)
  }
  admins.busy = false
  bump()
}

async function adminsRemove(email) {
  const admins = panel.admins
  if (admins.busy) return
  admins.busy = true
  panel.error.admins = ''
  bump()
  try {
    await window.engine.removeAdmin(selected, email)
    await adminsLoad()
    return
  } catch (error) {
    setPanelError('admins', error?.message)
  }
  admins.busy = false
  bump()
}

function adminsHtml(server) {
  const admins = panel.admins
  const data = admins.list
  const owner = Boolean(data && data.role === 'owner')
  const rows = data ? data.admins || [] : []

  let list
  if (!data) {
    list = panel.error.admins ? '' : '<p class="loading">관리자 목록을 확인하는 중…</p>'
  } else if (rows.length === 0) {
    list = '<p class="blank">아직 등록된 관리자가 없습니다. 위에 이메일을 적어 등록하세요.</p>'
  } else {
    list = `<div class="rowlist">${rows
      .map(
        (admin) => `
        <div class="rowbtn" style="cursor:default">
          <span class="ico">+</span>
          <span class="grow" style="min-width:0">
            ${esc(admin.email)}
            <span class="sub" style="display:block">${admin.registered ? `${esc(admin.displayName || '')} · 가입됨` : '아직 가입 전 — 그 이메일로 가입하면 바로 열립니다'}</span>
          </span>
          ${owner ? `<button type="button" class="mini danger" data-act="admin-remove" data-arg="${esc(admin.email)}" title="관리자 삭제" ${admins.busy ? 'disabled' : ''}>✕</button>` : ''}
        </div>`,
      )
      .join('')}</div>`
  }

  return `<div class="card">
    <p style="font-size:13px;font-weight:600">함께 관리하는 사람</p>
    <p class="sub">이메일로 등록하면 그 사람도 자신의 계정으로 로그인해 이 서버를 함께 관리합니다. 시작·중지·콘솔·파일·플러그인·도메인까지 같고, 서버 삭제와 기기 변경·관리자 관리만 주인에게 남습니다.</p>
    <div style="margin-top:10px">
      ${
        !data
          ? ''
          : owner
            ? `<form class="searchrow" data-form="admin-add">
                <input type="email" data-input="admin-email" value="${esc(admins.email)}" placeholder="관리자 이메일 (예: friend@example.com)" />
                <button type="submit" class="btn primary" ${admins.busy || !admins.email.trim() ? 'disabled' : ''}>등록</button>
              </form>`
            : `<p class="sub">이 서버의 주인은 <b>${esc(data.owner?.email ?? '—')}</b> 님입니다. 관리자 등록과 삭제는 주인만 할 수 있습니다.</p>`
      }
    </div>
    ${admins.busy ? '<p class="busy" style="margin-top:8px"><span class="spin">◌</span>처리 중…</p>' : ''}
    ${panelNotice('admins')}
  </div>

  <div class="card">
    <div class="toolbar">
      <p style="flex:1;font-size:13px;font-weight:600">관리자 ${rows.length}명</p>
      <button type="button" class="btn sm ghost" data-act="admins-refresh" ${admins.busy ? 'disabled' : ''}>새로고침</button>
    </div>
    <div style="margin-top:8px">${list}</div>
    ${server && !server.local ? '<p class="sub">이 서버는 다른 PC에 있습니다. 관리 작업은 그 PC가 켜져 있어야 실행됩니다.</p>' : ''}
  </div>`
}

// --- 백업 탭 ---------------------------------------------------------------

async function backupsLoad() {
  const backups = panel.backups
  bump()
  try {
    const [local, cloud] = await Promise.all([
      window.engine.backupList(selected),
      window.engine.cloudBackupList(selected).catch((error) => {
        // 저장소가 아직 안 켜져 있으면 목록 대신 이유를 카드에 보여 줍니다.
        backups.cloudError = friendly(error?.message)
        return { backups: [] }
      }),
    ])
    backups.list = local
    backups.cloud = Array.isArray(cloud.backups) ? cloud.backups : []
    panel.error.backups = ''
  } catch (error) {
    backups.list = []
    backups.cloud = backups.cloud || []
    setPanelError('backups', error?.message)
  } finally {
    backups.busy = ''
    bump()
  }
}

async function cloudUpload() {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '클라우드에 올리는 중'
  backups.cloudError = ''
  panel.error.backups = ''
  bump()
  try {
    await window.engine.cloudBackupUpload(selected)
    await backupsLoad()
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

async function cloudDownload(id, name) {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '클라우드에서 내려받는 중'
  backups.cloudError = ''
  panel.error.backups = ''
  bump()
  try {
    await window.engine.cloudBackupDownload(selected, id, name)
    // 받은 파일로 바로 복원합니다 — 확인 창과 중지 절차는 복원 쪽이 합니다.
    backups.busy = ''
    bump()
    await backupRestore(name)
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

async function cloudDelete(id) {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '삭제하는 중'
  backups.cloudError = ''
  panel.error.backups = ''
  bump()
  try {
    await window.engine.cloudBackupDelete(selected, id)
    await backupsLoad()
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

async function backupCreate() {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '만드는 중'
  panel.error.backups = ''
  bump()
  try {
    await window.engine.backupCreate(selected)
    await backupsLoad()
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

async function backupRestore(file) {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '복원하는 중'
  panel.error.backups = ''
  bump()
  try {
    await window.engine.backupRestore(selected, file)
    await backupsLoad()
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

async function backupDelete(file) {
  const backups = panel.backups
  if (backups.busy) return
  backups.busy = '삭제하는 중'
  panel.error.backups = ''
  bump()
  try {
    await window.engine.backupDelete(selected, file)
    await backupsLoad()
    return
  } catch (error) {
    setPanelError('backups', error?.message)
  }
  backups.busy = ''
  bump()
}

function backupsHtml(server) {
  const backups = panel.backups
  const rows = backups.list
  const progress = panel.progress.serverId === selected ? panel.progress.line : ''

  let list
  if (rows === null) {
    list = '<p class="loading">백업 목록을 확인하는 중…</p>'
  } else if (rows.length === 0) {
    list = '<p class="blank">아직 백업이 없습니다. 위의 “만들기”로 남겨 두세요.</p>'
  } else {
    list = `<div class="rowlist">${rows
      .map(
        (row) => `
        <div class="rowbtn" style="cursor:default">
          <span class="ico">▦</span>
          <span class="grow" style="min-width:0">
            ${esc(row.file)}
            <span class="sub" style="display:block">${new Date(row.createdAt).toLocaleString('ko-KR')} · ${formatBytes(row.size)}</span>
          </span>
          <button type="button" class="btn sm" data-act="backup-restore" data-arg="${esc(row.file)}" ${backups.busy ? 'disabled' : ''}>복원</button>
          <button type="button" class="mini danger" data-act="backup-delete" data-arg="${esc(row.file)}" title="삭제" ${backups.busy ? 'disabled' : ''}>✕</button>
        </div>`,
      )
      .join('')}</div>`
  }

  const cloudRows = backups.cloud
  let cloudList
  if (cloudRows === null) {
    cloudList = '<p class="loading">클라우드 목록을 확인하는 중…</p>'
  } else if (backups.cloudError) {
    cloudList = `<p class="blank">${esc(backups.cloudError)}</p>`
  } else if (cloudRows.length === 0) {
    cloudList = '<p class="blank">아직 올린 백업이 없습니다. “클라우드에 올리기”를 누르세요.</p>'
  } else {
    cloudList = `<div class="rowlist">${cloudRows
      .map(
        (row) => `
        <div class="rowbtn" style="cursor:default">
          <span class="ico">☁</span>
          <span class="grow" style="min-width:0">
            ${esc(row.name)}
            <span class="sub" style="display:block">${new Date(row.createdAt).toLocaleString('ko-KR')} · ${formatBytes(row.size)}</span>
          </span>
          <button type="button" class="btn sm" data-act="cloud-download" data-arg="${row.id}" data-name="${esc(row.name)}" ${backups.busy ? 'disabled' : ''}>받기</button>
          <button type="button" class="mini danger" data-act="cloud-delete" data-arg="${row.id}" title="삭제" ${backups.busy ? 'disabled' : ''}>✕</button>
        </div>`,
      )
      .join('')}</div>`
  }

  return `<div class="card">
    <div class="toolbar">
      <div style="flex:1;min-width:0">
        <p style="font-size:13px;font-weight:600">새 백업 만들기</p>
        <p class="sub">서버 폴더 전체를 zip 으로 남깁니다. 실행 중일 때는 월드를 먼저 저장한 뒤 담습니다.</p>
      </div>
      <button type="button" class="btn sm ghost" data-act="backups-open">폴더 열기</button>
      <button type="button" class="btn sm primary" data-act="backups-create" ${backups.busy ? 'disabled' : ''}>${backups.busy ? '만드는 중…' : '만들기'}</button>
    </div>
    ${progress ? `<p class="busy" style="margin-top:8px"><span class="spin">◌</span>${esc(progress)}</p>` : ''}
    ${panelNotice('backups')}
  </div>

  <div class="card">
    <div class="toolbar">
      <div style="flex:1;min-width:0">
        <p style="font-size:13px;font-weight:600">클라우드 백업</p>
        <p class="sub">계정 저장소에 올려 두면 PC 가 고장나도 되돌릴 수 있습니다. 올리기는 로컬 zip 을 만든 뒤 전송합니다 (최대 2GB).</p>
      </div>
      <button type="button" class="btn sm" data-act="cloud-upload" ${backups.busy ? 'disabled' : ''}>클라우드에 올리기</button>
    </div>
    <div style="margin-top:10px">${cloudList}</div>
    <p class="sub" style="margin-top:8px">“받기”는 파일을 내려받은 뒤 바로 복원 절차로 들어갑니다.</p>
  </div>

  <div class="card">
    <div class="toolbar">
      <p style="flex:1;font-size:13px;font-weight:600">백업 목록${rows ? ` · ${rows.length}개` : ''}</p>
      <button type="button" class="btn sm ghost" data-act="backups-refresh" ${backups.busy ? 'disabled' : ''}>새로고침</button>
    </div>
    <div style="margin-top:8px">${list}</div>
    <p class="sub" style="margin-top:10px">복원은 서버 폴더를 백업 내용으로 바꿉니다 — 실행 중이면 먼저 중지합니다. 백업은 루트 폴더의 <b>_lubit_backups</b> 안에 쌓입니다.</p>
    ${server && !server.local ? '<p class="sub">이 서버는 다른 PC에 있습니다. 백업도 거기서 만들어야 합니다.</p>' : ''}
  </div>`
}

// --- 설정 탭 (버전 업그레이드 · 웹훅 · 자동 시작/종료) --------------------

async function settingsLoad() {
  const settings = panel.settings
  settings.loaded = true
  bump()
  try {
    const server = serverFor(selected)
    const type = server ? String(server.server_type || '') : ''
    const [prefs, versions] = await Promise.all([
      window.engine.getServerPrefs(selected),
      type ? window.engine.versions(type).catch(() => []) : Promise.resolve([]),
    ])
    settings.prefs = prefs
    settings.webhook = prefs.webhook || ''
    settings.events = { ...prefs.webhookEvents }
    settings.schedule = { ...prefs.schedule, days: [...(prefs.schedule.days || [0, 1, 2, 3, 4, 5, 6])] }
    settings.versions = Array.isArray(versions) ? versions : []
    // 목록은 최신이 맨 앞 — 바로 고를 수 있게 가장 위 버전을 미리 선택해 둡니다.
    settings.version = settings.versions[0] || ''
    panel.error.settings = ''
  } catch (error) {
    setPanelError('settings', error?.message)
  } finally {
    bump()
  }
}

async function upgradeApply() {
  const settings = panel.settings
  if (settings.busy) return
  settings.scope = 'upgrade'
  if (!settings.version) {
    setPanelError('settings', '바꿀 버전을 골라 주세요.')
    bump()
    return
  }
  settings.busy = '업그레이드 준비 중…'
  settings.note = ''
  panel.error.settings = ''
  bump()
  try {
    const result = await window.engine.upgradeServer(selected, settings.version)
    if (result && result.ok === false) throw new Error(result.error)
    settings.note = `${settings.version} 으로 바꿨습니다 — 이제 시작하면 새 버전으로 실행됩니다.`
  } catch (error) {
    setPanelError('settings', error?.message)
  }
  settings.busy = ''
  bump()
}

async function serverPrefsSave(patch, scope) {
  const settings = panel.settings
  if (settings.busy) return
  settings.scope = scope || 'upgrade'
  settings.busy = '저장 중…'
  settings.note = ''
  panel.error.settings = ''
  bump()
  try {
    const next = await window.engine.setServerPrefs(selected, patch)
    settings.webhook = next.webhook || ''
    settings.events = { ...next.webhookEvents }
    settings.schedule = { ...next.schedule, days: [...(next.schedule.days || [])] }
    settings.note = '저장되었습니다.'
  } catch (error) {
    setPanelError('settings', error?.message)
  }
  settings.busy = ''
  bump()
}

async function webhookSave() {
  await serverPrefsSave({ webhook: panel.settings.webhook.trim() }, 'webhook')
}

async function webhookTest() {
  const settings = panel.settings
  if (settings.busy) return
  settings.scope = 'webhook'
  settings.busy = '테스트 메시지 전송 중…'
  settings.note = ''
  panel.error.settings = ''
  bump()
  try {
    await window.engine.testWebhook(selected)
    settings.note = '테스트 메시지를 보냈습니다 — 채널을 확인해 보세요.'
  } catch (error) {
    setPanelError('settings', error?.message)
  }
  settings.busy = ''
  bump()
}

function scheduleSave() {
  const settings = panel.settings
  settings.scope = 'schedule'
  const schedule = settings.schedule || {}
  if (!schedule.startAt && !schedule.stopAt) {
    setPanelError('settings', '시작 시각 또는 중지 시각 중 하나는 적어 주세요.')
    bump()
    return
  }
  if (!(Array.isArray(schedule.days) && schedule.days.length)) {
    setPanelError('settings', '적용할 요일을 하나 이상 골라 주세요.')
    bump()
    return
  }
  void serverPrefsSave({
    schedule: {
      enabled: Boolean(schedule.enabled),
      startAt: schedule.startAt || '',
      stopAt: schedule.stopAt || '',
      days: schedule.days,
      fired: schedule.fired || '',
    },
  }, 'schedule')
}

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// 저장·업그레이드 결과가 전부 "서버 버전 올리기" 카드에 뜨던 문제를 고칩니다 —
// 어떤 카드의 작업이었는지 scope 로 기억해, 그 카드 안에서만 표시합니다.
function settingsStatus(scope) {
  const settings = panel.settings
  const mine = settings.scope === scope
  const lines = []
  // 서버 진행(설치 · 시작) 표시는 화면 맨 위 카드에서만 보여 줍니다.
  if (scope === 'upgrade' && panel.progress.serverId === selected && panel.progress.line) {
    lines.push(panel.progress.line)
  }
  if (mine && settings.busy) lines.push(settings.busy)

  const note =
    mine && settings.note
      ? `<p class="sub" style="margin-top:8px;color:var(--accent)">${esc(settings.note)}</p>`
      : ''
  const notice = mine ? panelNotice('settings') : ''
  if (!lines.length && !note && !notice) return ''

  return (
    lines
      .map((line) => `<p class="busy" style="margin-top:8px"><span class="spin">◌</span>${esc(line)}</p>`)
      .join('') + note + notice
  )
}

function settingsHtml(server) {
  const settings = panel.settings
  const current = server ? server.mc_version || '—' : '—'
  const forge = Boolean(server && String(server.server_type) === 'forge')
  const events = settings.events || {}
  const schedule = settings.schedule || {}
  const days = Array.isArray(schedule.days) ? schedule.days : []

  let picker
  if (settings.versions === null) {
    picker = '<p class="loading">버전 목록을 받는 중…</p>'
  } else if (!settings.versions.length) {
    picker = '<p class="blank">버전 목록을 받지 못했습니다 — 잠시 후 다시 시도해 주세요.</p>'
  } else {
    picker = `<div class="searchrow">
      <select data-input="upgrade-version" ${settings.busy ? 'disabled' : ''}>${settings.versions
        .slice(0, 300)
        .map((value) => `<option value="${esc(value)}" ${value === settings.version ? 'selected' : ''}>${esc(value)}</option>`)
        .join('')}</select>
      <button type="button" class="btn primary" data-act="upgrade-run" ${settings.busy ? 'disabled' : ''}>이 버전으로 바꾸기</button>
    </div>`
  }

  const upgrade = `<div class="card">
    <p style="font-size:13px;font-weight:600">서버 버전 올리기</p>
    <p class="sub">현재 <b>${esc(current)}</b> · 새 jar 를 받기 전에 자동으로 백업을 만들고, 월드 · 설정 · 플러그인은 그대로 둡니다.</p>
    <div style="margin-top:10px">
      ${
        forge
          ? '<p class="notice info">포지 서버는 실행 방식이 달라 자동 업그레이드를 지원하지 않습니다 — 새 폴더에 만들고 world 만 옮기는 편이 안전합니다.</p>'
          : picker
      }
    </div>
    ${settingsStatus('upgrade')}
  </div>`

  const webhook = `<div class="card">
    <p style="font-size:13px;font-weight:600">Discord 웹훅 알림</p>
    <p class="sub">채널 설정 → 연동 앱 → 웹훅 만들기 로 주소를 받아 붙여 넣으세요. 이 PC에서 돌리는 서버의 시작 · 중지 · 오류 · 백업 소식이 그 채널로 옵니다.</p>
    <div class="searchrow" style="margin-top:10px">
      <input type="url" data-input="webhook-url" value="${esc(settings.webhook || '')}" placeholder="https://discord.com/api/webhooks/…" spellcheck="false" ${settings.busy ? 'disabled' : ''} />
      <button type="button" class="btn" data-act="webhook-save" ${settings.busy ? 'disabled' : ''}>저장</button>
    </div>
    <div class="badges" style="margin-top:10px">
      ${[
        ['start', '시작'],
        ['stop', '중지'],
        ['crash', '오류'],
        ['backup', '백업'],
      ]
        .map(
          ([key, label]) =>
            `<label class="badge" style="cursor:pointer"><input type="checkbox" data-input="webhook-event-${key}" ${events[key] !== false ? 'checked' : ''} style="accent-color:var(--accent);margin-right:5px" />${label}</label>`,
        )
        .join('')}
    </div>
    <div class="toolbar" style="margin-top:10px">
      <button type="button" class="btn sm ghost" data-act="webhook-test" ${settings.busy || !settings.webhook ? 'disabled' : ''}>테스트 메시지 보내기</button>
    </div>
    ${settingsStatus('webhook')}
  </div>`

  const scheduleCard = `<div class="card">
    <p style="font-size:13px;font-weight:600">자동 시작 · 종료</p>
    <p class="sub">정해진 시각에 서버를 켜고 끕니다 — <b>이 PC의 앱이 켜져 있는 동안만</b> 작동합니다. 앱 시작 시각에서 5분 안이면 실행합니다.</p>
    <div class="row3" style="margin-top:10px;grid-template-columns:1fr 1fr;max-width:420px">
      <div class="field"><label for="scheduleStart">시작 시각</label><input id="scheduleStart" type="time" data-input="schedule-start" value="${esc(schedule.startAt || '')}" /></div>
      <div class="field"><label for="scheduleStop">중지 시각</label><input id="scheduleStop" type="time" data-input="schedule-stop" value="${esc(schedule.stopAt || '')}" /></div>
    </div>
    <div class="field" style="margin-top:12px"><label>적용 요일</label>
      <div class="badges">
        ${DAY_LABELS.map(
          (label, day) =>
            `<label class="badge" style="cursor:pointer"><input type="checkbox" data-input="schedule-day-${day}" ${days.includes(day) ? 'checked' : ''} style="accent-color:var(--accent);margin-right:5px" />${label}</label>`,
        ).join('')}
      </div>
    </div>
    <label class="check">
      <input type="checkbox" data-input="schedule-enabled" ${schedule.enabled ? 'checked' : ''} />
      <span>스케줄 켜기</span>
    </label>
    <div class="toolbar" style="margin-top:10px">
      <button type="button" class="btn sm primary" data-act="schedule-save" ${settings.busy ? 'disabled' : ''}>저장</button>
    </div>
    ${settingsStatus('schedule')}
  </div>`

  return `${upgrade}${webhook}${scheduleCard}`
}

// --- 패널 이벤트 (한 번만 연결합니다) --------------------------------------

// 패널 안의 입력·선택 상자 값을 상태에 옮깁니다 — input/change 를 같은 길로 보냅니다.
const WEBHOOK_EVENT = 'webhook-event-'
const SCHEDULE_DAY = 'schedule-day-'

function handleField(el) {
  const key = el.dataset.input
  const settings = panel.settings
  if (key === 'files-content' && panel.files.editing) panel.files.editing.content = el.value
  else if (key === 'plugin-query') panel.plugins.query = el.value
  else if (key === 'player-target') panel.players.target = el.value
  else if (key === 'domain-name') panel.access.name = el.value.toLowerCase()
  else if (key === 'admin-email') panel.admins.email = el.value
  else if (key === 'webhook-url') settings.webhook = el.value
  else if (key === 'upgrade-version') settings.version = el.value
  else if (key === 'schedule-start') settings.schedule.startAt = el.value
  else if (key === 'schedule-stop') settings.schedule.stopAt = el.value
  else if (key === 'schedule-enabled') settings.schedule.enabled = el.checked
  else if (key && key.startsWith(WEBHOOK_EVENT)) {
    settings.events = { ...settings.events, [key.slice(WEBHOOK_EVENT.length)]: el.checked }
  } else if (key && key.startsWith(SCHEDULE_DAY)) {
    const day = Number(key.slice(SCHEDULE_DAY.length))
    const days = new Set(settings.schedule.days || [])
    if (el.checked) days.add(day)
    else days.delete(day)
    settings.schedule.days = [...days].sort((a, b) => a - b)
  }
}

// 입력만으로 활성 여부가 바뀌는 버튼들입니다.
// renderPanel 은 panel.version 이 바뀌어야 DOM 을 통째로 갈아끼우기 때문에, 입력할 때마다
// bump() 하면 포커스와 커서가 날아가 글자가 안 써집니다. 그래서 재렌더 대신
// 지금 눌리지도 않을 버튼의 disabled 만 직접 고쳐 줍니다.
function syncControls(box, el) {
  const key = el && el.dataset ? el.dataset.input : ''
  if (!key) return

  const toggle = (selector, on) => {
    for (const button of box.querySelectorAll(selector)) button.disabled = !on
  }

  if (key === 'player-target') {
    // 이름이 있어야 화이트리스트 · 밴 · OP 버튼이 눌립니다.
    toggle(
      '[data-act="wl-add"],[data-act="wl-remove"],[data-act="do-ban"],' +
        '[data-act="do-pardon"],[data-act="do-op"],[data-act="do-deop"]',
      Boolean(panel.players.target.trim()),
    )
  } else if (key === 'admin-email') {
    toggle('[data-form="admin-add"] button[type="submit"]', Boolean(panel.admins.email.trim()) && !panel.admins.busy)
  } else if (key === 'domain-name') {
    toggle('[data-form="domain"] button[type="submit"]', Boolean(panel.access.name.trim()) && !panel.access.busy)
  } else if (key === 'webhook-url') {
    toggle('[data-act="webhook-test"]', Boolean(panel.settings.webhook) && !panel.settings.busy)
  }
}

function bindPanelEvents() {
  const box = $('panel')

  box.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]')
    if (!el || (el.tagName === 'BUTTON' && el.disabled)) return
    const act = el.dataset.act
    const arg = el.dataset.arg || ''
    const files = panel.files

    if (act === 'files-root') void filesLoad('.')
    else if (act === 'files-up') void filesLoad(files.folder.split('/').slice(0, -1).join('/') || '.')
    else if (act === 'files-crumb') void filesLoad(arg)
    else if (act === 'files-dir') void filesLoad(files.folder === '.' ? arg : `${files.folder}/${arg}`)
    else if (act === 'files-open') void filesOpen(arg)
    else if (act === 'files-refresh') void filesLoad(files.folder)
    else if (act === 'files-back') {
      files.editing = null
      bump()
    } else if (act === 'files-save') void filesSave()
    else if (act === 'plugin-install') void pluginsInstall(arg)
    else if (act === 'plugin-remove') void pluginsRemove(arg)
    else if (act === 'plugins-refresh') void pluginsLoad()
    else if (act === 'player-kick') void sendLine(`kick ${arg}`)
    else if (act === 'player-ban') void sendLine(`ban ${arg}`)
    else if (act === 'ban-unban') void sendLine(`pardon ${arg}`)
    else if (act === 'banned-load') void playersLoadBanned()
    else if (act === 'wl-toggle') void playersToggleWhitelist()
    else if (act === 'wl-add') void sendLine(`whitelist add ${panel.players.target.trim()}`)
    else if (act === 'wl-remove') void sendLine(`whitelist remove ${panel.players.target.trim()}`)
    else if (act === 'do-ban') void sendLine(`ban ${panel.players.target.trim()}`)
    else if (act === 'do-pardon') void sendLine(`pardon ${panel.players.target.trim()}`)
    else if (act === 'do-op') void sendLine(`op ${panel.players.target.trim()}`)
    else if (act === 'do-deop') void sendLine(`deop ${panel.players.target.trim()}`)
    else if (act === 'map-draw') void mapDraw()
    else if (act === 'access-copy') void copyText(arg)
    else if (act === 'domain-delete') void domainDelete()
    else if (act === 'admin-remove') void adminsRemove(arg)
    else if (act === 'admins-refresh') void adminsLoad()
    else if (act === 'backups-create') void backupCreate()
    else if (act === 'backups-refresh') void backupsLoad()
    else if (act === 'backups-open') void window.engine.openBackups()
    else if (act === 'backup-restore') void backupRestore(arg)
    else if (act === 'backup-delete') void backupDelete(arg)
    else if (act === 'cloud-upload') void cloudUpload()
    else if (act === 'cloud-download') void cloudDownload(arg, el.dataset.name || '')
    else if (act === 'cloud-delete') void cloudDelete(arg)
    else if (act === 'upgrade-run') void upgradeApply()
    else if (act === 'webhook-save') void webhookSave()
    else if (act === 'webhook-test') void webhookTest()
    else if (act === 'schedule-save') scheduleSave()
  })

  box.addEventListener('input', (event) => {
    const el = event.target.closest('[data-input]')
    if (!el) return
    handleField(el)
    syncControls(box, el)
  })

  // 체크박스 · select · time 칸은 input 대신 change 로 바뀝니다.
  box.addEventListener('change', (event) => {
    const el = event.target.closest('[data-input]')
    if (!el) return
    handleField(el)
    syncControls(box, el)
  })

  box.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.target
    if (form.dataset.form === 'plugin-search') void pluginsSearch()
    else if (form.dataset.form === 'domain') void domainMake()
    else if (form.dataset.form === 'admin-add') void adminsAdd()
  })
}

// --- 이벤트 ----------------------------------------------------------------

async function init() {
  // 헤더 부제에 설치된 버전을 붙입니다 — 무엇이 바뀐 설치판인지 여기서 확인합니다.
  try {
    const version = await window.engine.appVersion()
    const subtitle = document.querySelector('.brand p')
    if (version && subtitle && !subtitle.textContent.includes(`v${version}`)) {
      subtitle.textContent = `${subtitle.textContent} · v${version}`
    }
  } catch {
    /* 버전 표시는 필수가 아니므로 조용히 넘깁니다 */
  }

  const config = await window.engine.getConfig()
  if (config.root) $('rootPath').textContent = config.root

  state = await window.engine.getState()
  render()
  window.engine.onState((next) => {
    state = next
    render()
  })
  window.engine.onProgress((payload) => pushProgress(payload?.line))

  $('tabLogin').addEventListener('click', () => setLoginMode('login'))
  $('tabRegister').addEventListener('click', () => setLoginMode('register'))
  $('authForm').addEventListener('submit', submitAuth)

  // 소셜 로그인(디스코드·구글)은 같은 화면 흐름을 둘이 함께 씁니다.
  const socialClick = async (button, login) => {
    const pending = $('discordPending')
    if (button.disabled) return
    button.disabled = true
    $('authError').hidden = true
    pending.hidden = false
    pending.textContent = '브라우저에서 계정으로 로그인해 주세요. 완료되면 자동으로 돌아옵니다…'
    try {
      const result = await login()
      if (!result.ok) throw new Error(result.error || '로그인하지 못했습니다.')
      pending.hidden = true
      pending.textContent = ''
    } catch (error) {
      pending.hidden = true
      $('authError').hidden = false
      $('authError').textContent = friendly(error?.message)
    } finally {
      button.disabled = false
    }
  }

  $('discordBtn').addEventListener('click', () => void socialClick($('discordBtn'), () => window.engine.discordLogin()))
  $('googleBtn').addEventListener('click', () => void socialClick($('googleBtn'), () => window.engine.googleLogin()))

  $('logoutBtn').addEventListener('click', async () => {
    await window.engine.logout()
    setLoginMode('login')
    $('authEmail').focus()
  })
  $('folderBtn').addEventListener('click', () => void window.engine.openFolder())

  $('newServerBtn').addEventListener('click', () => void openWizard())
  $('cancelWizard').addEventListener('click', closeWizard)
  $('wizCloseBtn').addEventListener('click', closeWizard)
  $('createBtn').addEventListener('click', () => void createServer())
  $('reloadVersions').addEventListener('click', () => void loadVersions())
  $('wizard').addEventListener('click', (event) => {
    if (event.target === $('wizard')) closeWizard()
  })

  $('assignBtn').addEventListener('click', () => void assignToThisPc())
  $('deleteBtn').addEventListener('click', () => void deleteServer())

  // 기존 서버 폴더 가져오기 — 버튼으로 고르거나, 창에 끌어다 놓습니다.
  $('importBtn').addEventListener('click', async () => {
    $('ctrlError').hidden = true
    try {
      const picked = await window.engine.pickFolder()
      if (!picked || !picked.ok || !picked.dir) return
      await importFrom(picked.dir)
    } catch (error) {
      importError(error?.message)
    }
  })

  let dragDepth = 0
  const hasFiles = (event) =>
    Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files')
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || !state.user) return
    event.preventDefault()
    dragDepth += 1
    $('dropzone').hidden = false
  })
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault()
  })
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) $('dropzone').hidden = true
  })
  window.addEventListener('drop', (event) => {
    event.preventDefault()
    dragDepth = 0
    $('dropzone').hidden = true
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
    if (!file || !state.user) return
    let dir = ''
    try {
      dir = window.engine.pathForFile(file)
    } catch {
      dir = ''
    }
    if (!dir) {
      importError('폴더 경로를 읽지 못했습니다 — “가져오기” 버튼으로 폴더를 골라 주세요.')
      return
    }
    void importFrom(dir)
  })

  $('tabbar').addEventListener('click', (event) => {
    const button = event.target.closest('.ptab')
    if (!button) return
    setTab(button.dataset.tab)
  })
  bindPanelEvents()

  // 앱 설정 창 — 자동 실행 · 이전 서버 다시 켜기
  $('settingsBtn').addEventListener('click', async () => {
    $('appSettingsError').hidden = true
    try {
      const prefs = await window.engine.getPrefs()
      $('prefAutostart').checked = Boolean(prefs.autostart)
      $('prefResume').checked = Boolean(prefs.resume)
      $('appSettings').hidden = false
    } catch (error) {
      $('appSettingsError').hidden = false
      $('appSettingsError').textContent = friendly(error?.message)
      $('appSettings').hidden = false
    }
  })
  $('appSettingsClose').addEventListener('click', () => {
    $('appSettings').hidden = true
  })
  $('appSettings').addEventListener('click', (event) => {
    if (event.target === $('appSettings')) $('appSettings').hidden = true
  })
  $('appSettingsSave').addEventListener('click', async () => {
    const error = $('appSettingsError')
    error.hidden = true
    try {
      await window.engine.setPrefs({
        autostart: $('prefAutostart').checked,
        resume: $('prefResume').checked,
      })
      $('appSettings').hidden = true
    } catch (err) {
      error.hidden = false
      error.textContent = friendly(err?.message)
    }
  })

  // 백업 · 업그레이드 진행 줄 — 메인 프로세스가 보내는 그대로를 패널에 띄웁니다.
  window.engine.onBackupProgress((payload) => {
    if (!payload) return
    panel.progress = { serverId: Number(payload.serverId), line: String(payload.line || '') }
    bump()
  })

  $('cmdForm').addEventListener('submit', (event) => {
    event.preventDefault()
    const line = $('cmdInput').value.trim()
    if (!line || !selected) return
    $('cmdInput').value = ''
    void control('command', { line })
  })

  for (const [id, type] of [
    ['btnStart', 'start'],
    ['btnStop', 'stop'],
    ['btnRestart', 'restart'],
  ]) {
    $(id).addEventListener('click', () => void control(type))
  }

  $('copyLogs').addEventListener('click', async () => {
    const text = $('logs').textContent || ''
    try {
      await navigator.clipboard.writeText(text)
      $('copyLogs').textContent = '복사됨'
      window.setTimeout(() => ($('copyLogs').textContent = '복사'), 1500)
    } catch {
      $('copyLogs').textContent = '실패'
      window.setTimeout(() => ($('copyLogs').textContent = '복사'), 1500)
    }
  })

  $('logwrap').addEventListener('scroll', () => {
    const box = $('logwrap')
    stick = box.scrollHeight - box.scrollTop - box.clientHeight < 48
  })

  // 어떤 소셜 로그인이 켜져 있는지 확인해, 안 켜진 쪽은 빈 버튼을 보여주지 않습니다.
  try {
    const status = await window.engine.loginStatus()
    const discordOn = Boolean(status && status.discord)
    const googleOn = Boolean(status && status.google)
    $('discordBtn').hidden = !discordOn
    $('googleBtn').hidden = !googleOn
    const anySocial = discordOn || googleOn
    $('socialDivider').hidden = !anySocial
    $('socialNote').hidden = anySocial
  } catch {
    /* 상태를 받지 못하면 버튼을 그대로 둡니다 */
  }
}

// --- 화면 ------------------------------------------------------------------

function render() {
  const signedIn = Boolean(state.user)

  // 로그인하지 않으면 대시보드도 마법사도 열리지 않습니다.
  $('login').hidden = signedIn
  $('dashboard').hidden = !signedIn
  if (!signedIn && wizardOpen) {
    wizardOpen = false
    $('wizard').hidden = true
  }
  $('wizard').hidden = !wizardOpen

  $('who').hidden = !signedIn
  $('logoutBtn').hidden = !signedIn
  $('folderBtn').hidden = !signedIn
  $('settingsBtn').hidden = !signedIn
  if (signedIn) {
    $('who').textContent = ''
    const b = document.createElement('b')
    b.textContent = state.user.displayName || state.user.email
    const span = document.createElement('span')
    span.textContent = state.user.email
    $('who').append(b, span)
    $('who').title = state.user.email
  }

  const dot = $('dot')
  dot.className = 'dot'
  if (state.connected) dot.classList.add('on')
  else if (state.message && !/대기|로그인|입력해/.test(state.message)) dot.classList.add('bad')
  $('statusText').textContent = state.connected ? '연결됨' : friendly(state.message)
  $('pill').title = friendly(state.message)

  const servers = state.servers || []
  $('serverCount').textContent = String(servers.length)
  $('newServerBtn').disabled = creating

  if (!selected || !servers.some((server) => server.id === selected)) {
    selected = servers.length ? servers[0].id : null
  }

  // 서버 목록
  const list = $('servers')
  list.textContent = ''
  if (servers.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = state.provisioning
      ? '서버를 만드는 중입니다…'
      : signedIn
        ? '아직 서버가 없습니다. 오른쪽 위의 “+ 새 서버”로 이 PC에 서버를 만들어 보세요.'
        : ''
    if (empty.textContent) list.appendChild(empty)
  }
  for (const server of servers) {
    const phase = phaseOf(server.id)
    const meta = STATE[phase] || { text: phase, cls: '' }
    const local = localFor(server.id)
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'server' + (server.id === selected ? ' active' : '')

    const dotEl = document.createElement('span')
    dotEl.className = `dot ${server.local ? meta.cls : ''}`

    const body = document.createElement('span')
    body.className = 'body'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = server.name
    const sub = document.createElement('span')
    sub.className = 'meta'
    const spec = [server.server_type, server.mc_version].filter(Boolean).join(' ')
    const players = local && local.players !== null ? ` · ${local.players}명` : ''
    sub.textContent = (spec || server.java_cmd || '설정 없음') + players
    body.append(name, sub)

    const tag = document.createElement('span')
    if (!server.local) {
      tag.className = 'tag away'
      tag.textContent = '다른 기기'
    } else {
      tag.className = `tag ${meta.cls}`
      tag.textContent = meta.text
    }

    row.append(dotEl, body, tag)
    row.addEventListener('click', () => {
      selected = server.id
      stick = true
      $('ctrlError').hidden = true
      render()
    })
    list.appendChild(row)
  }

  // 콘솔
  const server = serverFor(selected)
  const phase = server ? phaseOf(server.id) : null
  const meta = (phase && STATE[phase]) || { text: '', cls: '' }
  const isLocal = Boolean(server && server.local)

  $('acts').hidden = !isLocal
  $('assignAct').hidden = !server || isLocal
  $('awayBox').hidden = !server || isLocal
  $('deleteBtn').hidden = !server

  if (server) {
    const local = localFor(server.id)
    $('logTitle').textContent = server.name
    $('selDot').className = `dot lg ${server.local ? meta.cls : ''}`
    const players =
      local && local.players !== null ? `접속 ${local.players}${local.maxPlayers ? `/${local.maxPlayers}` : ''}명` : '접속 —'
    const where = isLocal ? (server.server_dir || '폴더 미지정') : '다른 기기에 등록됨'
    $('selMeta').textContent = `${server.local ? meta.text : '다른 기기'} · ${players} · ${where}`
    // 자원 모니터링 — 값을 못 읽은 항목은 조용히 뺍니다.
    const stats = []
    if (local && local.cpu !== null && local.cpu !== undefined) stats.push('CPU ' + local.cpu + '%')
    if (local && local.memMb) stats.push('RAM ' + local.memMb + 'MB')
    if (local && local.tps !== null && local.tps !== undefined) stats.push('TPS ' + local.tps)
    if (stats.length) $('selMeta').textContent += ' · ' + stats.join(' · ')
  } else {
    $('logTitle').textContent = '서버를 선택하세요'
    $('selDot').className = 'dot lg'
    $('selMeta').textContent = '왼쪽에서 서버를 고르면 로그가 나타납니다.'
  }

  const local = server ? localFor(server.id) : null
  const text =
    local && local.lines.length
      ? local.lines.join('\n')
      : server
        ? server.local
          ? '아직 로그가 없습니다. 위의 시작 버튼이나 웹 콘솔에서 실행하면 여기에 쌓입니다.'
          : '이 기기에 연결된 서버가 아닙니다. “이 PC에서 관리”를 누르면 이 기기에서 실행할 수 있습니다.'
        : '연결되면 여기에 로그가 표시됩니다.'
  const placeholder = !(local && local.lines.length)
  if (text !== lastLogText) {
    const pre = $('logs')
    pre.textContent = text
    pre.classList.toggle('empty', placeholder)
    lastLogText = text
    if (stick) $('logwrap').scrollTop = $('logwrap').scrollHeight
  }

  $('copyLogs').disabled = placeholder
  paintButtons()
  syncPanels()
}

void init()
