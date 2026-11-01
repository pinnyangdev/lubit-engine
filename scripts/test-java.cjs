// 자바 자동 설치를 검사합니다.
//   node scripts/test-java.cjs
//
// 1) 마인크래프트 버전 → 필요한 자바 버전 매핑
// 2) PATH 에 있는 자바 인식
// 3) Adoptium 에서 실제로 받아 압축을 풀고 실행해 보기 (임시 폴더, 끝나면 삭제)

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const java = require('../agent/java')

async function main() {
  // 1) 버전 매핑
  const cases = [
    ['1.21.4', 21],
    ['1.21', 21],
    ['1.20.6', 21],
    ['1.20.4', 17],
    ['1.19.4', 17],
    ['1.18.2', 17],
    ['1.17.1', 17],
    ['1.16.5', 8],
    ['1.12.2', 8],
    ['24w14a', 21],
    ['', 21],
  ]
  for (const [mc, expected] of cases) {
    assert.strictEqual(java.requiredJava(mc), expected, `${mc} → ${expected}`)
  }
  assert.strictEqual(java.requiredJava('1.21.4', 'velocity'), 17, '벨로시티는 17')
  console.log(`· 버전 매핑 ${cases.length + 1}건 통과`)

  // 2) 버전 문자열 해석
  assert.strictEqual(java.parseMajor('openjdk version "21.0.1" 2024-10-15'), 21)
  assert.strictEqual(java.parseMajor('java version "1.8.0_402"'), 8)
  assert.strictEqual(java.parseMajor('없는 문자열'), null)
  console.log('· 자바 버전 문자열 해석 통과')

  // 3) PATH 에 있는 자바
  const found = await java.detect()
  console.log(`· PATH 자바: ${found ? `${found.major} (${found.label})` : '없음'}`)
  if (found) {
    const info = await java.ensureJava({ major: Math.min(found.major, 21) })
    assert.ok(info.label, '가용 자바 라벨')
    assert.deepStrictEqual(info.env, {}, 'PATH 자바로 충분하면 환경을 바꾸지 않습니다')
  }

  // 4) 실제로 내려받아 풀어보기 (임시 폴더)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lubit-java-'))
  process.env.LUBIT_JAVA_DIR = temp
  try {
    const target = found && found.major >= 17 ? 8 : 17 // 이미 있는 버전을 피해서 받습니다
    const lines = []
    const home = await java.install(target, (line) => lines.push(line))
    const bin = java.javaBinary(home)
    assert.ok(bin, '압축을 푼 뒤 java 실행 파일이 있어야 합니다')

    const out = await new Promise((resolve) => {
      const { spawn } = require('node:child_process')
      let text = ''
      const child = spawn(bin, ['-version'], { windowsHide: true })
      child.stdout.on('data', (c) => (text += String(c)))
      child.stderr.on('data', (c) => (text += String(c)))
      child.on('exit', () => resolve(text))
    })
    const major = java.parseMajor(out)
    assert.strictEqual(major, target, `방금 받은 자바가 ${target} 이어야 합니다`)
    console.log(`· 자바 ${target} 내려받기 → 압축 풀기 → 실행 확인 (${lines[lines.length - 1]})`)

    // 5) java 로 시작하지 않는 명령은 건드리지 않습니다
    const untouched = await java.envFor({ javaCmd: 'node fake-server.js', mcVersion: '1.21.4' })
    assert.deepStrictEqual(untouched, {}, 'java 가 아닌 명령은 환경을 바꾸지 않습니다')
    console.log('· java 아닌 명령은 그대로 두는 것 통과')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }

  console.log('자바 자동 설치 검사 통과')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error.message)
    process.exit(1)
  })
