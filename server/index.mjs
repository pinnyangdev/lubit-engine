// Cloudflare Workers 에서 돌던 사이트를 일반 서버(VPS)에서 돌리는 진입점입니다.
//
//   node server/index.mjs            # 기본 8080
//   PORT=3000 node server/index.mjs
//
// 하는 일
//   1. 빌드 결과물(dist/lubit/index.js — 워커 번들)을 그대로 불러옵니다.
//   2. D1 대신 SQLite 파일, ASSETS 대신 dist/client 폴더로 갈아 끼웁니다.
//   3. .env(또는 .dev.vars) 값을 환경변수로 주입합니다.
//   4. Hono 앱을 Node HTTP 서버로 엽니다.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'

import { createAssets, createD1 } from './shims.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// --- 환경변수 ----------------------------------------------------------------
// .env 를 우선하고, 없으면 로컬 개발용 .dev.vars 를 씁니다. 값은 화면에 찍지 않습니다.
function loadVars() {
  const files = [path.join(root, '.env'), path.join(root, '.dev.vars')]
  const vars = {}
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim())
      if (match && match[2] !== '') vars[match[1]] = match[2].trim()
    }
    break // .env 가 있으면 그걸로 씁니다.
  }
  return vars
}

const vars = loadVars()
// 셸 환경변수가 우선이고, 없으면 .env 의 값을 씁니다.
const port = Number(process.env.PORT || vars.PORT) || 8080
const host = process.env.HOST || vars.HOST || '0.0.0.0'
const clientDir = path.join(root, 'dist', 'client')
const dbFile = process.env.LUBIT_DB || path.join(root, 'data', 'lubit.sqlite')

const bundle = path.join(root, 'dist', 'lubit', 'index.js')
if (!existsSync(bundle)) {
  console.error('워커 번들이 없습니다 — 먼저 `npm run build` 를 실행하세요.')
  process.exit(1)
}
if (!existsSync(clientDir)) {
  console.error('정적 파일이 없습니다 — 먼저 `npm run build` 를 실행하세요.')
  process.exit(1)
}

const { default: app } = await import(`file://${bundle}`)

// DB 폴더는 우리가 만듭니다. 스키마는 첫 요청에서 앱이 알아서 만듭니다.
await (async () => {
  const fs = await import('node:fs/promises')
  await fs.mkdir(path.dirname(dbFile), { recursive: true })
})()

const env = {
  ...vars,
  DB: createD1(dbFile),
  ASSETS: createAssets(clientDir),
  // 서비스 이름이 뿌리는 로그·안내에 쓰입니다.
  ORIGIN: vars.ORIGIN || 'https://lubit.kr',
}

serve(
  {
    // Hono 는 워커와 같은 fetch 시그니처를 씁니다. env 는 두 번째 인자로 넘깁니다.
    fetch: (request) => app.fetch(request, env),
    port,
    hostname: host,
  },
  (info) => {
    console.log(`루빗 사이트 서버 — http://localhost:${info.port}`)
    console.log(`  DB     ${dbFile}`)
    console.log(`  파일   ${clientDir}`)
    console.log(`  시크릿 ${Object.keys(vars).length}개`)
  },
)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n서버를 내립니다.')
    process.exit(0)
  })
}
