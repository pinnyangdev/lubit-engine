// 자바 자동 설치
//
// 서버를 만들거나 켤 때 필요한 자바 버전이 없으면(또는 너무 낮으면) Adoptium 공식
// 배포처(Temurin)에서 받아 앱 전용 폴더에 풀어 둡니다.
//
//   관리자 권한 없음 — 설치 마법사 대신 압축만 풉니다.
//   어디에 있든 JAVA_HOME 과 PATH 를 바꿔서 넘겨주므로, java 로 쓰는 실행 명령과
//   포지가 만든 run.bat 까지 그 자바로 돌아갑니다.
//
//   자바가 필요한 이유: 마인크래프트 서버는 자바로 만들어졌습니다.
//   버전도 까다롭습니다 — 26.1 이상(연도 표기)은 자바 25, 1.20.5~1.21 은 21,
//   1.17~1.20.4 는 17, 그 아래는 8.

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const UA = { 'User-Agent': 'lubit-server-engine/1.0 (https://lubit.kr)' }

// 같은 버전을 동시에 두 번 내려받지 않도록 막습니다.
const installing = new Map()

// --- 필요한 버전 -------------------------------------------------------------

// 마인크래프트 버전(과 서버 종류)에 맞는 자바 메이저 버전을 돌려줍니다.
function requiredJava(mc, type) {
  if (type === 'velocity') return 17 // 최신 벨로시티는 17 이상에서만 돕니다.

  const raw = String(mc || '').trim()

  // 2026 년부터 버전 표기는 연도 기준(26.1, 26.3 …)으로 바뀌었습니다. 이 스냅샷도
  // 연도로 적으므로(26w01a) 먼저 걸러 줍니다. 26.1 이상은 자바 25 이상이 필수입니다.
  const snapshot = /^(\d{2})w/i.exec(raw)
  if (snapshot) return Number(snapshot[1]) >= 25 ? 25 : 21

  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw)
  // 알 수 없는 버전은 최신 기준으로 봅니다.
  if (!match) return 21

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3] || 0)
  // 1.x 표기가 아니라면 연도 버전(26.1 등) — 자바 25 이상을 요구합니다.
  if (major >= 2) return 25
  if (minor > 20) return 21 // 1.21 이상
  if (minor === 20) return patch >= 5 ? 21 : 17 // 1.20.5 부터 자바 21 필수
  if (minor >= 17) return 17 // 1.17 ~ 1.20.4
  return 8 // 1.16 이하
}

// "openjdk version "21.0.1" 2024-10-15" / "java version "1.8.0_402"" → 21 / 8
function parseMajor(text) {
  const match = /version\s+"(\d+)(?:\.(\d+))?/.exec(String(text || ''))
  if (!match) return null
  if (match[1] === '1') return Number(match[2] || 0) // 옛 형식 1.8.0_x
  return Number(match[1])
}

function firstLine(text) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean)
  return line || ''
}

function runVersion(bin) {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(bin, ['-version'], { windowsHide: true })
    child.stdout.on('data', (chunk) => (out += String(chunk)))
    child.stderr.on('data', (chunk) => (out += String(chunk)))
    child.on('error', () => resolve(null))
    child.on('exit', () => resolve(out))
  })
}

// PATH 에 있는 자바를 확인합니다.
async function detect() {
  const out = await runVersion('java')
  const major = out ? parseMajor(out) : null
  if (!major) return null
  return { bin: 'java', major, label: firstLine(out) }
}

// --- 앱 전용 폴더 -----------------------------------------------------------

function baseDir() {
  // 검증용으로 다른 폴더에 풀어보게 환경 변수로 바꿀 수 있습니다.
  if (process.env.LUBIT_JAVA_DIR) return process.env.LUBIT_JAVA_DIR
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, 'LubitServerEngine', 'java')
  }
  return path.join(os.homedir(), '.local', 'share', 'lubit', 'java')
}

function managedHome(major) {
  return path.join(baseDir(), `jre-${major}`)
}

function javaBinary(home) {
  if (!home || !fs.existsSync(home)) return null
  const name = process.platform === 'win32' ? 'java.exe' : 'java'
  const direct = path.join(home, 'bin', name)
  if (fs.existsSync(direct)) return direct

  // 압축을 풀면 최상단에 jre-21.0.13+9 같은 폴더가 하나 생깁니다.
  const nested = fs.readdirSync(home, { withFileTypes: true }).find((entry) => entry.isDirectory())
  if (!nested) return null
  const found = path.join(home, nested.name, 'bin', name)
  return fs.existsSync(found) ? found : null
}

// --- 내려받기 ---------------------------------------------------------------

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (chunk) => (err += String(chunk)))
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 실패: ${firstLine(err) || code}`)),
    )
  })
}

function extract(zip, dest) {
  if (process.platform === 'win32') {
    // Windows 에는 압축 풀기 명령이 따로 필요 없습니다.
    return run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -Path "${zip}" -DestinationPath "${dest}"`,
    ])
  }
  return run('unzip', ['-oq', zip, '-d', dest]).catch(() => run('tar', ['-xf', zip, '-C', dest]))
}

