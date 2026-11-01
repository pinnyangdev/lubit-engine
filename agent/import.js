// 기존에 만들던 마인크래프트 서버 폴더를 그대로 등록하기 위한 판별 모듈입니다.
// (데스크톱 앱의 드래그앤드롭 · "가져오기" 가 부릅니다)
//
// 원칙: 폴더를 옮기지 않습니다. 원래 자리에서 실행할 수 있게
//   1. 시작 스크립트(run.bat 등)가 있으면 그걸 씁니다 — 사용자 설정(메모리 등)이 살아 있습니다.
//   2. 없으면 서버 jar 를 찾아 실행 명령을 만듭니다.
//   3. 서버로 보이지 않는 폴더는 등록하지 않습니다.

const fs = require('node:fs')
const path = require('node:path')

// 표준 시작 스크립트 이름 — 플랫폼에 맞는 쪽을 먼저 고릅니다.
const SCRIPTS = {
  win: ['run.bat', 'start.bat', 'launch.bat', 'server.bat'],
  posix: ['run.sh', 'start.sh', 'launch.sh', 'server.sh'],
}

// jar 이름으로 서버 종류를 판별합니다. 적힌 순서가 우선순위입니다.
const JAR_TYPES = [
  [/velocity/i, 'velocity'],
  [/paper/i, 'paper'],
  [/purpur/i, 'purpur'],
  [/fabric/i, 'fabric'],
  [/forge/i, 'forge'],
  [/neoforge/i, 'neoforge'],
  [/spigot|craftbukkit/i, 'spigot'],
  [/minecraft_server|vanilla/i, 'vanilla'],
]

function readProperties(file) {
  const out = {}
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index <= 0 || line.startsWith('#')) continue
      out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
    }
  } catch {
    /* 없으면 빈 설정 */
  }
  return out
}

// "-Xmx3G" / "-Xmx3072M" / user_jvm_args.txt — 있으면 그 값을, 없으면 2048 을 씁니다.
function memoryOf(text) {
  const match = String(text || '').match(/-Xmx(\d+)([MG])/i)
  if (!match) return null
  const value = Number(match[1])
  return match[2].toUpperCase() === 'G' ? value * 1024 : value
}

function pickJar(entries) {
  const jars = entries.filter((name) => name.toLowerCase().endsWith('.jar'))
  if (jars.length === 0) return null
  for (const [pattern] of JAR_TYPES) {
    const hit = jars.find((name) => pattern.test(name))
    if (hit) return hit
  }
  // 판별이 안 되면 제일 큰 jar 를 씁니다 — 서버 폴더 루트에는 보통 서버 jar 만 있습니다.
  return jars
    .map((name) => ({ name, size: statSize(name) }))
    .sort((a, b) => b.size - a.size)[0]?.name || jars[0]
}

let currentDir = ''
function statSize(name) {
  try {
    return fs.statSync(path.join(currentDir, name)).size
  } catch {
    return 0
  }
}

function typeOf(jar, scriptText) {
  if (/forge/i.test(scriptText || '')) return 'forge'
  if (jar) {
    for (const [pattern, type] of JAR_TYPES) {
      if (pattern.test(jar)) return type
    }
  }
  return ''
}

