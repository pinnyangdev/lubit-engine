// 서버 만들기 담당 — 데스크톱 앱의 "새 서버" 마법사가 부릅니다.
//
// 담당하는 일:
//   1. C:\LubitServers 아래에 서버 폴더를 만든다
//   2. 종류(페이퍼·퓨르퍼·바닐라·페브릭·포지·벨로시티)에 맞는 공식 배포처에서
//      서버 파일을 내려받는다
//   3. eula.txt 와 server.properties 를 쓰고 실행 명령을 만든다
//
// 각 배포처의 공식 API:
//   paper / velocity : api.papermc.io/v2
//   purpur           : api.purpurmc.org/v2
//   vanilla          : piston-meta.mojang.com (모장 공식)
//   fabric           : meta.fabricmc.net/v2
//   forge            : maven.minecraftforge.net (설치 프로그램 실행)

const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const java = require('./java')

const SERVER_TYPES = [
  { key: 'paper', name: 'Paper', kind: 'papermc', note: '가장 많이 쓰는 안정적 버킷' },
  { key: 'purpur', name: 'Purpur', kind: 'purpur', note: 'Paper 기반, 설정 확장' },
  { key: 'vanilla', name: 'Vanilla', kind: 'vanilla', note: '모장 공식 서버' },
  { key: 'fabric', name: 'Fabric', kind: 'fabric', note: '경량 모드 서버' },
  { key: 'forge', name: 'Forge', kind: 'forge', note: '대형 모드 서버 (설치에 시간이 걸립니다)' },
  { key: 'velocity', name: 'Velocity', kind: 'papermc', note: '여러 서버를 묶는 프록시' },
]

const UA = { 'User-Agent': 'lubit-server-engine/1.0 (https://lubit.kr)' }

// 기본 서버 루트. 설치하면 이 폴더가 만들어지고 서버는 전부 그 안에 생깁니다.
function defaultRoot() {
  // 맥·리눅스에는 SystemDrive 가 없으므로 홈 폴더 밑을 씁니다.
  if (process.platform !== 'win32') return path.join(os.homedir(), 'LubitServers')
  const drive = process.env.SystemDrive || 'C:'
  return path.join(drive.replace(/\\$/, ''), 'LubitServers')
}

function ensureRoot(root) {
  fs.mkdirSync(root, { recursive: true })
  return root
}

async function getJson(url) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok) throw new Error(`배포처에 연결하지 못했습니다. (${res.status})`)
  return res.json()
}

// --- 버전 목록 -------------------------------------------------------------
// 워저드가 버전 선택 상자를 띄울 때 부릅니다. 최신이 맨 앞에 옵니다.

async function listVersions(type) {
  const spec = SERVER_TYPES.find((item) => item.key === type)
  if (!spec) throw new Error('지원하지 않는 서버 종류입니다.')

  if (spec.kind === 'papermc') {
    // PaperMC 는 옛 v2 API 를 내렸고, 현재는 fill v3 가 정본입니다.
    const data = await getJson(`https://fill.papermc.io/v3/projects/${spec.key}`)
    const flat = Object.values(data.versions ?? {}).flat()
    // RC·프리·스냅샷은 목록에서 제외하되, 남는 게 하나도 없으면 전부 씁니다.
    const stable = flat.filter((item) => !/-(rc|pre|snapshot)/i.test(item))
    return stable.length ? stable : flat
  }
  if (spec.kind === 'purpur') {
    const data = await getJson('https://api.purpurmc.org/v2/purpur')
    return [...(data.versions ?? [])].reverse()
  }
  if (spec.kind === 'vanilla') {
    const data = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    return (data.versions ?? []).filter((item) => item.type === 'release').map((item) => item.id)
  }
  if (spec.kind === 'fabric') {
    const data = await getJson('https://meta.fabricmc.net/v2/versions/game')
    return data.map((item) => item.version)
  }
  if (spec.kind === 'forge') {
    const xml = await (await fetch('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml', { headers: UA })).text()
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1])
    if (versions.length === 0) throw new Error('포지 버전 목록을 받지 못했습니다.')
    // maven 은 옛 것이 먼저 오므로 뒤집어 최신을 위에 둡니다.
    return versions.reverse()
  }
  throw new Error('지원하지 않는 서버 종류입니다.')
}

// --- 내려받기 --------------------------------------------------------------

