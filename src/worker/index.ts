import { Hono } from 'hono'

import { engine, ensureEngine } from './engine'

// The Worker in front of the static site. API routes are handled here;
// everything else falls through to the built assets (SPA mode).
export type Env = {
  ASSETS: Fetcher
  DB: D1Database
  // 서버 백업 저장소 — 데스크톱 앱이 만든 zip 을 보관합니다 (없으면 클라우드 백업만 꺼집니다).
  BACKUPS?: R2Bucket
  DISCORD_WEBHOOK_URL?: string
  DISCORD_CLIENT_ID?: string
  DISCORD_CLIENT_SECRET?: string
  // 구글 로그인 (선택) — 넣으면 웹·앱의 구글 버튼이 열립니다.
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  INBOX_TOKEN?: string
  // 서버 구동기 — 도메인 자동 등록(Cloudflare DNS)과 중계 서버 접속 정보
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ZONE_ID?: string
  RELAY_HOST?: string
  RELAY_IP?: string
  RELAY_CONTROL_PORT?: string
}

type ServerStatus = {
  host: string
  online: boolean
  resolved: boolean
  playersOnline: number | null
  playersMax: number | null
  version: string | null
  motd: string | null
  retrievedAt: number | null
  checkedAt: number
}

// <host> or <host>:<port>, no paths or query strings.
const HOST_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?(?::\d{1,5})?$/
const SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function offlineStatus(host: string): ServerStatus {
  return {
    host,
    online: false,
    resolved: false,
    playersOnline: null,
    playersMax: null,
    version: null,
    motd: null,
    retrievedAt: null,
    checkedAt: Date.now(),
  }
}

// Created on first use so a fresh clone works without a migration step.
let schemaReady = false
const schema = [
  `CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages (session_id, id)`,
]
async function ensureSchema(db: D1Database) {
  if (schemaReady) return
  // D1 의 exec 는 여러 문장을 한 번에 넘기면 첫 문장만 자르므로 순차 실행합니다.
  for (const sql of schema) {
    await db.prepare(sql).run()
  }
  schemaReady = true
}

// Delivers to the studio's own Discord channel through a webhook — no third
// party sits between the form and the person reading it.
async function notifyDiscord(
  env: Env,
  title: string,
  fields: { name: string; value: string; inline?: boolean }[],
) {
  if (!env.DISCORD_WEBHOOK_URL) return false
  try {
    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'lubit 사이트',
        embeds: [{ title, color: 0x4ade80, fields, timestamp: new Date().toISOString() }],
      }),
    })
    return response.ok
  } catch {
    return false
  }
}

const app = new Hono<{ Bindings: Env }>()

// 주소창에 lubit.kr 을 치면 http 로 먼저 요청이 갑니다. 배포 주소는 항상
// https 로 올라가도록 301 로 보냅니다. (로컬 개발 서버는 http 이므로 제외)
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  const isLocal =
    url.hostname === 'localhost' || url.hostname.startsWith('127.') || url.hostname === '[::1]'
  if (url.protocol === 'http:' && !isLocal) {
    url.protocol = 'https:'
    return c.redirect(url.toString(), 301)
  }
  return next()
})

app.get('/api/health', (c) => c.json({ ok: true }))

