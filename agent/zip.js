// 서버 폴더 백업을 위한 zip 작성·해제 — 외부 의존성 없이 node:zlib 만 씁니다.
//
//   zipFolder(srcDir, outFile)  폴더를 zip 으로 쌓습니다 (deflate, 폴더·한글 파일명 지원)
//   unzip(zipFile, destDir)     zip 을 풀어 넣습니다 (zip-slip 경로 공격 차단)
//
// 4GB 가 넘는 서버 폴더도 다루도록 ZIP64 를 씁니다 — 마인크래프트 서버는 world·mods·
// jar 만 합쳐도 손쉽게 4GB 를 넘습니다. 만드는 쪽과 푸는 쪽 모두 ZIP64 를 지원합니다.

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { promisify } = require('node:util')

const deflateRaw = promisify(zlib.deflateRaw)
const inflateRaw = promisify(zlib.inflateRaw)

// --- CRC32 -----------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// --- 시간 ------------------------------------------------------------------
// zip 은 1980년 기준 DOS 날짜/시각을 씁니다 (2초 단위).

function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(1980, d.getFullYear())
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31)
  const day = (((year - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | (d.getDate() & 31)
  return { time, day }
}

// --- 공용 ------------------------------------------------------------------

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIGLocator = 0x07064b50
const FLAG_UTF8 = 0x0800 // 파일 이름이 UTF-8 입니다.
const ZIP64_MARKER = 0xffffffff

// 스트림에 조각을 쓰고 drain 을 기다립니다 — 메모리를 늘리지 않고 흐름을 유지합니다.
function writeChunk(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve()
  return new Promise((resolve) => stream.once('drain', resolve))
}

function isExcluded(relative) {
  // 백업 파일이 자기 자신을 다시 담지 않도록 합니다. 임시 파일도 제외합니다.
  return /(^|\/)\.lubit-backups(\/|$)/.test(relative) || /(^|\/)\.DS_Store$/.test(relative)
}

async function walk(dir, base, out) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (isExcluded(relative)) continue
    if (entry.isDirectory()) {
      out.push({ type: 'dir', relative, full })
      await walk(full, relative, out)
    } else if (entry.isFile()) {
      const stat = await fs.promises.stat(full)
      out.push({ type: 'file', relative, full, size: stat.size, mtime: stat.mtime })
    }
    // 심볼릭 링크와 특수 파일은 건드리지 않습니다 — 서버 폴더에는 드물고,
        // 링크를 그대로 옮기면 복원 경로가 밖으로 나갈 수 있습니다.
  }
}

// --- 만들기 ----------------------------------------------------------------