// 서버 파일은 실행 파일이므로 받아 놓고 해시가 맞는지 한 번 더 확인합니다.
async function download(url, dest, onPercent, expectedSha256) {
  const res = await fetch(url, { headers: UA })
  if (!res.ok || !res.body) throw new Error(`파일을 내려받지 못했습니다. (${res.status})`)

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

  if (received === 0) throw new Error('받은 파일이 비어 있습니다.')
  if (total > 0 && received !== total) throw new Error('파일이 완전히 내려받아지지 않았습니다.')

  if (expectedSha256) {
    const { createHash } = require('node:crypto')
    const hash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
    if (hash !== expectedSha256) {
      fs.rmSync(dest, { force: true })
      throw new Error('내려받은 파일의 무결성 검사에 실패했습니다. 다시 시도해 주세요.')
    }
  }
}

function runAndWait(cmd, args, cwd, onLine, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, ...(env || {}) } })
    let tail = ''
    const capture = (chunk) => {
      const text = String(chunk)
      tail = (tail + text).slice(-4000)
      onLine(text)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.on('error', (error) => reject(error))
    child.on('exit', (code) => {
      if (code === 0) resolve(tail)
      else reject(new Error(`설치가 끝나지 않았습니다. (종료 코드 ${code})`))
    })
  })
}

// 폴더 이름으로 쓸 수 없는 문자를 정리합니다.
function safeFolderName(name) {
  const cleaned = String(name)
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 50)
  if (!cleaned) throw new Error('서버 이름을 확인해 주세요.')
  return cleaned
}

// --- 종류별 내려받기 주소 ---------------------------------------------------

async function resolveDownload(spec, version) {
  if (spec.kind === 'papermc') {
    const data = await getJson(`https://fill.papermc.io/v3/projects/${spec.key}`)
    const flat = Object.values(data.versions ?? {}).flat()
    const mc = version && version !== 'latest' ? version : flat[0]
    const builds = await getJson(
      `https://fill.papermc.io/v3/projects/${spec.key}/versions/${encodeURIComponent(mc)}/builds`,
    )
    if (!Array.isArray(builds)) throw new Error(`내려받을 빌드를 받지 못했습니다. (${mc})`)
    const build =
      builds.find((item) => item.channel === 'STABLE' && item.downloads?.['server:default']) ??
      builds.find((item) => item.downloads?.['server:default'])
    const download = build?.downloads?.['server:default']
    if (!download?.url) throw new Error(`${mc} 버전의 내려받을 빌드가 없습니다.`)
    return { mc, filename: download.name, url: download.url, sha256: download.checksums?.sha256 }
  }

  if (spec.kind === 'purpur') {
    const versions = (await getJson('https://api.purpurmc.org/v2/purpur')).versions ?? []
    const mc = version && version !== 'latest' ? version : versions[versions.length - 1]
    const data = await getJson(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}`)
    const build = data.builds?.latest
    if (!build) throw new Error(`${mc} 버전의 빌드를 찾지 못했습니다.`)
    return {
      mc,
      filename: `purpur-${mc}-${build}.jar`,
      url: `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mc)}/${build}/download`,
    }
  }

  if (spec.kind === 'vanilla') {
    const manifest = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    const entry = version && version !== 'latest'
      ? manifest.versions.find((item) => item.id === version)
      : manifest.versions.find((item) => item.id === manifest.latest?.release)
    if (!entry) throw new Error('선택한 마인크래프트 버전이 없습니다.')
    const meta = await (await fetch(entry.url, { headers: UA })).json()
    const server = meta.downloads?.server
    if (!server?.url) throw new Error('서버 파일 주소를 받지 못했습니다.')
    return { mc: entry.id, filename: `minecraft_server.${entry.id}.jar`, url: server.url }
  }

  if (spec.kind === 'fabric') {
    const gameVersions = await getJson('https://meta.fabricmc.net/v2/versions/game')
    const mc = version && version !== 'latest'
      ? version
      : gameVersions.find((item) => item.stable)?.version ?? gameVersions[0]?.version
    const pick = async (kind) => {
      const list = await getJson(`https://meta.fabricmc.net/v2/versions/${kind}`)
      return list.find((item) => item.stable)?.version ?? list[0].version
    }
    const loader = await pick('loader')
    const installer = await pick('installer')
    return {
      mc,
      filename: 'fabric-server-launch.jar',
      url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/${encodeURIComponent(installer)}/server/jar`,
      note: `Fabric loader ${loader}`,
    }
  }

  if (spec.kind === 'forge') {
    const full = version && version !== 'latest' ? version : (await listVersions('forge'))[0]
    const dash = full.lastIndexOf('-')
    if (dash <= 0) throw new Error('포지 버전 형식이 이상합니다.')
    const mc = full.slice(0, dash)
    const forge = full.slice(dash + 1)
    const base = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}`
    return {
      mc,
      forge,
      full,
      filename: `forge-${full}-installer.jar`,
      url: `${base}/forge-${full}-installer.jar`,
    }
  }

  throw new Error('지원하지 않는 서버 종류입니다.')
}

