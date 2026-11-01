// 월드 지도를 그립니다.
//
// 월드의 region 파일을 직접 읽어 청크 하나의 높이를 뽑고, 높이로 색을 칠한 뒤
// PNG 로 만들어 콘솔에 보냅니다. 서버에 별도 프로그램을 얹지 않아도 되고,
// 서버 프로세스에도 영향을 주지 않습니다(파일만 읽습니다).

const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')

const nbt = require('./nbt')

const WINDOW = 1024 // 지도에 담을 폭(블록). 중심 좌표에서 ±512
const IMAGE = 512 // PNG 한 변
const SEA_LEVEL = 63

// --- PNG 인코더 -------------------------------------------------------------

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c
    }
  }
  let crc = -1
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

// rgb: width*height*3 바이트
function encodePng(width, height, rgb) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // 비트 깊이
  header.writeUInt8(2, 9) // 색상: RGB
  header.writeUInt8(0, 10)
  header.writeUInt8(0, 11)
  header.writeUInt8(0, 12)

  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // 필터 없음
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- 월드 폴더 ---------------------------------------------------------------

async function readProperties(file) {
  const text = await fs.readFile(file, 'utf8').catch(() => '')
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=')
    if (index <= 0 || line.startsWith('#')) continue
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return out
}

// 폴더 이름으로 쓸 수 있는지 — 한글도 쓸 수 있으므로 경로 구분자만 막습니다.
function isWorldName(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    !/[\\/\0]/.test(value) &&
    value !== '.' &&
    value !== '..'
  )
}

// server.properties 의 level-name 을 따르고, 없으면 world 를 씁니다.
// 후보 중 실제로 region(그리기 위한 청크)이 들어 있는 폴더를 고릅니다 —
// level-name 과 실제 폴더가 어긋나 있거나, 폴더 이름에 한글이 있어도 그대로 찾기 위해서입니다.
async function resolveWorld(serverDir, requested) {
  const candidates = []
  const name = String(requested ?? '').trim()
  if (isWorldName(name)) candidates.push(name)
  const props = await readProperties(path.join(serverDir, 'server.properties'))
  const fromProps = (props['level-name'] ?? '').trim()
  if (isWorldName(fromProps)) candidates.push(fromProps)
  if (!candidates.includes('world')) candidates.push('world')

  const hasDir = async (folder, child) => {
    const stat = await fs.stat(path.join(serverDir, folder, child)).catch(() => null)
    return Boolean(stat && stat.isDirectory())
  }

  for (const candidate of candidates) {
    if (await hasDir(candidate, 'region')) return candidate
  }

  // 후보에 region 이 없으면 — 서버 폴더 전체에서 region/level.dat 를 찾아 봅니다.
  let entries = []
  try {
    entries = await fs.readdir(serverDir, { withFileTypes: true })
  } catch {
    return candidates[0]
  }
  const folders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    // 오버월드를 우선합니다 — 차원 폴더(world_nether)가 먼저 걸리지 않도록.
    .sort((a, b) => rank(a) - rank(b))
  function rank(folder) {
    if (folder === 'world') return 0
    if (/_nether$|_the_end$/i.test(folder)) return 2
    return 1
  }
  for (const folder of folders) {
    if (await hasDir(folder, 'region')) return folder
  }
  for (const folder of folders) {
    const level = await fs.stat(path.join(serverDir, folder, 'level.dat')).catch(() => null)
    if (level && level.isFile()) return folder
  }
  return candidates[0]
}

async function readSpawn(worldDir) {
  try {
    const raw = await fs.readFile(path.join(worldDir, 'level.dat'))
    const data = nbt.parse(zlib.gunzipSync(raw))
    const info = data.Data ?? data
    return { x: Number(info.SpawnX ?? 0), z: Number(info.SpawnZ ?? 0) }
  } catch {
    return { x: 0, z: 0 } // level.dat 가 없으면 원점을 중심으로 그립니다.
  }
}

// --- region 파일 -------------------------------------------------------------

const SECTOR = 4096

// region 파일에서 청크 하나를 꺼내 NBT 로 풀어 줍니다.
function readChunk(region, localX, localZ) {
  const index = (localX + localZ * 32) * 4
  const offsetBytes = region.subarray(index, index + 3)
  const offset = (offsetBytes[0] << 16) | (offsetBytes[1] << 8) | offsetBytes[2]
  if (offset === 0) return null

  const start = offset * SECTOR
  if (start + 5 > region.length) return null
  const length = region.readUInt32BE(start)
  if (length <= 1 || start + 4 + length > region.length) return null

  const compression = region[start + 4]
  const payload = region.subarray(start + 5, start + 4 + length)
  try {
    if (compression === 2) return nbt.parse(zlib.inflateSync(payload))
    if (compression === 1) return nbt.parse(zlib.gunzipSync(payload))
    if (compression === 3) return nbt.parse(payload)
  } catch {
    return null // 쓰는 도중이거나 손상된 조각은 건너뜁니다.
  }
  return null
}

