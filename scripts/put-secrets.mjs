// .dev.vars 에 적어둔 값을 운영 워커 시크릿으로 옮깁니다. 값이 화면에 찍히지 않습니다.
//   node scripts/put-secrets.mjs DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET
//
// .dev.vars (gitignore 됨) 에 키=값 으로 적어 두고 실행하면 됩니다.
// 올릴 키를 명시하지 않으면 올릴 수 있는 키 목록만 보여줍니다.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const varsFile = `${root}.dev.vars`

if (!existsSync(varsFile)) {
  console.error('.dev.vars 가 없습니다. .dev.vars.example 을 복사해 값을 적어 주세요.')
  process.exit(1)
}

// 줄별로 읽습니다. 값에 # 이 들어갈 수 있어 첫 번째 = 만 기준으로 쪼갭니다.
const values = {}
for (const line of readFileSync(varsFile, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
  // 실수로 들어간 앞뒤 공백은 잘라냅니다. 토큰에는 공백이 없으므로 안전합니다.
  if (match) values[match[1]] = match[2].trim()
}

const wanted = process.argv.slice(2)
if (wanted.length === 0) {
  const filled = Object.keys(values).filter((key) => values[key].length > 0)
  console.log('사용법: node scripts/put-secrets.mjs <키> [<키> ...]')
  console.log(`\n.dev.vars 에 값이 들어 있는 키: ${filled.length ? filled.join(', ') : '(없음)'}`)
  process.exit(0)
}

const missing = wanted.filter((key) => !values[key])
if (missing.length) {
  console.error(`.dev.vars 에 값이 없는 키: ${missing.join(', ')}`)
  console.error('.dev.vars 에서 해당 줄의 = 뒤에 값을 적어 주세요.')
  process.exit(1)
}

for (const key of wanted) {
  console.log(`> wrangler secret put ${key}`)
  execFileSync('npx', ['wrangler', 'secret', 'put', key], {
    cwd: root,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    input: values[key],
    env: process.env,
  })
}
console.log('시크릿 반영 완료 — 새 배포부터 적용됩니다.')
