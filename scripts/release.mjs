// 릴리스를 올릴 때마다 README.md 에 변경사항을 자동으로 적어 주는 준비 단계.
//
//   agent/ 에서  npm run release   (이 파일 → smoke → electron-builder --publish always)
//
// 하는 일
//   1. RELEASE_NOTES.md 에서 이번 버전(## x.y.z) 항목을 찾는다 — 없으면 멈춘다.
//   2. README.md 의 업데이트 내역 마커 사이에 그 항목을 최신으로 넣는다.
//   3. 같은 항목을 agent/build/release-notes.md 에 써서 GitHub 릴리스 본문으로 쓴다.
//      (electron-builder 가 이 파일을 기본으로 찾으므로 인자가 필요 없다.)
//
// git 커밋이 없어 변경사항을 자동으로 뽑을 수 없으므로, 원본은 RELEASE_NOTES.md 이다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const agentDir = join(root, 'agent')
const notesPath = join(root, 'RELEASE_NOTES.md')
const readmePath = join(root, 'README.md')
const releaseNotesPath = join(agentDir, 'build', 'release-notes.md')

const START = '<!-- lubit-changelog:start -->'
const END = '<!-- lubit-changelog:end -->'

function fail(message) {
  console.error(`\n[릴리스] ${message}\n`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(agentDir, 'package.json'), 'utf8'))
const version = pkg.version
if (!version) fail('agent/package.json 에 version 이 없습니다.')

// --- 1) 이번 버전 항목 ------------------------------------------------------
if (!existsSync(notesPath)) fail('RELEASE_NOTES.md 가 없습니다.')
const notes = readFileSync(notesPath, 'utf8')
const heading = `## ${version}`
const lines = notes.split(/\r?\n/)
const start = lines.findIndex((line) => line.trim() === heading)
if (start === -1) {
  fail(`RELEASE_NOTES.md 에 "${heading}" 항목이 없습니다 — 버전 내용을 먼저 적어 주세요.`)
}

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s+\d+\.\d+\.\d+/.test(lines[i])) {
    end = i
    break
  }
}
const section = lines.slice(start, end).join('\n').replace(/\s+$/, '')
const bullets = section
  .split(/\r?\n/)
  .filter((line) => /^\s*[-*]\s+/.test(line))
if (bullets.length === 0) fail(`"${heading}" 항목에 변경사항이 없습니다.`)

// --- 2) README 업데이트 내역 ------------------------------------------------
let readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
if (!readme.includes(START) || !readme.includes(END)) {
  readme = `${readme.replace(/\s+$/, '')}

## 업데이트 내역

릴리스를 올릴 때마다 \`RELEASE_NOTES.md\` 에서 자동으로 기록됩니다.

${START}
${END}
`
}

if (readme.includes(`### ${version}`)) {
  console.log(`[릴리스] README.md — ${version} 항목이 이미 있어 그대로 둡니다.`)
} else {
  const date = new Date().toISOString().slice(0, 10)
  const body = section.replace(/^##[^\n]*\n/, '').trim()
  const entry = `### ${version} — ${date}\n\n${body}`
  // 최신 항목이 위에 오도록 마커 바로 다음에 넣는다.
  readme = readme.replace(START, `${START}\n\n${entry}\n`)
  writeFileSync(readmePath, readme)
  console.log(`[릴리스] README.md — ${version} 항목을 기록했습니다.`)
}

// --- 3) GitHub 릴리스 본문 --------------------------------------------------
mkdirSync(dirname(releaseNotesPath), { recursive: true })
writeFileSync(releaseNotesPath, `${section}\n`)
console.log('[릴리스] 릴리스 노트 — agent/build/release-notes.md')
