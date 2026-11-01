// 클라우드플레어 전용 두 가지 — D1 과 ASSETS — 을 일반 Node 환경에서
// 똑같이 동작하는 형태로 대신합니다.
//
//   createD1(file)      → c.env.DB      (prepare().bind().first/all/run)
//   createAssets(dir)   → c.env.ASSETS  (fetch(request))
//
// 코드는 그대로 쓰고, 바깥 표면만 맞추기 때문에 웹/API 동작은 워커와 동일합니다.
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'

// --- D1 ---------------------------------------------------------------------

// D1 은 boolean/undefined 를 받아 주지만 SQLite 는 받지 않습니다.
function normalize(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  return value
}

class Statement {
  constructor(db, sql, params = []) {
    this.db = db
    this.sql = sql
    this.params = params
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params.map(normalize))
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params)
    if (row === undefined) return null
    return column === undefined ? row : (row[column] ?? null)
  }

  async all() {
    const started = Date.now()
    const results = this.db.prepare(this.sql).all(...this.params)
    return {
      results,
      success: true,
      meta: {
        duration: Date.now() - started,
        rows_read: results.length,
        rows_written: 0,
        last_row_id: 0,
        changes: 0,
      },
    }
  }

  async run() {
    const started = Date.now()
    const info = this.db.prepare(this.sql).run(...this.params)
    return {
      success: true,
      meta: {
        duration: Date.now() - started,
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
        rows_read: 0,
        rows_written: Number(info.changes),
      },
    }
  }
}

export function createD1(file) {
  const db = new DatabaseSync(file)
  // WAL 은 읽기/쓰기가 동시에 일어나는 우리 쓰임에 가장 안정적입니다.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  return {
    prepare: (sql) => new Statement(db, sql),
    batch: async (statements) => Promise.all(statements.map((statement) => statement.all())),
    exec: async (sql) => {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
    close: () => db.close(),
  }
}

// --- ASSETS -----------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream',
  '.exe': 'application/octet-stream',
}

function typeOf(file) {
  return TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

export function createAssets(root) {
  const base = path.resolve(root)

  const resolve = (pathname) => {
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '')
    const file = path.resolve(base, rel)
    // 폴더 밖으로 나가지 못하게 합니다. (/../../etc 같은 요청)
    return file === base || file.startsWith(base + path.sep) ? file : null
  }

  return {
    async fetch(request) {
      // Workers 의 ASSETS.fetch 는 문자열 URL 과 Request 를 모두 받습니다.
      const href = typeof request === 'string' ? request : request.url
      const method = typeof request === 'string' ? 'GET' : request.method
      const url = new URL(href)
      let file = resolve(url.pathname)

      if (!file) return new Response('Forbidden', { status: 403 })

      // 디렉터리면 index.html 로, 확장자가 없는 경로는 SPA 가로채기로 처리합니다.
      if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
      if (!existsSync(file) && !path.extname(file)) file = path.join(base, 'index.html')
      if (!existsSync(file)) return new Response('Not Found', { status: 404 })

      const stat = statSync(file)
      const headers = {
        'Content-Type': typeOf(file),
        'Content-Length': String(stat.size),
        // 해시가 붙은 자산은 오래 캐시, 그 외는 항상 다시 받도록 합니다.
        'Cache-Control': /\/assets\//.test(url.pathname)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      }

      if (method === 'HEAD') return new Response(null, { status: 200, headers })
      return new Response(Readable.toWeb(createReadStream(file)), { status: 200, headers })
    },
  }
}