function sectionTop(level) {
  const sections = level.sections ?? level.Sections ?? []
  let top = null
  for (const section of sections) {
    const palette = section.block_states?.palette ?? section.Palette
    if (!Array.isArray(palette) || palette.length === 0) continue
    // 팔레트에 공기만 있으면 비어 있는 섹션입니다.
    if (palette.length === 1 && /(:air)$/.test(String(palette[0].Name ?? ''))) continue
    const y = Number(section.Y)
    if (Number.isNaN(y)) continue
    top = top === null ? y : Math.max(top, y)
  }
  return top === null ? null : (top + 1) * 16
}

// 높이 맵(긴 배열)을 풀어 평균 높이를 냅니다.
// 값의 비트 폭은 월드 높이에 따라 달라서(1.18 이하·초과가 다름) 롱 개수로
// 먼저 맞추고, 남은 오차는 섹션 높이와 겹쳐 어느 쪽이 맞는지 고릅니다.
function unpackMean(packed, bits) {
  const perLong = Math.floor(64 / bits)
  if (perLong <= 0) return null
  const mask = (1n << BigInt(bits)) - 1n
  const count = Math.min(perLong * packed.length, 256)
  if (count <= 0) return null

  let total = 0
  for (let index = 0; index < count; index++) {
    const longIndex = Math.floor(index / perLong)
    const shift = (index % perLong) * bits
    total += Number((BigInt(packed[longIndex] ?? 0n) >> BigInt(shift)) & mask)
  }
  return total / count
}

function heightFromLevel(level, section) {
  const maps = level.Heightmaps
  const packed = maps && (maps.MOTION_BLOCKING ?? maps.WORLD_SURFACE)
  if (!Array.isArray(packed) || packed.length === 0) return null

  // 1.16 이상은 한 롱에 값을 잘라 넣습니다. 롱 개수로 비트 폭을 유추할 수 있습니다.
  const bitsList = packed.length >= 37 ? [9] : packed.length >= 32 ? [8] : packed.length >= 29 ? [7] : [9, 8, 7]
  const offsets = section === null ? null : [-64, 0] // 최저 높이 기준일 수도 아닐 수도 있습니다.

  let best = null
  for (const bits of bitsList) {
    const mean = unpackMean(packed, bits)
    if (mean === null) continue
    for (const offset of offsets ?? [bits >= 9 ? -64 : 0]) {
      const height = Math.max(-128, Math.min(512, mean + offset))
      const score = section === null ? 0 : Math.abs(height - section)
      if (!best || score < best.score) best = { height, score }
    }
  }
  return best ? best.height : null
}

// 한 청크의 대표 높이를 냅니다.
function chunkHeight(root) {
  const level = root.Level ?? root // 1.18 미만은 Level 안에 있습니다.
  const section = sectionTop(level)
  const height = heightFromLevel(level, section)
  if (height !== null) return height
  // 높이 맵이 없으면 가장 위 섹션으로 대신합니다. 16블록 단위로만 보입니다.
  return section === null ? null : section - 8
}

// --- 색 ---------------------------------------------------------------------

const GRADIENT = [
  [64, [52, 118, 66]],
  [90, [70, 132, 70]],
  [130, [96, 126, 74]],
  [170, [124, 116, 84]],
  [210, [142, 134, 122]],
  [260, [172, 172, 172]],
  [310, [226, 232, 238]],
]

function colorAt(height) {
  if (height === null) return [14, 17, 24]
  if (height < SEA_LEVEL - 6) return [17, 44, 92] // 깊은 물
  if (height < SEA_LEVEL) return [33, 78, 138] // 얕은 물
  if (height <= SEA_LEVEL + 2) return [186, 172, 126] // 모래

  let low = GRADIENT[0]
  let high = GRADIENT[GRADIENT.length - 1]
  for (let i = 0; i < GRADIENT.length - 1; i++) {
    if (height >= GRADIENT[i][0] && height <= GRADIENT[i + 1][0]) {
      low = GRADIENT[i]
      high = GRADIENT[i + 1]
      break
    }
  }
  if (height <= GRADIENT[0][0]) return GRADIENT[0][1]
  const span = high[0] - low[0] || 1
  const ratio = Math.max(0, Math.min(1, (height - low[0]) / span))
  return low[1].map((value, index) => Math.round(value + (high[1][index] - value) * ratio))
}

// --- 그리기 -----------------------------------------------------------------