// 서버 폴더인지 판별하고 실행 계획을 돌려줍니다. 문제가 있으면 이유와 함께 throw 합니다.
function detect(dir) {
  const resolved = path.resolve(dir)
  let stat = null
  try {
    stat = fs.statSync(resolved)
  } catch {
    throw new Error('폴더를 찾을 수 없습니다.')
  }
  if (!stat.isDirectory()) throw new Error('폴더가 아닙니다 — 서버 폴더 자체를 가져와 주세요.')

  currentDir = resolved
  let entries = []
  try {
    entries = fs.readdirSync(resolved)
  } catch {
    throw new Error('폴더를 읽을 수 없습니다.')
  }

  const hasProps = entries.includes('server.properties')
  const hasEula = entries.includes('eula.txt')
  // 플랫폼에 맞는 스크립트를 먼저 고릅니다 — 둘 다 있으면 그쪽이 이 PC에서 돌습니다.
  const scriptOrder =
    process.platform === 'win32'
      ? [...SCRIPTS.win, ...SCRIPTS.posix]
      : [...SCRIPTS.posix, ...SCRIPTS.win]
  const script = scriptOrder.find((name) => entries.includes(name))
  const jar = pickJar(entries)

  if (!hasProps && !hasEula && !script && !jar) {
    throw new Error('마인크래프트 서버 폴더로 보이지 않습니다 — server.properties, eula.txt, 시작 스크립트나 서버 jar 가 없습니다.')
  }

  const warnings = []
  let javaCmd = ''
  let memoryMb = 2048
  let scriptText = ''

  if (script) {
    try {
      scriptText = fs.readFileSync(path.join(resolved, script), 'utf8')
    } catch {
      scriptText = ''
    }
    memoryMb = memoryOf(scriptText) || readJvmArgs(resolved) || 2048
    const isWinScript = /\.(bat|cmd)$/i.test(script)
    javaCmd = isWinScript ? `cmd /c ${script}` : `sh ${script}`
    if (isWinScript && process.platform !== 'win32') {
      warnings.push(`시작 스크립트(${script})는 윈도우용입니다 — 이 PC에서는 실행에 실패할 수 있습니다.`)
    }
  } else if (jar) {
    memoryMb = readJvmArgs(resolved) || 2048
    const safe = /\s/.test(jar) ? `"${jar}"` : jar
    javaCmd = `java -Xmx${memoryMb}M -Xms${memoryMb}M -jar ${safe} nogui`
  } else {
    throw new Error('시작 스크립트도 서버 jar 도 없습니다 — 서버 파일이 있는 폴더를 가져와 주세요.')
  }

  const type = typeOf(jar, scriptText)

  // 마인크래프트 버전 — jar 이름에서 뽑습니다 (velocity 는 자체 버전이라 제외).
  let version = ''
  if (type !== 'velocity' && jar) {
    const match = jar.match(/(\d+\.\d+(?:\.\d+)?)/)
    if (match) version = match[1]
  }

  // 포트 — server.properties 를 따르고, velocity 는 velocity.toml 을 봅니다.
  let port = 25565
  if (type === 'velocity' && entries.includes('velocity.toml')) {
    try {
      const toml = fs.readFileSync(path.join(resolved, 'velocity.toml'), 'utf8')
      const bind = toml.match(/^\s*bind\s*=\s*"[^"]*:(\d{2,5})"/m)
      if (bind) port = Number(bind[1])
    } catch {
      /* 읽지 못하면 기본값 */
    }
  } else if (hasProps) {
    const props = readProperties(path.join(resolved, 'server.properties'))
    const value = Number(props['server-port'])
    if (Number.isFinite(value) && value > 0 && value < 65536) port = value
  }

  if (!hasEula) {
    warnings.push('eula.txt 가 없습니다 — 서버가 처음 실행을 거절할 수 있습니다. (파일을 만들어 eula=true 로 적어 주세요)')
  }
  if (!version && type !== 'velocity') {
    warnings.push('jar 이름에서 마인크래프트 버전을 읽지 못했습니다 — 버전 업그레이드는 확인 후 쓰세요.')
  }

  return {
    dir: resolved,
    name: path.basename(resolved) || '가져온 서버',
    javaCmd,
    type,
    version,
    port,
    memoryMb,
    warnings,
  }
}

// forge 계열은 user_jvm_args.txt 에 메모리를 적어 둡니다.
function readJvmArgs(dir) {
  try {
    return memoryOf(fs.readFileSync(path.join(dir, 'user_jvm_args.txt'), 'utf8'))
  } catch {
    return null
  }
}

module.exports = { detect }
