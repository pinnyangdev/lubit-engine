// 안드로이드 앱(루빗 콘솔)을 만들어 배포 폴더에 옮깁니다.
//   npm run apk
//
// 하는 일: cap sync(웹 자산 복사) → gradle assembleRelease → agent/release/*.apk 복사
// 필요한 것: JDK 21 이상, Android SDK(ANDROID_HOME 또는 %LOCALAPPDATA%\Android\Sdk)
// 서명은 android/keystore.properties 의 키를 씁니다.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

function run(command, args, env = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  // 윈도우는 npx/gradlew 가 .cmd 라 shell 로 돌려야 합니다.
  const windows = process.platform === 'win32'
  const safe = windows ? args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)) : args
  execFileSync(command, safe, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: windows,
  })
}

// JDK 21 이상을 찾습니다. (Capacitor 안드로이드 라이브러리가 source 21 을 씁니다)
function findJdk() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'javac.exe'))) {
    return process.env.JAVA_HOME
  }
  const candidates = []
  const roots = ['C:\\Program Files\\Java', join(process.env.LOCALAPPDATA ?? '', 'Java')]
  for (const dir of roots) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) candidates.push(join(dir, name))
  }
  const usable = candidates.filter((dir) => existsSync(join(dir, 'bin', 'javac.exe')))
  const modern = usable.filter((dir) => {
    const match = /jdk[-.]?(\d+)/i.exec(dir.split(/[\\/]/).pop() ?? '')
    return match && Number(match[1]) >= 21
  })
  if (modern.length === 0) {
    throw new Error('JDK 21 이상이 없습니다. JAVA_HOME 을 JDK 21+ 로 맞춰 주세요.')
  }
  // 최신 우선(25 → 21 순)
  modern.sort((a, b) => {
    const ver = (p) => Number(/jdk[-.]?(\d+)/i.exec(p.split(/[\\/]/).pop() ?? '')?.[1] ?? 0)
    return ver(b) - ver(a)
  })
  return modern[0]
}

function findSdk() {
  if (process.env.ANDROID_HOME && existsSync(process.env.ANDROID_HOME)) return process.env.ANDROID_HOME
  const local = join(root, 'local.properties')
  if (existsSync(local)) {
    const text = readFileSync(local, 'utf8')
    const match = /^sdk\.dir=(.+)$/m.exec(text)
    if (match) return match[1].replace(/\\\\/g, '\\')
  }
  const fallback = join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
  if (existsSync(fallback)) return fallback
  throw new Error('Android SDK 를 찾지 못했습니다. ANDROID_HOME 을 정해 주세요.')
}

const javaHome = findJdk()
const androidHome = findSdk()
console.log(`JDK  ${javaHome}\nSDK  ${androidHome}`)

// 1) 웹 자산과 capacitor.config 를 android 프로젝트에 반영합니다.
run('npx', ['cap', 'sync', 'android'])

// 2) 서명된 릴리스 APK 를 만듭니다.
const gradlew = process.platform === 'win32' ? join(root, 'android', 'gradlew.bat') : join(root, 'android', 'gradlew')
run(gradlew, ['-p', join(root, 'android'), 'assembleRelease'], {
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
})

// 3) 내려받기 목록에 올릴 이름으로 옮깁니다. (split-installer.mjs 가 *.apk 를 찾습니다)
const outputs = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release')
const apk = readdirSync(outputs).find((name) => name.endsWith('.apk'))
if (!apk) throw new Error('APK 를 찾지 못했습니다.')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const target = join(root, 'agent', 'release', `LubitConsole-${pkg.version}.apk`)
mkdirSync(dirname(target), { recursive: true })
copyFileSync(join(outputs, apk), target)

const mb = (statSync(target).size / 1024 / 1024).toFixed(1)
console.log(`APK 완성 → ${target} (${mb} MB)`)
