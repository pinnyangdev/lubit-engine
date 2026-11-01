// 앱 설정과 서버별 설정(디스코드 웹훅·자동 시작/종료 스케줄)을 저장합니다.
//
// 파일 하나에 평문으로 둡니다 — 값에는 주소와 시각만 들어 있고 비밀번호는 없습니다.
// config.json 과 같은 폴더(userData)에 prefs.json 으로 함께 놓입니다.

const fs = require('node:fs')
const path = require('node:path')

function defaults() {
  return {
    // 로그인 정보를 얻으면 Windows 시작 목록에 등록합니다 (설치판에서만).
    autostart: false,
    // 앱을 켜면 마지막에 돌던 서버를 다시 시작합니다.
    resume: true,
    // 종료 순간 실행 중이던 서버 id — 다음 실행 때 resume 에 씁니다.
    lastRunning: [],
    servers: {}, // serverId -> { webhook, webhookEvents, schedule }
  }
}

function serverDefaults() {
  return {
    webhook: '',
    webhookEvents: { start: true, stop: true, crash: true, backup: true },
    schedule: {
      enabled: false,
      startAt: '', // 'HH:MM' — 비면 실행 시각 없음
      stopAt: '', // 'HH:MM'
      days: [0, 1, 2, 3, 4, 5, 6], // 0=일요일
      fired: '', // 'YYYY-MM-DD:start|stop' — 같은 날 두 번 실행하지 않도록
    },
  }
}

function load(file) {
  let stored = {}
  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    stored = {}
  }
  const base = defaults()
  return {
    ...base,
    ...stored,
    lastRunning: Array.isArray(stored.lastRunning) ? stored.lastRunning : [],
    servers: stored.servers && typeof stored.servers === 'object' ? stored.servers : {},
  }
}

function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

// 서버 id 별 설정 — 아직 만든 적 없는 서버면 기본값을 그대로 돌려줍니다.
function forServer(data, serverId) {
  const stored = (data.servers && data.servers[String(serverId)]) || {}
  const base = serverDefaults()
  return {
    ...base,
    ...stored,
    webhookEvents: { ...base.webhookEvents, ...(stored.webhookEvents || {}) },
    schedule: { ...base.schedule, ...(stored.schedule || {}) },
  }
}

module.exports = { load, save, defaults, serverDefaults, forServer }
