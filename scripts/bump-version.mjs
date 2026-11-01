// 수정할 때마다 버전이 같은 0.1.0 으로 남아 무엇이 바뀌었는지 구분이 안 되므로,
// 배포 전에 patch 버전을 올립니다.
//
//   node scripts/bump-version.mjs          # 0.1.0 → 0.1.1
//   node scripts/bump-version.mjs 0.2.0    # 직접 지정
//
// 설치판 파일명(LubitServerEngine-Setup-<버전>.exe)과 다운로드 창에 보이는
// 버전은 agent/package.json 을 그대로 쓰므로 여기만 올려도 전부 따라옵니다.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const files = ['agent/package.json', 'package.json']

function bump(version, explicit) {
  if (explicit) return explicit
  const [major = 0, minor = 0, patch = 0] = String(version).split('.').map((n) => Number(n) || 0)
  return `${major}.${minor}.${patch + 1}`
}

let next = process.argv[2] || ''
for (const file of files) {
  const path = `${root}${file.replace(/\//g, '\\')}`
  const data = JSON.parse(readFileSync(path, 'utf8'))
  next = bump(data.version, next)
  data.version = next
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`)
  console.log(`> ${file}: ${data.version}`)
}

console.log(`\n새 버전 ${next} — 이제 설치판을 다시 빌드하면 파일명과 다운로드 창에 이 버전이 표시됩니다.`)