async function render(serverDir, requestedWorld) {
  const world = await resolveWorld(serverDir, requestedWorld)
  const worldDir = path.join(serverDir, world)
  const regionDir = path.join(worldDir, 'region')

  const worldStat = await fs.stat(worldDir).catch(() => null)
  if (!worldStat || !worldStat.isDirectory()) {
    // 월드가 아직 없다 — 서버가 처음 시작할 때 만들어집니다. 폴더에 무엇이 있는지 함께 보여 줍니다.
    let found = []
    try {
      const dirs = await fs.readdir(serverDir, { withFileTypes: true })
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue
        const level = await fs.stat(path.join(serverDir, entry.name, 'level.dat')).catch(() => null)
        if (level && level.isFile()) found.push(entry.name)
      }
    } catch {
      /* 읽지 못하면 목록 없이 */
    }
    throw new Error(
      found.length
        ? `월드 폴더(${world})를 찾지 못했습니다 — 지금 폴더의 월드는 ${found.join(', ')} 입니다. 서버 콘솔에서 save-all 을 친 뒤 다시 그려 보세요.`
        : `월드 폴더(${world})가 아직 없습니다 — 서버가 처음 시작하면 월드가 만들어집니다. 서버가 뜬 뒤 다시 그려 주세요.`,
    )
  }

  const exists = await fs.stat(regionDir).catch(() => null)
  if (!exists || !exists.isDirectory()) {
    // 폴더는 있는데 아직 저장된 청크가 없다 — 처음 생성 직후에 자주 그렇습니다.
    throw new Error(
      `월드(${world})는 있지만 아직 저장된 청크(region)가 없습니다. 서버가 켜져 있으면 그리기 전에 자동으로 save-all 을 보내고, 그래도 없으면 서버를 한 번 종료해 저장한 뒤 다시 그려 주세요.`,
    )
  }

  const spawn = await readSpawn(worldDir)
  const half = WINDOW / 2
  const firstChunkX = Math.floor((spawn.x - half) / 16)
  const firstChunkZ = Math.floor((spawn.z - half) / 16)
  const chunkCount = Math.ceil(WINDOW / 16) // 64
  const side = Math.ceil(Math.sqrt(chunkCount * chunkCount)) // 64
  const scale = IMAGE / side // 청크 하나를 8픽셀로

  const heights = new Array(side * side).fill(null)
  const regionCache = new Map()

  for (let gz = 0; gz < side; gz++) {
    for (let gx = 0; gx < side; gx++) {
      const chunkX = firstChunkX + gx
      const chunkZ = firstChunkZ + gz
      const regionX = Math.floor(chunkX / 32)
      const regionZ = Math.floor(chunkZ / 32)
      const key = `${regionX}.${regionZ}`

      let region = regionCache.get(key)
      if (region === undefined) {
        region = await fs
          .readFile(path.join(regionDir, `r.${regionX}.${regionZ}.mca`))
          .catch(() => null)
        regionCache.set(key, region)
      }
      if (!region) continue

      const localX = chunkX - regionX * 32
      const localZ = chunkZ - regionZ * 32
      const root = readChunk(region, localX, localZ)
      if (!root) continue
      heights[gx + gz * side] = chunkHeight(root)
    }
  }

  const rgb = Buffer.alloc(IMAGE * IMAGE * 3)
  const sample = (gx, gz) => {
    const x = Math.max(0, Math.min(side - 1, gx))
    const z = Math.max(0, Math.min(side - 1, gz))
    return heights[x + z * side]
  }

  for (let y = 0; y < IMAGE; y++) {
    for (let x = 0; x < IMAGE; x++) {
      const gx = Math.floor(x / scale)
      const gz = Math.floor(y / scale)
      const height = sample(gx, gz)
      const base = colorAt(height)

      // 옆 청크와의 높이 차로 음영을 줘 지형이 보이게 합니다.
      const here = height ?? 0
      const neighbour = sample(gx + 1, gz)
      const shade = neighbour === null ? 1 : Math.max(0.72, Math.min(1.28, 1 + (here - (neighbour ?? here)) / 90))

      const offset = (y * IMAGE + x) * 3
      rgb[offset] = Math.max(0, Math.min(255, Math.round(base[0] * shade)))
      rgb[offset + 1] = Math.max(0, Math.min(255, Math.round(base[1] * shade)))
      rgb[offset + 2] = Math.max(0, Math.min(255, Math.round(base[2] * shade)))
    }
  }

  const png = encodePng(IMAGE, IMAGE, rgb)
  return {
    world,
    width: IMAGE,
    height: IMAGE,
    spawn,
    center: { x: spawn.x, z: spawn.z },
    blocksPerPixel: WINDOW / IMAGE,
    png: png.toString('base64'),
  }
}

module.exports = { render, encodePng, WINDOW, IMAGE }
