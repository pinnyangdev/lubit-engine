#!/usr/bin/env node
// 릴리스가 끝나면 디스코드로 패치노트를 올립니다.
//
//   node scripts/discord-notify.mjs
//
// - 주소는 .env 의 DISCORD_WEBHOOK 에만 둡니다. 코드에 적지 않습니다.
// - .env 가 없거나 값이 비어 있으면 조용히 건너뜁니다 — 릴리스 자체는 성공입니다.
// - 전송이 실패해도 릴리스는 이미 올라간 상태라 빨간 줄로만 알려 주고 0 으로 끝냅니다
//   (실패로 끝내면 스크립트 체인이 릴리스까지 실패한 것처럼 보입니다).
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

// .env 를 직접 읽습니다 — 이 저장소에는 dotenv 가 없고, 하나 받으려고 넣기도 아깝습니다.
function readEnvFile() {
  const path = join(root, '.env')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    out[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// 1) 환경변수를 먼저 — GitHub Actions 에서는 .env 가 gitignore 로 없으므로 Secret 을 씁니다.
// 2) 없으면 로컬 .env 로 떨어집니다.
const webhook = ((process.env.DISCORD_WEBHOOK ?? readEnvFile().DISCORD_WEBHOOK) ?? '').trim()
if (!webhook) {
  console.log('[디스코드] DISCORD_WEBHOOK 이 비어 있어 패치노트 전송을 건너뜁니다.')
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(join(root, 'agent', 'package.json'), 'utf8'))
const version = String(pkg.version ?? '0.0.0')

// 이번 버전 항목만 뽑습니다 — 다음 ## 항목이 나오면 거기서 끊습니다.
const notesPath = join(root, 'RELEASE_NOTES.md')
const notes = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : ''
const heading = `## ${version}`
const start = notes.indexOf(heading)
let section = ''
if (start !== -1) {
  const rest = notes.slice(start + heading.length)
  const next = rest.search(/\n## /)
  section = (next === -1 ? rest : rest.slice(0, next)).trim()
}
if (!section) section = '자세한 변경사항은 릴리스 페이지에서 확인해 주세요.'

// 디스코드 한도를 넘지 않도록 잘라 냅니다 (embed 설명은 4096자, 메시지 전체는 2000자).
const lines = section.split(/\r?\n/).filter(Boolean)
const preview = lines.slice(0, 10).join('\n')
const more = lines.length > 10 ? `\n\n… 그 외 ${lines.length - 10}줄 더` : ''
const description = (preview + more).slice(0, 1500)

const payload = {
  username: '루빗 릴리스',
  embeds: [
    {
      title: `루빗 ${version} 패치노트`,
      url: 'https://github.com/pinnyangdev/lubit-engine/releases/latest',
      description: description,
      color: 0x4ade80,
      footer: { text: 'Lubit Studios' },
    },
  ],
}

const response = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).catch(() => null)

if (!response || !response.ok) {
  const why = response ? `HTTP ${response.status}` : '네트워크 오류'
  console.warn(`[디스코드] 패치노트 전송 실패 — ${why} (릴리스는 그대로 유지됩니다)`)
  process.exit(0)
}

console.log(`[디스코드] ${version} 패치노트 전송 완료`)
