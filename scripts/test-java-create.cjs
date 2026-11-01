// 자바가 없는 환경에서 서버를 실제로 만들어 봅니다.
//   node scripts/test-java-create.cjs
//
// PATH 에서 자바만 가린 뒤(시스템 자바를 못 찾게) 1.20.4 서버를 만듭니다.
// 자바 17 을 자동으로 받아야 하고, 받아야 하는 타이밍에 진행 알림이 떠야 합니다.
// 서버 jar 내려받기(~48MB)와 자바(~45MB) 내려받기가 한 번씩 일어납니다.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const java = require('../agent/java')

async function main() {
  const savedPath = process.env.PATH
  const savedJavaDir = process.env.LUBIT_JAVA_DIR
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lubit-create-'))
  const javaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lubit-jv-'))
  process.env.LUBIT_JAVA_DIR = javaDir
  // 자바 실행 파일이 들어 있는 폴더만 제거합니다. (powershell 등은 남아 있어야 합니다)
  process.env.PATH = savedPath
    .split(path.delimiter)
    .filter((entry) => !/java|jdk|jre/i.test(entry))
    .join(path.delimiter)

  try {
    const gone = await java.detect()
    assert.strictEqual(gone, null, `자바를 가려야 하는데 남아 있습니다: ${gone && gone.label}`)

    const steps = []
    const result = await require('../agent/provision').createServer({
      root,
      name: '자바 검증',
      type: 'vanilla',
      version: '1.20.4',
      memoryMb: 1024,
      port: 25599,
      eula: true,
      onProgress: (step, line) => steps.push(`${step}: ${line}`),
    })

    // 1) 자바 17 이 앱 전용 폴더에 받아졌는지
    const home = java.managedHome(17)
    const bin = java.javaBinary(home)
    assert.ok(bin, `자바 17 설치 폴더가 없습니다: ${home}`)
    console.log(`· 자바 17 자동 설치 → ${home}`)

    // 2) 진행 알림이 실제로 화면에 갔는지
    const javaSteps = steps.filter((line) => line.startsWith('java: '))
    assert.ok(javaSteps.length >= 2, `자바 진행 알림이 없습니다: ${JSON.stringify(javaSteps)}`)
    console.log(`· 진행 알림 ${javaSteps.length}건 (첫 줄: ${javaSteps[0]})`)

    // 3) 서버 파일과 실행 명령
    assert.ok(fs.existsSync(path.join(result.dir, 'eula.txt')), 'eula.txt')
    assert.ok(fs.existsSync(path.join(result.dir, result.javaCmd.split(' ')[4])), '서버 jar')
    assert.match(result.javaCmd, /^java -Xmx1024M/, '실행 명령')
    assert.strictEqual(result.version, '1.20.4')
    console.log(`· 서버 준비 ${result.dir}`)
    console.log(`· 실행 명령 ${result.javaCmd}`)

    // 4) 그 명령으로 자바 환경을 받으면 방금 설치된 자바가 나와야 합니다
    const env = await java.envFor({
      javaCmd: result.javaCmd,
      mcVersion: result.version,
      type: result.type,
    })
    assert.ok(env.JAVA_HOME, 'JAVA_HOME 이 잡혀야 합니다')
    assert.ok(env.PATH.startsWith(path.dirname(bin)), 'PATH 맨 앞에 방금 설치된 자바가 와야 합니다')
    console.log(`· 실행 환경 JAVA_HOME=${env.JAVA_HOME}`)

    console.log('자바 자동 설치 — 서버 생성 검사 통과')
  } finally {
    process.env.PATH = savedPath
    if (savedJavaDir === undefined) delete process.env.LUBIT_JAVA_DIR
    else process.env.LUBIT_JAVA_DIR = savedJavaDir
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(javaDir, { recursive: true, force: true })
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('실패:', error.message)
    process.exit(1)
  })
