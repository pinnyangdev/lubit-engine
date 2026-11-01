// 배포 파일을 만듭니다 — Cloudflare 정적 자산은 파일당 25MiB 까지라
// 그 이상은 무조건 쪼개야 합니다.
//
//   agent/release/*.exe  → public/download/engine/{manifest.json, p000.bin …}
//   agent/release/*.apk  → public/download/android/…
//   agent/release/*.ipa  → public/download/ios/…
//   public/download/manifest.json  ← 웹이 "무엇으로 받을까" 창에 보여주는 목록
//
// 파일이 없는 배포본은 available:false 로 올라가고, 해당 파일을 release 에
// 넣고 다시 빌드하면 그때부터 다운로드가 열립니다.
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const CHUNK = 20 * 1024 * 1024 // 25MiB 한도에 여유를 둔 값

const ARTIFACTS = [
  // 실행 파일은 그대로 주면 브라우저·백신이 먼저 위험으로 표시하는 경우가 많습니다.
  // zip 으로 쌓아 내려받게 하면 사용자는 압축을 푼 뒤 실행하게 되므로 그런 경고를 크게 줄일 수 있습니다.
  { key: 'engine', label: 'Windows 64비트 (zip)', pattern: /^LubitServerEngine-Setup-.+\.exe$/i, zip: true },
  { key: 'mac', label: 'macOS (Apple 실리콘 · 인텔)', pattern: /^LubitServerEngine-.+-mac\.dmg$/i },
  { key: 'android', label: 'Android (APK)', pattern: /^.+\.apk$/i },
  { key: 'ios', label: 'iOS (IPA)', pattern: /^.+\.ipa$/i },
]

const root = fileURLToPath(new URL('..', import.meta.url))
const releaseDir = join(root, 'agent', 'release')
const downloadDir = join(root, 'public', 'download')

function findFile(pattern) {
  if (!existsSync(releaseDir)) return null
  const names = readdirSync(releaseDir).filter((name) => pattern.test(name))
  if (names.length === 0) return null
  names.sort((a, b) => statSync(join(releaseDir, b)).mtimeMs - statSync(join(releaseDir, a)).mtimeMs)
  return join(releaseDir, names[0])
}

function versionOf(filename) {
  const match = filename.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : undefined
}

// --- zip 만들기 -------------------------------------------------------------
// 압축은 넣지 않고 넣은 그대로(STORE)만 씁니다 — 서버 설치 파일은 어차피 이미
// 압축돼 있고, 그대로여야 압축 풀기 후 파일이 완전히 동일한지 검증할 수 있습니다.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

// 헤더에 crc 를 넣어야 하므로 파일을 한 번 훑어 계산합니다.
async function crc32File(file) {
  let c = 0xffffffff
  for await (const chunk of createReadStream(file)) {
    for (let i = 0; i < chunk.length; i++) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

// 윈도우 zip 은 1980 년 기준 초 단위 날짜를 씁니다.
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

// 파일 하나를 zip 으로 쌓습니다. (local header + data + central directory + EOCD)
async function zipFile(source, target) {
  const stat = statSync(source)
  const name = Buffer.from(source.split(/[\\/]/).pop(), 'utf8')
  const crc = await crc32File(source)
  const { time, day } = dosDateTime(stat.mtime)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // 압축을 풀 최소 버전
  local.writeUInt16LE(0, 6) // 깃발
  local.writeUInt16LE(0, 8) // STORE — 압축 없음
  local.writeUInt16LE(time, 10)
  local.writeUInt16LE(day, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(stat.size, 18)
  local.writeUInt32LE(stat.size, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4) // 만든 환경 (MS-DOS)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(0, 10)
  central.writeUInt16LE(time, 12)
  central.writeUInt16LE(day, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(stat.size, 20)
  central.writeUInt32LE(stat.size, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt16LE(0, 30) // extra
  central.writeUInt16LE(0, 32) // comment
  central.writeUInt16LE(0, 34) // disk
  central.writeUInt16LE(0, 36) // 내부 속성
  central.writeUInt32LE(0, 38) // 외부 속성
  central.writeUInt32LE(0, 42) // local header 위치

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + name.length, 12)
  eocd.writeUInt32LE(30 + name.length + stat.size, 16)
  eocd.writeUInt16LE(0, 20)

  const out = createWriteStream(target)
  try {
    out.write(local)
    out.write(name)
    for await (const chunk of createReadStream(source)) {
      if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
    }
    out.write(central)
    out.write(name)
    out.write(eocd)
    await new Promise((resolve, reject) => {
      out.on('error', reject)
      out.end(resolve)
    })
  } catch (error) {
    out.destroy()
    throw error
  }
}

// 파일을 20MiB 청크로 쪼개 dir 안에 두고 매니페스트를 돌려줍니다.
async function split(source, dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const filename = source.split(/[\\/]/).pop()
  const size = statSync(source).size
  const partCount = Math.max(1, Math.ceil(size / CHUNK))
  const parts = []

  for (let i = 0; i < partCount; i++) {
    const start = i * CHUNK
    const end = Math.min(size, start + CHUNK) - 1
    const name = `p${String(i).padStart(3, '0')}.bin`
    await pipeline(createReadStream(source, { start, end }), createWriteStream(join(dir, name)))
    parts.push({ path: name, size: end - start + 1 })
  }

  const hash = createHash('sha256')
  await pipeline(createReadStream(source), hash)

  const manifest = {
    filename,
    version: versionOf(filename),
    size,
    sha256: hash.digest('hex'),
    builtAt: Date.now(),
    // Worker 가 이어 붙여 보낼 때 쓰는 조각 목록 (상대 경로)
    parts,
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { filename, size, version: manifest.version, parts: partCount }
}

mkdirSync(downloadDir, { recursive: true })

const artifacts = []
for (const artifact of ARTIFACTS) {
  const dir = join(downloadDir, artifact.key)
  let source = findFile(artifact.pattern)

  // 내려받기를 zip 으로 바꿉니다. zip 은 release 폴더에 함께 남습니다.
  if (source && artifact.zip) {
    const exeName = source.split(/[\\/]/).pop()
    const zipped = join(releaseDir, `${exeName.replace(/\.exe$/i, '')}.zip`)
    console.log(`[split-installer] ${exeName} → zip 으로 쌓는 중…`)
    await zipFile(source, zipped)
    source = zipped
  }

  if (!source) {
    rmSync(dir, { recursive: true, force: true })
    artifacts.push({
      key: artifact.key,
      label: artifact.label,
      url: `/download/${artifact.key}`,
      size: 0,
      available: false,
    })
    console.log(`[split-installer] ${artifact.key}: 배포 파일 없음 → 준비 중`)
    continue
  }

  const result = await split(source, dir)
  artifacts.push({
    key: artifact.key,
    label: artifact.label,
    url: `/download/${artifact.key}`,
    size: result.size,
    version: result.version,
    available: true,
  })
  console.log(
    `[split-installer] ${result.filename} → ${result.parts}개 청크 (${(result.size / 1024 / 1024).toFixed(1)} MB) → public/download/${artifact.key}/`,
  )
}

writeFileSync(
  join(downloadDir, 'manifest.json'),
  `${JSON.stringify({ generatedAt: Date.now(), artifacts }, null, 2)}\n`,
)
