// 테스트용 마크 월드를 만듭니다. region 파일을 직접 조립해서
// NBT 해석과 지도 렌더링을 실제 파일로 검사할 수 있게 해 줍니다.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

function tag(type, name, payload) {
  const nameBuffer = Buffer.from(name, 'utf8')
  const head = Buffer.alloc(3)
  head.writeUInt8(type, 0)
  head.writeUInt16BE(nameBuffer.length, 1)
  return Buffer.concat([head, nameBuffer, payload])
}

const t = {
  int: (name, value) => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(value, 0)
    return tag(3, name, b)
  },
  longArray: (name, values) => {
    const count = Buffer.alloc(4)
    count.writeInt32BE(values.length, 0)
    const body = Buffer.concat(
      values.map((value) => {
        const b = Buffer.alloc(8)
        b.writeBigInt64BE(BigInt(value), 0)
        return b
      }),
    )
    return tag(12, name, Buffer.concat([count, body]))
  },
  string: (name, value) => {
    const v = Buffer.from(value, 'utf8')
    const head = Buffer.alloc(2)
    head.writeUInt16BE(v.length, 0)
    return tag(8, name, Buffer.concat([head, v]))
  },
  list: (name, childType, items) => {
    const head = Buffer.alloc(5)
    head.writeUInt8(childType, 0)
    head.writeInt32BE(items.length, 1)
    return tag(9, name, Buffer.concat([head, ...items]))
  },
  compound: (name, entries) => tag(10, name, Buffer.concat([...entries, Buffer.from([0])])),
}

function rootCompound(entries) {
  const head = Buffer.from([10, 0, 0]) // 루트 태그 + 이름 길이 0
  return Buffer.concat([head, ...entries, Buffer.from([0])])
}

function sectionPayload(sectionY, paletteName) {
  return Buffer.concat([
    t.int('Y', sectionY),
    t.compound('block_states', [
      t.list('palette', 10, [Buffer.concat([t.string('Name', paletteName), Buffer.from([0])])]),
    ]),
    Buffer.from([0]),
  ])
}

// 1.18 규칙: 9비트, 한 롱에 7개, 최저 높이(-64) 기준입니다.
function packHeightmap(height) {
  const bits = 9
  const perLong = 7
  const value = Math.max(0, Math.min(511, height + 64))
  const longs = []
  for (let longIndex = 0; longIndex < 37; longIndex++) {
    let packed = 0n
    for (let k = 0; k < perLong; k++) {
      const index = longIndex * perLong + k
      if (index >= 256) break
      packed |= BigInt(value) << BigInt(k * bits)
    }
    longs.push(packed)
  }
  return longs
}

// dir 안에 world/region/r.0.0.mca 를 만듭니다. 지형은 중앙으로 갈수록 올라가는 언덕입니다.
function createFakeWorld(worldDir) {
  const regionDir = path.join(worldDir, 'region')
  fs.mkdirSync(regionDir, { recursive: true })

  const SIZE = 32
  const payloads = []
  for (let cz = 0; cz < SIZE; cz++) {
    for (let cx = 0; cx < SIZE; cx++) {
      const distance = (cx - 16) ** 2 + (cz - 16) ** 2
      const height = 60 + Math.round(40 * Math.exp(-distance / 60))
      const sectionY = Math.floor(height / 16)

      const sections = []
      for (let y = -4; y < sectionY; y++) sections.push(sectionPayload(y, 'minecraft:air'))
      sections.push(sectionPayload(sectionY, 'minecraft:stone'))

      const chunk = rootCompound([
        t.string('Status', 'minecraft:full'),
        t.int('xPos', cx),
        t.int('zPos', cz),
        t.list('sections', 10, sections),
        t.compound('Heightmaps', [t.longArray('MOTION_BLOCKING', packHeightmap(height))]),
      ])

      const payload = zlib.deflateSync(chunk)
      const header = Buffer.alloc(5)
      header.writeUInt32BE(payload.length + 1, 0)
      header.writeUInt8(2, 4)
      payloads.push(Buffer.concat([header, payload]))
    }
  }

  const header = Buffer.alloc(8192)
  let sector = 2
  const starts = []
  const sectors = []
  for (const payload of payloads) {
    const used = Math.max(1, Math.ceil(payload.length / 4096))
    starts.push(sector)
    sectors.push(used)
    sector += used
  }

  const body = Buffer.alloc(sector * 4096)
  payloads.forEach((payload, index) => {
    const entry = index * 4
    header.writeUIntBE(starts[index], entry, 3)
    header[entry + 3] = sectors[index]
    payload.copy(body, starts[index] * 4096)
  })
  fs.writeFileSync(path.join(regionDir, 'r.0.0.mca'), Buffer.concat([header, body]))
  return regionDir
}

module.exports = { createFakeWorld }