// --- 만들기 ----------------------------------------------------------------

async function createServer(options) {
  const { root, name, type, version, memoryMb, port, eula, properties, onProgress = () => {} } = options

  const spec = SERVER_TYPES.find((item) => item.key === type)
  if (!spec) throw new Error('지원하지 않는 서버 종류입니다.')
  if (!eula) throw new Error('Minecraft EULA 에 동의해야 서버를 만들 수 있습니다.')

  const memory = Math.min(Math.max(Number(memoryMb) || 2048, 512), 64 * 1024)
  const serverPort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : 25565

  ensureRoot(root)
  const folder = safeFolderName(name)
  const dir = path.join(root, folder)
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`폴더가 이미 있습니다: ${dir}`)
  }
  fs.mkdirSync(dir, { recursive: true })
  onProgress('dir', dir)

  onProgress('resolve', `${spec.name} 버전 확인`)
  const plan = await resolveDownload(spec, version)

  // 자바가 없거나(또는 너무 낮아서) 이 버전에 안 맞으면 여기서 받아 둡니다.
  // 관리자 권한 없이 압축만 풀기 때문에 설치 마법사가 뜨지 않습니다.
  const javaInfo = await java.ensureJava({
    major: java.requiredJava(plan.mc, spec.key),
    onProgress: (line) => onProgress('java', line),
  })
  onProgress('java', javaInfo.label)

  const jarPath = path.join(dir, plan.filename)
  onProgress('download', `${plan.filename} 내려받는 중`)
  await download(plan.url, jarPath, (percent, received, total) =>
    onProgress('download', `${plan.filename} ${percent}% (${mb(received)} / ${mb(total)})`),
    plan.sha256,
  )

  // 모장·페이퍼 계열은 EULA 동의 파일이 없으면 시작하지 않습니다.
  fs.writeFileSync(path.join(dir, 'eula.txt'), `eula=true\n`)
  const header = '# 루빗 서버 구동기가 만든 설정입니다. 직접 수정해도 됩니다.'
  const entries = normalizeProperties(properties) ?? [
    ['online-mode', 'true'],
    ['motd', 'Lubit Server'],
    ['level-name', 'world'],
  ]
  const propertyLines = [header, `server-port=${serverPort}`, ...entries.map(([key, value]) => `${key}=${value}`)]
  if (!fs.existsSync(path.join(dir, 'server.properties'))) {
    fs.writeFileSync(path.join(dir, 'server.properties'), `${propertyLines.join('\n')}\n`)
  }

  let javaCmd = `java -Xmx${memory}M -Xms${memory}M -jar ${plan.filename} nogui`

  if (spec.kind === 'forge') {
    onProgress('install', '포지 설치 — 수 분이 걸릴 수 있습니다')
    const installer = path.join(dir, plan.filename)
    try {
      await runAndWait('java', ['-jar', plan.filename, '--installServer'], dir, (line) => onProgress('install', line.trim()), javaInfo.env)
    } catch (error) {
      fs.writeFileSync(path.join(dir, 'install.log'), String(error.message ?? error))
      throw error
    }

    const launcher = process.platform === 'win32' ? 'run.bat' : 'run.sh'
    if (fs.existsSync(path.join(dir, launcher))) {
      // 포지가 만든 실행 파일에 메모리를 먹이려면 user_jvm_args.txt 를 씁니다.
      const argsFile = path.join(dir, 'user_jvm_args.txt')
      if (fs.existsSync(argsFile)) {
        const current = fs.readFileSync(argsFile, 'utf8')
        if (!/^\s*-Xmx/m.test(current)) fs.writeFileSync(argsFile, `${current.trimEnd()}\n-Xmx${memory}M\n`)
      }
      javaCmd = process.platform === 'win32' ? `cmd /c ${launcher}` : `sh ${launcher}`
    } else {
      const universal = fs.readdirSync(dir).find((file) => /^forge-.+(-universal)?\.jar$/i.test(file) && file !== plan.filename)
      if (universal) javaCmd = `java -Xmx${memory}M -Xms${memory}M -jar ${universal} nogui`
      else throw new Error('포지 설치 결과를 찾지 못했습니다. install.log 를 확인해 주세요.')
    }
    fs.rmSync(jarPath, { force: true })
  }

  onProgress('done', `${dir} 준비 완료`)
  // 실행 명령을 폴더에도 남깁니다 — 백업 복원이 콘솔 등록(실행 명령)까지 되돌릴 수 있게 합니다.
  fs.writeFileSync(
    path.join(dir, 'lubit.json'),
    `${JSON.stringify({ javaCmd, version: plan.mc, type: spec.key, memoryMb: memory, port: serverPort }, null, 2)}\n`,
  )
  return { dir, folder, javaCmd, version: plan.mc, type: spec.key, memoryMb: memory, port: serverPort }
}