async function zipFolder(srcDir, outFile, options = {}) {
  const onProgress = options.onProgress || (() => {})
  const source = path.resolve(srcDir)
  if (!fs.existsSync(source)) throw new Error(`백업할 폴더가 없습니다: ${source}`)

  const items = []
  await walk(source, '', items)
  const files = items.filter((item) => item.type === 'file')
  const totalBytes = files.reduce((sum, item) => sum + item.size, 0)

  // 백업 파일이 서버 폴더 안에 있으면 본인을 다시 담지 않도록 outFile 을 제외합니다.
  const outFileResolved = path.resolve(outFile)
  const targets = items.filter((item) => path.resolve(item.full) !== outFileResolved)

  await fs.promises.mkdir(path.dirname(outFileResolved), { recursive: true })
  const stream = fs.createWriteStream(outFileResolved)

  const central = [] // 중앙 디렉토리 레코드 모음
  let offset = 0
  let processed = 0
  let fileCount = 0

  try {
    for (const item of targets) {
      let data = Buffer.alloc(0)
      let method = 0
      let crc = 0

      if (item.type === 'file') {
        const raw = await fs.promises.readFile(item.full)
        crc = crc32(raw)
        let deflated = Buffer.alloc(0)
        if (raw.length > 0) deflated = await deflateRaw(raw, { level: 6 })
        // 압축이 오히려 크면 그대로 담습니다 (이미 압축된 jar 등).
        if (deflated.length > 0 && deflated.length < raw.length) {
          data = deflated
          method = 8
        } else {
          data = raw
          method = 0
        }
        fileCount += 1
        processed += item.size
      }

      const name = Buffer.from(item.type === 'dir' ? `${item.relative}/` : item.relative, 'utf8')
      const { time, day } = dosDateTime(item.mtime)
      const needZip64 = data.length >= ZIP64_MARKER

      // --- local file header ---
      const local = Buffer.alloc(30)
      local.writeUInt32LE(SIG_LOCAL, 0)
      local.writeUInt16LE(45, 4) // version needed (zip64 대응)
      local.writeUInt16LE(FLAG_UTF8, 6)
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(day, 12)
      local.writeUInt32LE(crc, 14)
      local.writeUInt32LE(needZip64 ? ZIP64_MARKER : data.length, 18)
      local.writeUInt32LE(needZip64 ? ZIP64_MARKER : (item.size || 0), 22)
      local.writeUInt16LE(name.length + (needZip64 ? 16 + 2 : 0), 26)
      local.writeUInt16LE(needZip64 ? 18 : 0, 28) // extra: id(2)+size(2)+usize(8)+csize(8)

      await writeChunk(stream, local)
      await writeChunk(stream, name)
      if (needZip64) {
        const extra = Buffer.alloc(18)
        extra.writeUInt16LE(0x0001, 0)
        extra.writeUInt16LE(16, 2)
        extra.writeBigUInt64LE(BigInt(item.size || 0), 4)
        extra.writeBigUInt64LE(BigInt(data.length), 12)
        await writeChunk(stream, extra)
      }
      if (data.length) await writeChunk(stream, data)

      // --- central directory record ---
      const record = Buffer.alloc(46)
      record.writeUInt32LE(SIG_CENTRAL, 0)
      record.writeUInt16LE(45, 4) // version made by
      record.writeUInt16LE(45, 6) // version needed
      record.writeUInt16LE(FLAG_UTF8, 8)
      record.writeUInt16LE(method, 10)
      record.writeUInt16LE(time, 12)
      record.writeUInt16LE(day, 14)
      record.writeUInt32LE(crc, 16)
      record.writeUInt32LE(data.length >= ZIP64_MARKER ? ZIP64_MARKER : data.length, 20)
      record.writeUInt32LE((item.size || 0) >= ZIP64_MARKER ? ZIP64_MARKER : item.size || 0, 24)
      record.writeUInt16LE(name.length, 28)
      record.writeUInt16LE(0, 30) // extra
      record.writeUInt16LE(0, 32) // comment
      record.writeUInt16LE(0, 34) // disk
      record.writeUInt16LE(0, 36) // internal
      const mode = item.type === 'dir' ? 0x41ed0000 : 0x81a40000
      record.writeUInt32LE(mode >>> 0, 38) // external attrs
      record.writeUInt32LE(offset >= ZIP64_MARKER ? ZIP64_MARKER : offset, 42)

      const centralExtra = Buffer.alloc(28)
      let centralExtraLength = 0
      if ((item.size || 0) >= ZIP64_MARKER || data.length >= ZIP64_MARKER || offset >= ZIP64_MARKER) {
        centralExtra.writeUInt16LE(0x0001, 0)
        centralExtra.writeUInt16LE(24, 2)
        centralExtra.writeBigUInt64LE(BigInt(item.size || 0), 4)
        centralExtra.writeBigUInt64LE(BigInt(data.length), 12)
        centralExtra.writeBigUInt64LE(BigInt(offset), 20)
        centralExtraLength = 28
        record.writeUInt16LE(centralExtraLength, 30)
      }

      central.push(record, centralExtra.subarray(0, centralExtraLength), name)
      offset += local.length + name.length + (needZip64 ? 18 : 0) + data.length

      if (fileCount % 20 === 0) onProgress({ processed, total: totalBytes, file: item.relative })
    }

    const centralBuffer = Buffer.concat(central)
    const centralOffset = offset
    await writeChunk(stream, centralBuffer)
    offset += centralBuffer.length

    // --- EOCD (ZIP64 가 필요하면 EOCD64 + locator 를 먼저 씁니다) ---
    const entries = targets.length
    const needZip64End =
      entries >= 0xffff || centralOffset >= ZIP64_MARKER || centralBuffer.length >= ZIP64_MARKER
    if (needZip64End) {
      const eocd64 = Buffer.alloc(56)
      eocd64.writeUInt32LE(SIG_EOCD64, 0)
      eocd64.writeBigUInt64LE(44n, 4) // size of remainder
      eocd64.writeUInt16LE(45, 12)
      eocd64.writeUInt16LE(45, 14)
      eocd64.writeUInt32LE(0, 16)
      eocd64.writeUInt32LE(0, 20)
      eocd64.writeBigUInt64LE(BigInt(entries), 24)
      eocd64.writeBigUInt64LE(BigInt(entries), 32)
      eocd64.writeBigUInt64LE(BigInt(centralBuffer.length), 40)
      eocd64.writeBigUInt64LE(BigInt(centralOffset), 48)
      await writeChunk(stream, eocd64)

      const locator = Buffer.alloc(20)
      locator.writeUInt32LE(SIGLocator, 0)
      locator.writeUInt32LE(0, 4)
      locator.writeBigUInt64LE(BigInt(offset), 8) // EOCD64 offset
      locator.writeUInt32LE(1, 16)
      await writeChunk(stream, locator)
      offset += 56 + 20
    }

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(SIG_EOCD, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(entries >= 0xffff ? 0xffff : entries, 8)
    eocd.writeUInt16LE(entries >= 0xffff ? 0xffff : entries, 10)
    eocd.writeUInt32LE(centralBuffer.length >= ZIP64_MARKER ? ZIP64_MARKER : centralBuffer.length, 12)
    eocd.writeUInt32LE(centralOffset >= ZIP64_MARKER ? ZIP64_MARKER : centralOffset, 16)
    eocd.writeUInt16LE(0, 20)
    await writeChunk(stream, eocd)
  } finally {
    await new Promise((resolve, reject) => {
      stream.end((err) => (err ? reject(err) : resolve()))
    })
  }

  const stat = await fs.promises.stat(outFileResolved)
  onProgress({ processed: totalBytes, total: totalBytes, file: '' })
  return { file: outFileResolved, files: fileCount, size: stat.size, sourceBytes: totalBytes }
}

// --- 풀기 ------------------------------------------------------------------

// EOCD(끝 레코드) 를 파일 뒤에서 찾아 위치를 돌려줍니다.
function findEOCD(buffer) {
  const min = Math.max(0, buffer.length - 66_000)
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('zip 끝 표식을 찾지 못했습니다 — 파일이 손상되었을 수 있습니다.')
}

async function readDirectory(zipPath) {
  const stat = await fs.promises.stat(zipPath)
  const tailSize = Math.min(stat.size, 66_000)
  const handle = await fs.promises.open(zipPath, 'r')
  try {
    const tail = Buffer.alloc(tailSize)
    await handle.read(tail, 0, tailSize, stat.size - tailSize)
    const eocdAt = findEOCD(tail)
    const eocdBase = stat.size - tailSize + eocdAt

    let entries = tail.readUInt16LE(eocdAt + 10)
    let centralSize = tail.readUInt32LE(eocdAt + 12)
    let centralOffset = tail.readUInt32LE(eocdAt + 16)

    // ZIP64 — 필드가 0xFFFF/0xFFFFFFFF 이면 뒤의 EOCD64 를 봅니다.
    if (entries === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER) {
      // locator 는 EOCD 바로 앞 20바이트에 있습니다.
      const locatorAt = eocdAt - 20
      if (locatorAt < 0 || tail.readUInt32LE(locatorAt) !== SIGLocator) {
        throw new Error('zip64 표식이 올바르지 않습니다.')
      }
      const eocd64Offset = Number(tail.readBigUInt64LE(locatorAt + 8))
      const head = Buffer.alloc(56)
      await handle.read(head, 0, 56, eocd64Offset)
      if (head.readUInt32LE(0) !== SIG_EOCD64) throw new Error('zip64 끝 표식이 없습니다.')
      entries = Number(head.readBigUInt64LE(32))
      centralSize = Number(head.readBigUInt64LE(40))
      centralOffset = Number(head.readBigUInt64LE(48))
    }

    const central = Buffer.alloc(centralSize)
    await handle.read(central, 0, centralSize, centralOffset)

    const list = []
    let pos = 0
    for (let i = 0; i < entries && pos + 46 <= central.length; i++) {
      if (central.readUInt32LE(pos) !== SIG_CENTRAL) break
      const method = central.readUInt16LE(pos + 10)
      const time = central.readUInt16LE(pos + 12)
      const day = central.readUInt16LE(pos + 14)
      const crc = central.readUInt32LE(pos + 16)
      let compressedSize = central.readUInt32LE(pos + 20)
      let size = central.readUInt32LE(pos + 24)
      const nameLength = central.readUInt16LE(pos + 28)
      const extraLength = central.readUInt16LE(pos + 30)
      const commentLength = central.readUInt16LE(pos + 32)
      let localOffset = central.readUInt32LE(pos + 42)
      const name = central.toString('utf8', pos + 46, pos + 46 + nameLength)

      if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
        let extraPos = pos + 46 + nameLength
        const extraEnd = extraPos + extraLength
        while (extraPos + 4 <= extraEnd) {
          const id = central.readUInt16LE(extraPos)
          const len = central.readUInt16LE(extraPos + 2)
          if (id === 0x0001) {
            let p = extraPos + 4
            if (size === ZIP64_MARKER && p + 8 <= extraEnd) {
              size = Number(central.readBigUInt64LE(p))
              p += 8
            }
            if (compressedSize === ZIP64_MARKER && p + 8 <= extraEnd) {
              compressedSize = Number(central.readBigUInt64LE(p))
              p += 8
            }
            if (localOffset === ZIP64_MARKER && p + 8 <= extraEnd) {
              localOffset = Number(central.readBigUInt64LE(p))
            }
            break
          }
          extraPos += 4 + len
        }
      }

      list.push({ name, method, time, day, crc, size, compressedSize, localOffset })
      pos += 46 + nameLength + extraLength + commentLength
    }
    return { handle, list }
  } catch (error) {
    await handle.close()
    throw error
  }
}