// 변경점 — GitHub 공개 릴리스를 받아 10분간 캐시합니다.
// 릴리스가 나올 때마다 사이트를 다시 배포할 필요가 없습니다.
app.get('/api/changelog', async (c) => {
  // 타입 정의에는 없지만 런타им에는 있는 기본 캐시입니다 — 쓸 수 없으면 그냥 받습니다.
  // 로컬에서 node 로 돌릴 때는 caches 전역 자체가 없으므로 typeof 로 먼저 확인합니다.
  // 캐시가 없으면 캐시만 빼고 받아오면 되고, 코드가 죽으면 안 됩니다.
  const cache =
    typeof caches === 'undefined' ? undefined : (caches as unknown as { default?: Cache }).default
  const key = new Request('https://lubit.kr/api/changelog')
  try {
    const hit = await cache?.match(key)
    if (hit) return hit
  } catch {
    /* 캐시를 못 쓰면 그냥 받아옵니다 */
  }

  try {
    const response = await fetch('https://api.github.com/repos/pinnyangdev/lubit-engine/releases?per_page=15', {
      headers: { 'User-Agent': 'lubit-site', Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(String(response.status))
    const data = (await response.json()) as Array<{
      tag_name: string
      name: string
      published_at: string
      html_url: string
      body: string
      draft: boolean
      prerelease: boolean
    }>
    const releases = data
      .filter((item) => !item.draft)
      .slice(0, 15)
      .map((item) => ({
        tag: item.tag_name,
        name: item.name || item.tag_name,
        publishedAt: item.published_at,
        url: item.html_url,
        body: (item.body || '').slice(0, 6000),
      }))
    const result = c.json({ releases })
    result.headers.set('Cache-Control', 'public, max-age=600')
    try {
      await cache?.put(key, result.clone())
    } catch {
      /* 캐시 쓰기 실패는 답을 그대로 보냅니다 */
    }
    return result
  } catch {
    // 잠시 받지 못해도 페이지는 빈 목록으로 그대로 그립니다.
    return c.json({ releases: [], error: '일시적으로 변경점을 받지 못했습니다.' })
  }
})

// 서버 구동기(엔진) API — 웹 대시보드와 데스크톱 에이전트가 공통으로 씁니다.
app.route('/api/engine', engine)

// ---------------------------------------------------------------------------
// Live Minecraft server status
// ---------------------------------------------------------------------------

app.get('/api/server-status', async (c) => {
  const host = (c.req.query('host') ?? '').trim()
  if (!host || !HOST_RE.test(host)) return c.json({ error: 'Invalid server address.' }, 400)

  c.header('Cache-Control', 'public, max-age=30')

  try {
    const upstream = await fetch(
      `https://api.mcstatus.io/v2/status/java/${encodeURIComponent(host)}?query=false&timeout=4`,
      { headers: { 'User-Agent': 'lubit-site/1.0' } },
    )
    if (!upstream.ok) return c.json(offlineStatus(host))

    const data = (await upstream.json()) as {
      online?: boolean
      ip_address?: string | null
      players?: { online?: number; max?: number }
      version?: { name_clean?: string }
      motd?: { clean?: string }
      retrieved_at?: number
    }

    const status: ServerStatus = {
      host,
      online: Boolean(data.online),
      // A null address means the hostname does not resolve yet, which is a
      // different problem from a server that is simply switched off.
      resolved: Boolean(data.ip_address),
      playersOnline: data.players?.online ?? null,
      playersMax: data.players?.max ?? null,
      version: data.version?.name_clean ?? null,
      motd: data.motd?.clean ?? null,
      retrievedAt: data.retrieved_at ?? null,
      checkedAt: Date.now(),
    }
    return c.json(status)
  } catch {
    return c.json(offlineStatus(host), 502)
  }
})

// ---------------------------------------------------------------------------
// 문의 폼 → D1 보관 + 디스코드 채널로 즉시 전달
// ---------------------------------------------------------------------------

app.post('/api/contact', async (c) => {
  const body = await c.req
    .json<{ name?: string; email?: string; message?: string }>()
    .catch(() => ({}) as { name?: string; email?: string; message?: string })
  const name = (body.name ?? '').trim().slice(0, 80)
  const email = (body.email ?? '').trim().slice(0, 200)
  const message = (body.message ?? '').trim().slice(0, 4000)

  if (!name || !EMAIL_RE.test(email) || !message) {
    return c.json({ error: '이름, 이메일, 내용을 모두 입력해 주세요.' }, 400)
  }

  await ensureSchema(c.env.DB)
  await c.env.DB.prepare(
    'INSERT INTO contact_messages (name, email, message, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(name, email, message, Date.now())
    .run()

  const notified = await notifyDiscord(c.env, '새 문의가 접수되었습니다', [
    { name: '이름', value: name, inline: true },
    { name: '이메일', value: email, inline: true },
    { name: '내용', value: message.slice(0, 1000) },
  ])

  return c.json({ ok: true, notified })
})

// ---------------------------------------------------------------------------
// 실시간 채팅: 방문자 → D1 → 관리자 수신함
// ---------------------------------------------------------------------------

app.post('/api/chat', async (c) => {
  const body = await c.req
    .json<{ sessionId?: string; name?: string; body?: string }>()
    .catch(() => ({}) as { sessionId?: string; name?: string; body?: string })
  const sessionId = (body.sessionId ?? '').trim()
  const name = (body.name ?? '').trim().slice(0, 60)
  const text = (body.body ?? '').trim().slice(0, 2000)

  if (!SESSION_RE.test(sessionId)) return c.json({ error: '채팅 세션이 올바르지 않습니다.' }, 400)
  if (!text) return c.json({ error: '내용을 입력해 주세요.' }, 400)

  await ensureSchema(c.env.DB)
  const existing = await c.env.DB.prepare('SELECT 1 FROM chat_messages WHERE session_id = ? LIMIT 1')
    .bind(sessionId)
    .first()

  await c.env.DB.prepare(
    'INSERT INTO chat_messages (session_id, name, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(sessionId, name, 'visitor', text, Date.now())
    .run()

  // 알림은 대화 첫 메시지에 한 번만 보냅니다.
  if (!existing) {
    await notifyDiscord(c.env, '새 채팅 문의가 시작되었습니다', [
      { name: '세션', value: sessionId, inline: true },
      ...(name ? [{ name: '이름', value: name, inline: true }] : []),
      { name: '내용', value: text.slice(0, 900) },
    ])
  }

  return c.json({ ok: true })
})

app.get('/api/chat', async (c) => {
  const session = (c.req.query('session') ?? '').trim()
  if (!SESSION_RE.test(session)) return c.json({ error: '채팅 세션이 올바르지 않습니다.' }, 400)

  await ensureSchema(c.env.DB)
  const rows = await c.env.DB.prepare(
    'SELECT id, role, body, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 200',
  )
    .bind(session)
    .all()

  return c.json({ messages: rows.results })
})

// ---------------------------------------------------------------------------
// 관리자 수신함 — INBOX_TOKEN 이 없으면 열리지 않습니다.
// ---------------------------------------------------------------------------

function authed(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const token = c.env.INBOX_TOKEN
  if (!token) return false
  return c.req.header('Authorization') === `Bearer ${token}`
}

// ---------------------------------------------------------------------------
// 관리자 대시보드 — 서버 · 회원 현황. 수신함과 같은 INBOX_TOKEN 으로만 엽니다.
// ---------------------------------------------------------------------------

app.get('/api/admin/stats', async (c) => {
  if (!authed(c)) return c.json({ error: 'Unauthorized.' }, c.env.INBOX_TOKEN ? 401 : 403)

  // 엔진 테이블은 아직 한 번도 만들어지지 않았을 수 있습니다 — 없으면 먼저 만듭니다.
  await ensureSchema(c.env.DB)
  await ensureEngine(c.env.DB)

  const count = async (sql: string) => {
    const row = await c.env.DB.prepare(sql).first<{ n: number }>()
    return Number(row?.n ?? 0)
  }

  const [servers, running, users, admins, domains, inquiries] = await Promise.all([
    count('SELECT COUNT(*) AS n FROM engine_servers'),
    count("SELECT COUNT(*) AS n FROM engine_servers WHERE state = 'running'"),
    count('SELECT COUNT(*) AS n FROM engine_users'),
    count('SELECT COUNT(*) AS n FROM engine_admins'),
    count("SELECT COUNT(*) AS n FROM engine_servers WHERE domain IS NOT NULL AND domain <> ''"),
    count('SELECT COUNT(DISTINCT session_id) AS n FROM chat_messages'),
  ])

  return c.json({ servers, running, users, admins, domains, inquiries })
})

app.get('/api/inbox', async (c) => {
  if (!authed(c)) return c.json({ error: 'Unauthorized.' }, c.env.INBOX_TOKEN ? 401 : 403)

  await ensureSchema(c.env.DB)
  const rows = await c.env.DB.prepare(
    `SELECT m.session_id AS sessionId,
            m.body AS lastBody,
            m.role AS lastRole,
            m.created_at AS updated,
            (SELECT COUNT(*) FROM chat_messages x WHERE x.session_id = m.session_id AND x.role = 'visitor') AS visitorCount,
            (SELECT COUNT(*) FROM chat_messages x WHERE x.session_id = m.session_id AND x.role = 'agent') AS agentCount,
            (SELECT name FROM chat_messages x WHERE x.session_id = m.session_id AND x.name <> '' ORDER BY id DESC LIMIT 1) AS name
     FROM chat_messages m
     WHERE m.id IN (SELECT MAX(id) FROM chat_messages GROUP BY session_id)
     ORDER BY m.created_at DESC
     LIMIT 100`,
  ).all()

  return c.json({ sessions: rows.results })
})

app.get('/api/inbox/:session', async (c) => {
  if (!authed(c)) return c.json({ error: 'Unauthorized.' }, c.env.INBOX_TOKEN ? 401 : 403)

  const session = c.req.param('session')
  if (!SESSION_RE.test(session)) return c.json({ error: 'Invalid session.' }, 400)

  await ensureSchema(c.env.DB)
  const rows = await c.env.DB.prepare(
    'SELECT id, role, body, created_at FROM chat_messages WHERE session_id = ? ORDER BY id ASC LIMIT 500',
  )
    .bind(session)
    .all()

  return c.json({ messages: rows.results })
})

app.post('/api/inbox/:session/reply', async (c) => {
  if (!authed(c)) return c.json({ error: 'Unauthorized.' }, c.env.INBOX_TOKEN ? 401 : 403)

  const session = c.req.param('session')
  if (!SESSION_RE.test(session)) return c.json({ error: 'Invalid session.' }, 400)

  const body = await c.req.json<{ body?: string }>().catch(() => ({}) as { body?: string })
  const text = (body.body ?? '').trim().slice(0, 2000)
  if (!text) return c.json({ error: '내용을 입력해 주세요.' }, 400)

  await ensureSchema(c.env.DB)
  await c.env.DB.prepare(
    'INSERT INTO chat_messages (session_id, name, role, body, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(session, '', 'agent', text, Date.now())
    .run()

  return c.json({ ok: true })
})

// ---------------------------------------------------------------------------
// 배포 파일 다운로드 (윈도우 설치판 · APK · IPA)
//
// 설치 파일(~87MB)은 Workers 정적 자산의 파일당 25MiB 한도를 넘으므로 빌드 시
// 20MiB 청크로 쪼개집니다. 여기서는 키(engine · android · ios)에 맞는 매니페스트를
// 읽어 청크를 순서대로 이어 붙여 하나의 파일로 내려보냅니다. 한꺼번에 메모리에
// 올리지 않고, 보낼 때마다 다음 조각을 받아 오므로 큰 파일도 안정적입니다.
// ---------------------------------------------------------------------------

type DownloadPart = { path: string; size: number }
type DownloadManifest = { filename: string; version?: string; size: number; sha256: string; parts: DownloadPart[] }

const DOWNLOAD_KEY_RE = /^[a-z0-9-]{1,32}$/

app.on(['GET', 'HEAD'], '/download/:key', async (c) => {
  const key = c.req.param('key') ?? ''
  // 플랫폼 목록은 크기가 작으니 정적 자산으로 그냥 넘깁니다.
  if (key === 'manifest.json') return c.env.ASSETS.fetch(c.req.raw)
  if (!DOWNLOAD_KEY_RE.test(key)) return c.text('찾을 수 없는 파일입니다.', 404)

  const origin = new URL(c.req.url).origin
  const manifestRes = await c.env.ASSETS.fetch(new URL(`/download/${key}/manifest.json`, origin).toString())
  if (!manifestRes.ok) return c.text('아직 준비되지 않은 파일입니다.', 404)

  // 자산이 없는 경로도 SPA 폴백으로 200 + HTML 을 돌려주므로 JSON 이 아닌
  // 경우를 따로 잡아야 합니다.
  let manifest: DownloadManifest
  try {
    manifest = (await manifestRes.json()) as DownloadManifest
  } catch {
    return c.text('아직 준비되지 않은 파일입니다.', 404)
  }
  if (!manifest.parts?.length || !manifest.size) return c.text('아직 준비되지 않은 파일입니다.', 404)

  const headers = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(manifest.size),
    'Content-Disposition': `attachment; filename="${manifest.filename}"`,
    'Cache-Control': 'public, max-age=300',
    'X-Checksum-Sha256': manifest.sha256,
  }
  if (c.req.method === 'HEAD') return new Response(null, { headers })

  let index = 0
  let total = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          if (reader) {
            const { done, value } = await reader.read()
            if (!done) {
              total += value.length
              controller.enqueue(value)
              return
            }
            reader = null
          }
          if (index >= manifest.parts.length) {
            // 클라이언트가 받은 양과 다르면 전달 구간에서 끊긴 것입니다.
            console.log(`[download] ${key} close total=${total} expected=${manifest.size}`)
            controller.close()
            return
          }
          const part = manifest.parts[index++]
          const res = await c.env.ASSETS.fetch(new URL(`/download/${key}/${part.path}`, origin).toString())
          if (!res.ok || !res.body) throw new Error(`missing part: ${part.path}`)
          reader = res.body.getReader()
        }
      } catch (err) {
        console.log(`[download] ${key} error after ${total} bytes: ${String(err)}`)
        controller.error(err)
      }
    },
    async cancel() {
      if (reader) await reader.cancel().catch(() => undefined)
    },
  })

  return new Response(body, { headers })
})

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
