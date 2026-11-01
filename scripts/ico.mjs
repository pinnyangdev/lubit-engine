// PNG 묶음을 Windows 아이콘(.ico)으로 감습니다.
// ICO 컨테이너에 PNG 데이터를 그대로 넣는 방식이라 압축·재인코딩이 없습니다.
// Windows Vista 이후와 electron-builder 모두 이 형식을 읽습니다.
import { readFileSync, writeFileSync } from 'node:fs'

const [dir, out, ...rest] = process.argv.slice(2)
if (!dir || !out) {
  console.error('사용법: node ico.mjs <png_폴더> <출력.ico> [크기...]')
  process.exit(1)
}

const sizes = rest.length ? rest.map(Number) : [16, 24, 32, 48, 64, 128, 256]

const images = sizes.map((size) => {
  let buf
  try {
    buf = readFileSync(`${dir}/icon-${size}.png`)
  } catch {
    console.error(`${dir}/icon-${size}.png 읽기 실패`)
    process.exit(1)
  }
  if (buf.toString('ascii', 1, 4) !== 'PNG') {
    console.error(`icon-${size}.png 가 PNG가 아닙니다.`)
    process.exit(1)
  }
  return { size, buf }
})

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // 예약
header.writeUInt16LE(1, 2) // 타입: 아이콘
header.writeUInt16LE(images.length, 4) // 개수

let offset = 6 + images.length * 16
const entries = []
for (const { size, buf } of images) {
  const entry = Buffer.alloc(16)
  const edge = size >= 256 ? 0 : size // 0은 256을 뜻합니다
  entry[0] = edge
  entry[1] = edge
  entry.writeUInt16LE(1, 4) // 플레인
  entry.writeUInt16LE(32, 6) // 비트/픽셀
  entry.writeUInt32LE(buf.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += buf.length
}

writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]))
console.log(`아이콘 생성: ${out} (${images.length}개 크기, ${offset}바이트)`)