// --- 버전 업그레이드 -------------------------------------------------------
// jar 를 새로 받고 실행 명령의 -jar 부분만 바꿉니다. 월드·설정·플러그인은 그대로 둡니다.
// (백업은 부르는 쪽이 먼저 만듭니다 — main.js 가 백업 후에 여기를 부릅니다.)

function jarFromCmd(javaCmd) {
  const match = String(javaCmd || '').match(/-jar\s+(?:"([^"]+)"|(\S+\.jar))/)
  if (!match) return null
  return match[1] || match[2] || null
}

function replaceJar(javaCmd, filename) {
  const safe = /\s/.test(filename) ? `"${filename}"` : filename
  return String(javaCmd).replace(/-jar\s+(?:"[^"]+"|\S+\.jar)/, `-jar ${safe}`)
}

async function upgradeServer(options) {
  const { dir, type, version, javaCmd, onProgress = () => {} } = options
  const spec = SERVER_TYPES.find((item) => item.key === type)
  if (!spec) throw new Error('지원하지 않는 서버 종류입니다.')
  if (spec.key === 'forge') {
    throw new Error('포지 서버는 실행 방식이 달라 자동 업그레이드를 지원하지 않습니다 — 새 폴더에 만들고 world 만 옮기는 편이 안전합니다.')
  }
  if (!/^java\b/.test(String(javaCmd || ''))) {
    throw new Error('실행 명령을 읽을 수 없습니다 — 이 서버는 자동 업그레이드를 지원하지 않습니다.')
  }
  if (!fs.existsSync(dir)) throw new Error('서버 폴더를 찾을 수 없습니다.')

  onProgress('새 버전을 확인하는 중…')
  const plan = await resolveDownload(spec, version)

  // 새 마인크래프트 버전은 새 자바가 필요할 수 있습니다 — 미리 받아 둡니다.
  const javaInfo = await java.ensureJava({
    major: java.requiredJava(plan.mc, spec.key),
    onProgress: (line) => onProgress(line),
  })
  void javaInfo

  const oldJar = jarFromCmd(javaCmd)
  const jarPath = path.join(dir, plan.filename)
  const retire = oldJar && oldJar !== plan.filename ? path.join(dir, `${oldJar}.old`) : null

  // 옛 jar 는 잠시 .old 로 옮겨 둡니다 — 내려받기 중간에 실패하면 되돌립니다.
  if (retire && fs.existsSync(path.join(dir, oldJar))) {
    fs.renameSync(path.join(dir, oldJar), retire)
  }

  onProgress(`${plan.filename} 내려받는 중…`)
  try {
    await download(
      plan.url,
      jarPath,
      (percent, received, total) =>
        onProgress(`${plan.filename} ${percent}% (${mb(received)} / ${mb(total)})`),
      plan.sha256,
    )
  } catch (error) {
    if (retire && fs.existsSync(retire)) fs.renameSync(retire, path.join(dir, oldJar))
    throw error
  }
  if (retire) fs.rmSync(retire, { force: true })

  const nextCmd = replaceJar(javaCmd, plan.filename)
  const sidecar = { javaCmd: nextCmd, version: plan.mc, type: spec.key, updatedAt: Date.now() }
  fs.writeFileSync(path.join(dir, 'lubit.json'), `${JSON.stringify(sidecar, null, 2)}\n`)
  onProgress(`${plan.mc} 으로 바꿨습니다`)
  return { javaCmd: nextCmd, version: plan.mc, filename: plan.filename }
}

function mb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)} MB`
}

// 마법사에서 받아 온 server.properties 값을 검증해 [키, 값] 목록으로 고칩니다.
// 값이 아예 없으면 null — 이때는 기본 설정을 씁니다.
function normalizeProperties(input) {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('server.properties 값이 올바르지 않습니다.')
  }
  const entries = []
  const seen = new Set()
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key)) {
      throw new Error(`server.properties 항목 이름이 올바르지 않습니다: ${key}`)
    }
    if (key === 'server-port') continue // 포트는 마법사의 포트 값이 따릅니다.
    const text = String(value ?? '')
    if (/[\r\n]/.test(text)) throw new Error(`server.properties 값에 줄바꿈이 들어갈 수 없습니다: ${key}`)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push([key, text])
  }
  return entries
}

module.exports = { SERVER_TYPES, defaultRoot, ensureRoot, listVersions, createServer, upgradeServer, safeFolderName }