async function unzip(zipPath, destDir, options = {}) {
  const onProgress = options.onProgress || (() => {})
  const destination = path.resolve(destDir)
  const { handle, list } = await readDirectory(zipPath)

  let files = 0
  let bytes = 0
  try {
    for (const entry of list) {
      const isDir = entry.name.endsWith('/')
      const relative = isDir ? entry.name.slice(0, -1) : entry.name

      // zip-slip 차단 — 밖으로 나가는 경로는 풀지 않습니다.
      const target = path.resolve(destination, relative)
      if (target !== destination && !target.startsWith(destination + path.sep)) {
        throw new Error(`폴더 밖으로 향하는 항목이 있습니다: ${entry.name}`)
      }

      if (isDir) {
        await fs.promises.mkdir(target, { recursive: true })
        continue
      }

      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      if (entry.compressedSize === 0) {
        await fs.promises.writeFile(target, Buffer.alloc(0))
        files += 1
        continue
      }

      const header = Buffer.alloc(30)
      await handle.read(header, 0, 30, entry.localOffset)
      if (header.readUInt32LE(0) !== SIG_LOCAL) {
        throw new Error(`zip 항목 머리글이 올바르지 않습니다: ${entry.name}`)
      }
      const nameLength = header.readUInt16LE(26)
      const extraLength = header.readUInt16LE(28)
      const dataAt = entry.localOffset + 30 + nameLength + extraLength

      const data = Buffer.alloc(entry.compressedSize)
      await handle.read(data, 0, entry.compressedSize, dataAt)

      let content
      if (entry.method === 0) content = data
      else if (entry.method === 8) content = await inflateRaw(data)
      else throw new Error(`지원하지 않는 압축 방식입니다 (${entry.method}): ${entry.name}`)

      if (crc32(content) !== entry.crc) {
        throw new Error(`무결성 검사에 실패했습니다: ${entry.name}`)
      }
      await fs.promises.writeFile(target, content)
      files += 1
      bytes += content.length
      if (files % 20 === 0) onProgress({ files, bytes, file: entry.name })
    }
  } finally {
    await handle.close()
  }

  onProgress({ files, bytes, file: '' })
  return { files, bytes }
}

module.exports = { zipFolder, unzip, crc32 }
