// Cloudflare D1 에서 내보낸 SQL 을 이 서버가 쓰는 SQLite 파일로 옮깁니다.
//
//   npx wrangler d1 export lubit --remote --output=data/d1-export.sql
//   node server/import-d1.mjs data/d1-export.sql            # data/lubit.sqlite
//   node server/import-d1.mjs data/d1-export.sql 경로.sqlite
//
// 이미 데이터가 있는 파일에는 덮어쓰지 않습니다. 확실히 갈아타야 할 때만 --force.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter((arg) => arg !== '--force')
const force = process.argv.includes('--force')

const source = args[0] ? path.resolve(args[0]) : path.join(root, 'data', 'd1-export.sql')
const target = args[1] ? path.resolve(args[1]) : path.join(root, 'data', 'lubit.sqlite')

if (!existsSync(source)) {
  console.error(`내보낸 SQL 이 없습니다: ${source}`)
  console.error('먼저 `npx wrangler d1 export lubit --remote --output=data/d1-export.sql`')
  process.exit(1)
}

if (existsSync(target) && statSync(target).size > 0 && !force) {
  console.error(`이미 데이터가 있습니다: ${target}`)
  console.error('그대로 두고 싶으면 경로를 바꾸고, 덮어쓸 거면 --force 를 붙이세요.')
  process.exit(1)
}

mkdirSync(path.dirname(target), { recursive: true })

const { readFileSync } = await import('node:fs')
const sql = readFileSync(source, 'utf8')

const db = new DatabaseSync(target)
db.exec('PRAGMA journal_mode = WAL')

try {
  db.exec(sql)
} catch (error) {
  console.error('이전 중 오류:', error.message)
  console.error('파일을 지우고 다시 시도하세요.')
  process.exit(1)
}

// 결과를 숫자로 확인합니다.
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()

console.log(`이전 완료 → ${target}`)
for (const { name } of tables) {
  const [{ count }] = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).all()
  console.log(`  ${name.padEnd(20)} ${String(count).padStart(6)}행`)
}
db.close()
