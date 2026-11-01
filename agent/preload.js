const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('engine', {
  // 화면/계정
  getConfig: () => ipcRenderer.invoke('config:get'),
  // 설치된 버전 — 헤더에 v0.1.x 로 표시됩니다.
  appVersion: () => ipcRenderer.invoke('app:version'),
  // 확인 창(삭제·종료)의 답. 창이 직접 그리는 단순 버튼이라 값만 돌려줍니다.
  dialogAnswer: (value) => ipcRenderer.invoke('dialog:answer', Boolean(value)),
  // 앱이 물어볼 창 — 플러그인·모드를 설치한 뒤 재시작할지 묻는 데 씁니다.
  // 닫기 · Esc 는 false 로 받습니다.
  confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (callback) => {
    ipcRenderer.on('agent:state', (_event, state) => callback(state))
  },
  onProgress: (callback) => {
    ipcRenderer.on('agent:progress', (_event, line) => callback(line))
  },

  // 로그인
  login: (payload) => ipcRenderer.invoke('auth:submit', { ...payload, mode: 'login' }),
  register: (payload) => ipcRenderer.invoke('auth:submit', { ...payload, mode: 'register' }),
  discordLogin: () => ipcRenderer.invoke('auth:discord'),
  googleLogin: () => ipcRenderer.invoke('auth:google'),
  loginStatus: () => ipcRenderer.invoke('auth:status'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // 서버 관리
  run: (payload) => ipcRenderer.invoke('control:run', payload),
  assign: (id) => ipcRenderer.invoke('server:assign', { id }),
  deleteServer: (id) => ipcRenderer.invoke('server:delete', { id }),

  // 탭용 조회 — 콘솔 바깥의 파일·플러그인·플레이어·월드 지도·접속
  searchModrinth: (query) => ipcRenderer.invoke('modrinth:search', query),
  modrinthVersions: (slug) => ipcRenderer.invoke('modrinth:versions', slug),
  getWorldMap: (serverId) => ipcRenderer.invoke('worldmap:get', serverId),
  getAccess: (serverId) => ipcRenderer.invoke('access:get', serverId),
  makeDomain: (serverId, name) => ipcRenderer.invoke('domain:make', { id: serverId, name }),
  deleteDomain: (serverId) => ipcRenderer.invoke('domain:delete', { id: serverId }),

  // 관리자 — 이메일로 사람을 등록해 서버를 함께 관리하게 합니다.
  listAdmins: (serverId) => ipcRenderer.invoke('admins:list', serverId),
  addAdmin: (serverId, email) => ipcRenderer.invoke('admins:add', { id: serverId, email }),
  removeAdmin: (serverId, email) => ipcRenderer.invoke('admins:remove', { id: serverId, email }),

  // 백업 · 복원 — 이 PC의 서버 폴더를 zip 으로 남기고 되돌립니다.
  backupList: (serverId) => ipcRenderer.invoke('backup:list', serverId),
  backupCreate: (serverId) => ipcRenderer.invoke('backup:create', serverId),
  backupRestore: (serverId, file) => ipcRenderer.invoke('backup:restore', { serverId, file }),
  backupDelete: (serverId, file) => ipcRenderer.invoke('backup:delete', { serverId, file }),
  openBackups: () => ipcRenderer.invoke('backup:open'),

  // 클라우드 백업 — 계정 저장소에 올리고 내려받습니다.
  cloudBackupList: (serverId) => ipcRenderer.invoke('cloudbackups:list', serverId),
  cloudBackupUpload: (serverId) => ipcRenderer.invoke('cloudbackups:upload', serverId),
  cloudBackupDownload: (serverId, id, name) =>
    ipcRenderer.invoke('cloudbackups:download', { serverId, id, name }),
  cloudBackupDelete: (serverId, id) => ipcRenderer.invoke('cloudbackups:delete', { serverId, id }),
  onBackupProgress: (callback) => {
    ipcRenderer.on('backup:progress', (_event, payload) => callback(payload))
  },

  // 설정 — 자동 실행 · 서버 복원 · 웹훅 · 스케줄 · 버전 업그레이드
  getPrefs: () => ipcRenderer.invoke('prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
  getServerPrefs: (serverId) => ipcRenderer.invoke('serverprefs:get', serverId),
  setServerPrefs: (serverId, patch) => ipcRenderer.invoke('serverprefs:set', { id: serverId, patch }),
  testWebhook: (serverId) => ipcRenderer.invoke('webhook:test', serverId),
  upgradeServer: (serverId, version) => ipcRenderer.invoke('server:upgrade', { id: serverId, version }),

  // 기존 서버 가져오기 — 폴더를 드래그하거나 골라서 등록합니다 (파일은 옮기지 않습니다).
  importServer: (dir) => ipcRenderer.invoke('server:import', { dir }),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pathForFile: (file) => webUtils.getPathForFile(file),

  // 서버 만들기 (PC 전용)
  types: () => ipcRenderer.invoke('types:get'),
  versions: (type) => ipcRenderer.invoke('versions:get', type),
  createServer: (payload) => ipcRenderer.invoke('server:create', payload),
  openFolder: () => ipcRenderer.invoke('folder:open'),
})