async function fetchFile(url, dest, onPercent) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok || !res.body) throw new Error(`자바 내려받기에 실패했습니다. (${res.status})`)

  const total = Number(res.headers.get('content-length') || 0)
  const file = fs.createWriteStream(dest)
  let received = 0
  let last = -1

  for await (const chunk of Readable.fromWeb(res.body)) {
    received += chunk.length
    if (!file.write(chunk)) await once(file, 'drain')
    if (total > 0) {
      const percent = Math.floor((received / total) * 100)
      if (percent !== last) {
        last = percent
        onPercent(percent, received, total)
      }
    }
  }
  await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())))
  if (received === 0) throw new Error('내려받은 자바 파일이 비어 있습니다.')
}

function mb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`
}

function downloadUrl(major) {
  const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux'
  const arch = process.arch === 'arm64' || process.arch === 'aarch64' ? 'aarch64' : 'x64'
  return `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse`
}

// 필요한 버전을 받아 앱 전용 폴더에 풉니다. 이미 있으면 그대로 씁니다.
async function install(major, onProgress = () => {}) {
  const home = managedHome(major)
  if (javaBinary(home)) return home

  const existing = installing.get(major)
  if (existing) return existing

  const work = (async () => {
    fs.mkdirSync(baseDir(), { recursive: true })
    const zip = path.join(baseDir(), `jre-${major}.zip`)
    const stage = path.join(baseDir(), `.stage-${major}`)

    onProgress(`자바 ${major} 내려받는 중`)
    await fetchFile(downloadUrl(major), zip, (percent, received, total) => {
      onProgress(`자바 ${major} 내려받는 중 ${percent}% (${mb(received)} / ${mb(total)})`)
    })

    onProgress(`자바 ${major} 푸는 중`)
    fs.rmSync(stage, { recursive: true, force: true })
    fs.mkdirSync(stage, { recursive: true })
    try {
      await extract(zip, stage)
      const bin = javaBinary(stage)
      if (!bin) throw new Error('압축 안에서 자바를 찾지 못했습니다.')
      const check = await runVersion(bin)
      if (!parseMajor(check)) throw new Error('방금 받은 자바가 실행되지 않습니다.')

      // 압축은 보통 최상단에 jre-21.0.13+9 폴더를 하나 씁니다. JAVA_HOME 이 바로
      // bin 을 가리키도록, 그 안쪽 폴더 자체를 목적지로 옮깁니다.
      const realHome = path.dirname(path.dirname(bin))
      fs.rmSync(home, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(home), { recursive: true })
      fs.renameSync(realHome, home)
    } finally {
      fs.rmSync(zip, { force: true })
      fs.rmSync(stage, { recursive: true, force: true })
    }
    return home
  })()

  installing.set(major, work)
  try {
    return await work
  } finally {
    installing.delete(major)
  }
}

// --- 필요한 자바 확보 --------------------------------------------------------

// 쓸 수 있는 자바를 확보하고, 그 자바로 실행할 수 있게 바꿔줄 환경을 돌려줍니다.
//   { home, bin, major, env, label }
async function ensureJava({ major, onProgress = () => {} } = {}) {
  const need = Number(major) || 21

  const system = await detect()
  if (system && system.major >= need) {
    return { home: null, bin: 'java', major: system.major, env: {}, label: system.label }
  }

  onProgress(
    system
      ? `자바 ${system.major} 로는 부족합니다 — 자바 ${need} 설치`
      : `자바가 없습니다 — 자바 ${need} 설치`,
  )

  const home = await install(need, onProgress)
  const bin = javaBinary(home)
  if (!bin) throw new Error(`자바 ${need} 설치에 실패했습니다.`)

  const binDir = path.dirname(bin)
  const label = firstLine(await runVersion(bin)) || `java ${need}`
  onProgress(`자바 준비 완료 — ${label}`)

  return {
    home,
    bin,
    major: need,
    env: {
      JAVA_HOME: home,
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
    },
    label,
  }
}

// 서버 실행 명령에 넘길 환경을 만듭니다. java 로 시작하지 않는 명령은 건드리지 않습니다.
async function envFor({ javaCmd, mcVersion, type, onProgress } = {}) {
  const command = String(javaCmd || '').trim()
  if (!/^javaw?\s/i.test(command)) return {} // java 로 시작하지 않으면 손대지 않습니다

  const need = requiredJava(mcVersion, type)
  const info = await ensureJava({ major: need, onProgress })
  return info.env
}

module.exports = {
  requiredJava,
  parseMajor,
  detect,
  ensureJava,
  install,
  envFor,
  managedHome,
  javaBinary,
}
