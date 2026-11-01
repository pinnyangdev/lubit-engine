// 에이전트 모듈(파일·플러그인·월드 지도)을 실제 파일로 검사합니다.
//   node scripts/test-agent.cjs

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const files = require('../agent/files')
const plugins = require('../agent/plugins')
const map = require('../agent/map')
const importer = require('../agent/import')
const backup = require('../agent/backup')
const { createFakeWorld } = require('./fake-world.cjs')

// --- 임시 서버 폴더 ----------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lubit-map-'))
fs.mkdirSync(path.join(tmp, 'plugins'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'server.properties'), 'level-name=world\nmotd=test\n')
fs.writeFileSync(path.join(tmp, 'plugins', 'EssentialsX.jar'), Buffer.alloc(1024))
createFakeWorld(path.join(tmp, 'world'))

function findIdat(buffer) {
  let offset = 8
  for (;;) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'IDAT') return offset
    offset += 12 + length
    if (offset > buffer.length) throw new Error('IDAT을 찾지 못했습니다')
  }
}

async function main() {
  // 1) 파일 목록·읽기·쓰기
  const listing = await files.list(tmp, '.')
  assert.ok(listing.entries.some((entry) => entry.name === 'server.properties'), '파일 목록에 server.properties')
  const text = await files.read(tmp, 'server.properties')
  assert.ok(text.content.includes('level-name'), '파일 읽기')
  await files.write(tmp, 'config/spigot.yml', 'settings: {}')
  const written = await files.read(tmp, 'config/spigot.yml')
  assert.strictEqual(written.content, 'settings: {}', '파일 쓰기')
  assert.throws(() => files.resolveSafe(tmp, '../outside'), '폴더 밖 이동 차단')

  // 2) 플러그인 목록
  const pluginList = await plugins.list(tmp)
  assert.strictEqual(pluginList.entries.length, 1, '플러그인 1개')
  assert.strictEqual(pluginList.entries[0].name, 'EssentialsX.jar', '플러그인 이름')

  // 3) 월드 지도
  const result = await map.render(tmp, 'world')
  const png = Buffer.from(result.png, 'base64')
  assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG 시그니처')
  assert.strictEqual(png.readUInt32BE(16), 512, '가로 512')
  assert.strictEqual(png.readUInt32BE(20), 512, '세로 512')
  assert.ok(png.length > 500, `PNG 크기 ${png.length}B`)

  // 지도가 올바르게 채워졌는지: 서로 다른 색이 충분해야 합니다.
  const inflated = zlib.inflateSync(png.subarray(findIdat(png) + 8))
  const stride = 512 * 3 + 1
  const seen = new Set()
  for (let y = 0; y < 512; y += 16) {
    for (let x = 0; x < 512; x += 16) {
      const offset = y * stride + 1 + x * 3
      seen.add(`${inflated[offset]},${inflated[offset + 1]},${inflated[offset + 2]}`)
    }
  }
  assert.ok(seen.size >= 4, `지형 색 종류 ${seen.size}개 (4개 이상 기대)`)

  console.log(`파일 ${listing.entries.length}개 · 플러그인 ${pluginList.entries.length}개`)
  console.log(`지도 PNG ${(png.length / 1024).toFixed(1)}KB · 색 ${seen.size}종 · ${result.blocksPerPixel}블록/픽셀`)

  // 4) 기존 서버 폴더 가져오기 (드래그앤드롭 등록용 판별)
  const imported = path.join(tmp, 'imported-server')
  fs.mkdirSync(imported, { recursive: true })
  fs.writeFileSync(path.join(imported, 'server.properties'), 'server-port=25577\n')
  fs.writeFileSync(path.join(imported, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(imported, 'paper-1.20.4-496.jar'), Buffer.alloc(1024))
  const plan = importer.detect(imported)
  assert.strictEqual(plan.type, 'paper', 'jar 로 종류 판별')
  assert.strictEqual(plan.version, '1.20.4', 'jar 로 버전 판별')
  assert.strictEqual(plan.port, 25577, 'server.properties 포트 판별')
  assert.ok(/^java .*paper-1\.20\.4-496\.jar/.test(plan.javaCmd), `실행 명령: ${plan.javaCmd}`)

  const scripted = path.join(tmp, 'scripted-server')
  fs.mkdirSync(scripted, { recursive: true })
  fs.writeFileSync(path.join(scripted, 'run.bat'), 'java -Xmx3G -jar server.jar nogui\n')
  const plan2 = importer.detect(scripted)
  assert.strictEqual(plan2.javaCmd, 'cmd /c run.bat', '시작 스크립트 실행')
  assert.strictEqual(plan2.memoryMb, 3072, '스크립트의 -Xmx 읽기')

  const notServer = path.join(tmp, 'not-a-server')
  fs.mkdirSync(notServer, { recursive: true })
  fs.writeFileSync(path.join(notServer, 'readme.txt'), 'hi')
  assert.throws(() => importer.detect(notServer), /서버 폴더로 보이지 않습니다/, '비서버 폴더 거부')
  console.log('가져오기 판별 3케이스 통과')

  // 5) 루트 밖에서 가져온 서버도 백업이 됩니다 (백업 저장 위치는 늘 루트 안)
  const outside = path.join(os.tmpdir(), `lubit-outside-${Date.now()}`)
  const importedDir = path.join(outside, 'Imported')
  fs.mkdirSync(importedDir, { recursive: true })
  fs.writeFileSync(path.join(importedDir, 'server.properties'), 'motd=old\n')
  const made = await backup.create(importedDir, tmp, () => {})
  const listed = await backup.list(importedDir, tmp)
  assert.strictEqual(listed.length, 1, '루트 밖 서버 백업 목록')
  fs.writeFileSync(path.join(importedDir, 'server.properties'), 'motd=new\n')
  await backup.restore(importedDir, tmp, made.file, () => {})
  assert.ok(
    fs.readFileSync(path.join(importedDir, 'server.properties'), 'utf8').includes('motd=old'),
    '루트 밖 서버 복원',
  )
  await backup.deleteAll(importedDir, tmp)
  fs.rmSync(outside, { recursive: true, force: true })
  console.log('루트 밖 서버 백업·복원 통과')

  console.log('agent 모듈 검사 통과')
}

main()
  .catch((error) => {
    console.error('실패:', error)
    process.exitCode = 1
  })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }))
