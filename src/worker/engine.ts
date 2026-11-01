import { Hono } from 'hono'

import type { Env } from './index'

// ---------------------------------------------------------------------------
// 서버 구동기(엔진) 백엔드
//
// 구조: 웹 대시보드와 데스크톱 에이전트가 전부 lubit.kr 하나를 통과합니다.
//   - 에이전트는 "밖에 나가는" HTTP 폴링만 합니다 → 포트포워딩·터널 불필요
//   - 대시보드는 같은 API를 씁니다 → 웹·데스크톱·모바일이 상태가 같습니다
// 1차는 폴링으로 갑니다. WebSocket 릴레이는 2차에서 올립니다.
// ---------------------------------------------------------------------------

const enc = new TextEncoder()

type UserRow = { id: number; email: string; password_hash: string; display_name: string }
type SessionUser = { id: number; email: string; display_name: string }
type DeviceRow = { id: string; user_id: number; name: string; token_hash: string }

let engineReady = false
const engineSchema = [
  `CREATE TABLE IF NOT EXISTS engine_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    discord_id TEXT,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engine_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engine_devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    last_seen INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS engine_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    name TEXT NOT NULL,
    java_cmd TEXT NOT NULL DEFAULT '',
    server_dir TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'offline',
    players INTEGER,
    max_players INTEGER,
    last_error TEXT,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engine_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    args TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created_at INTEGER NOT NULL,
    done_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engine_cmd ON engine_commands (server_id, id)`,
  `CREATE TABLE IF NOT EXISTS engine_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    line TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engine_log ON engine_logs (server_id, id)`,
  // 에이전트가 그려 보낸 월드 지도 PNG. D1 한도 안에서 한 서버 한 장만 답니다.
  `CREATE TABLE IF NOT EXISTS engine_maps (
    server_id INTEGER PRIMARY KEY,
    world TEXT NOT NULL DEFAULT 'world',
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    png TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  // 서버를 함께 관리하는 사람 — 이메일로 등록하고, 등록된 사람은 그 서버를 함께 만집니다.
  `CREATE TABLE IF NOT EXISTS engine_admins (
    server_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    added_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (server_id, email)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engine_admins_email ON engine_admins (email)`,
  // 클라우드 백업 — 데스크톱 앱이 만든 zip 을 R2 에 두고 목록만 D1 에 남깁니다.
  `CREATE TABLE IF NOT EXISTS engine_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    object_key TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_engine_backup_server ON engine_backups (server_id, id)`,
]

// 서버를 만드는 곳(데스크톱 앱)에서 채우는 정보. 기존 행은 비어 있을 수 있습니다.
const serverColumns: [string, string][] = [
  ['mc_version', 'TEXT'],
  ['server_type', 'TEXT'],
  ['memory_mb', 'INTEGER'],
  ['port', 'INTEGER'],
  // 접속 중인 플레이어 이름(에이전트가 로그에서 읽어 올림)
  ['player_names', 'TEXT'],
  // 중계 서버에 배정된 공인 포트와 붙인 도메인
  ['relay_port', 'INTEGER'],
  ['domain', 'TEXT'],
]

// 계정 표에 나중에 붙인 컬럼. 이미 있는 표에는 CREATE 가 적용되지 않으므로 추가해 줍니다.
const userColumns: [string, string][] = [
  ['discord_id', 'TEXT'],
  // 구글로 로그인한 사람을 같은 계정에 붙이기 위한 값
  ['google_id', 'TEXT'],
]

export async function ensureEngine(db: D1Database) {
  if (engineReady) return
  for (const sql of engineSchema) await db.prepare(sql).run()

  // CREATE TABLE IF NOT EXISTS 는 이미 있는 표를 바꾸지 못하므로 누락된
  // 컬럼만 하나씩 추가합니다. (D1 은 같은 ALTER 를 두 번 하면 실패합니다.)
  const info = await db.prepare('PRAGMA table_info(engine_servers)').all()
  const existing = new Set((info.results as { name: string }[]).map((row) => row.name))
  for (const [name, type] of serverColumns) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE engine_servers ADD COLUMN ${name} ${type}`).run()
  }

  const users = await db.prepare('PRAGMA table_info(engine_users)').all()
  const userExisting = new Set((users.results as { name: string }[]).map((row) => row.name))
  for (const [name, type] of userColumns) {
    if (!userExisting.has(name)) await db.prepare(`ALTER TABLE engine_users ADD COLUMN ${name} ${type}`).run()
  }

  engineReady = true
}

// --- 비밀번호 -------------------------------------------------------------

const PBKDF2_ITERATIONS = 10_000 // 워커 CPU 제한 안에서 돌리기 위한 값. 유료 플랜이면 올리세요.

function b64(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return btoa(String.fromCharCode(...view))
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(bits)}`
}

async function verifyPassword(password: string, stored: string) {
  const [scheme, iterations, salt, expected] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: Uint8Array.from(atob(salt), (c) => c.charCodeAt(0)), iterations: Number(iterations), hash: 'SHA-256' },
    key,
    256,
  )
  return b64(bits) === expected
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken(bytes = 24) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// --- 인증 -----------------------------------------------------------------

async function userFromRequest(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  if (!token) return null
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name FROM engine_sessions s
     JOIN engine_users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, Date.now())
    .first<SessionUser>()
  return row ?? null
}

async function deviceFromRequest(c: { req: { header: (n: string) => string | undefined }; env: Env }) {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  if (!token) return null
  const row = await c.env.DB.prepare('SELECT id, user_id, name, token_hash FROM engine_devices WHERE token_hash = ?')
    .bind(await sha256(token))
    .first<DeviceRow>()
  return row ?? null
}

// 서버 접근 권한 — 주인은 전부 할 수 있고, 관리자로 등록된 이메일은 함께 관리합니다.
// 'owner' | 'admin' | null(접근 불가) 를 돌려줍니다.
async function serverRole(
  db: D1Database,
  user: { id: number; email: string },
  serverId: number,
): Promise<'owner' | 'admin' | null> {
  const row = await db
    .prepare(
      `SELECT s.user_id,
              EXISTS(SELECT 1 FROM engine_admins a WHERE a.server_id = s.id AND LOWER(a.email) = LOWER(?)) AS admin
       FROM engine_servers s WHERE s.id = ?`,
    )
    .bind(user.email, serverId)
    .first<{ user_id: number; admin: number }>()
  if (!row) return null
  if (row.user_id === user.id) return 'owner'
  return row.admin ? 'admin' : null
}

// --- 라우트 ---------------------------------------------------------------

export const engine = new Hono<{ Bindings: Env }>()

engine.use('*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') await ensureEngine(c.env.DB)
  await next()
})

// 계정 만들기 / 로그인
engine.post('/auth/register', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; name?: string }>().catch(() => ({}) as never)
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const name = (body.name ?? '').trim().slice(0, 40) || email.split('@')[0]

  if (!EMAIL_RE.test(email)) return c.json({ error: '이메일 주소를 확인해 주세요.' }, 400)
  if (password.length < 8) return c.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, 400)

  const exists = await c.env.DB.prepare('SELECT 1 FROM engine_users WHERE email = ?').bind(email).first()
  if (exists) return c.json({ error: '이미 가입된 이메일입니다.' }, 409)

  const result = await c.env.DB.prepare(
    'INSERT INTO engine_users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(email, await hashPassword(password), name, Date.now())
    .run()

  const userId = Number(result.meta.last_row_id)
  const token = randomToken()
  await c.env.DB.prepare('INSERT INTO engine_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, Date.now() + 1000 * 60 * 60 * 24 * 30)
    .run()

  return c.json({ token, user: { id: userId, email, displayName: name } })
})

engine.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as never)
  const email = (body.email ?? '').trim().toLowerCase()
  const user = await c.env.DB.prepare('SELECT id, email, password_hash, display_name FROM engine_users WHERE email = ?')
    .bind(email)
    .first<UserRow>()
  if (!user || !(await verifyPassword(body.password ?? '', user.password_hash))) {
    return c.json({ error: '이메일 또는 비밀번호가 맞지 않습니다.' }, 401)
  }
  const token = randomToken()
  await c.env.DB.prepare('INSERT INTO engine_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, Date.now() + 1000 * 60 * 60 * 24 * 30)
    .run()
  return c.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } })
})

engine.post('/auth/logout', async (c) => {
  const raw = c.req.header('Authorization') ?? ''
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : ''
  if (token) await c.env.DB.prepare('DELETE FROM engine_sessions WHERE token = ?').bind(token).run()
  return c.json({ ok: true })
})

engine.get('/auth/me', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  return c.json({ user: { id: user.id, email: user.email, displayName: user.display_name } })
})

// 디스코드 로그인 — DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET 을 넣으면 살아납니다.
// 프론트는 이 값을 보고 버튼을 려/숨깁니다.
engine.get('/auth/discord/status', (c) => {
  return c.json({ configured: Boolean(c.env.DISCORD_CLIENT_ID && c.env.DISCORD_CLIENT_SECRET) })
})

// 데스크톱 앱은 이 PC의 로컬 주소로 돌아옵니다. 이 목록만 허용합니다 —
// 아무 주소나 받도록 했다면 인증 코드를 가로채 세션을 훔칠 수 있습니다.
const DESKTOP_CALLBACKS = ['http://127.0.0.1:51555/callback', 'http://localhost:51555/callback']

// code 를 받아 세션으로 바꿉니다. 웹 콜백과 데스크톱 앱이 함께 씁니다.
async function discordSession(env: Env, code: string, redirect: string) {
  const clientId = env.DISCORD_CLIENT_ID
  const secret = env.DISCORD_CLIENT_SECRET
  if (!clientId || !secret) throw new Error('디스코드 로그인이 설정되지 않았습니다.')

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
    }),
  })
  if (!tokenRes.ok) throw new Error('디스코드 인증에 실패했습니다.')
  const tokenData = (await tokenRes.json()) as { access_token?: string }
  if (!tokenData.access_token) throw new Error('디스코드 인증에 실패했습니다.')

  const meRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const me = (await meRes.json()) as {
    id?: string
    username?: string
    global_name?: string | null
    email?: string
    verified?: boolean
  }
  if (!me.id) throw new Error('디스코드 정보를 받지 못했습니다.')

  await ensureEngine(env.DB)
  const linkedEmail = (me.email ?? '').trim().toLowerCase()
  let user = await env.DB.prepare('SELECT id, email, display_name FROM engine_users WHERE discord_id = ?')
    .bind(me.id)
    .first<{ id: number; email: string; display_name: string }>()

  // 같은 이메일로 만든 계정(비밀번호·구글 가입)이 있으면 따로 두지 않고 그 계정에 붙입니다.
  if (!user && linkedEmail && me.verified !== false) {
    user = await env.DB.prepare('SELECT id, email, display_name FROM engine_users WHERE email = ?')
      .bind(linkedEmail)
      .first<{ id: number; email: string; display_name: string }>()
    if (user) {
      await env.DB.prepare('UPDATE engine_users SET discord_id = ? WHERE id = ?').bind(me.id, user.id).run()
    }
  }

  if (!user) {
    const email = linkedEmail || `discord-${me.id}@discord.lubit.invalid`
    const name = me.global_name || me.username || 'Discord 사용자'
    const result = await env.DB.prepare(
      'INSERT INTO engine_users (email, password_hash, discord_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(email, `discord$${me.id}`, me.id, name, Date.now())
      .run()
    user = { id: Number(result.meta.last_row_id), email, display_name: name }
  }

  const session = randomToken()
  await env.DB.prepare('INSERT INTO engine_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(session, user.id, Date.now() + 1000 * 60 * 60 * 24 * 30)
    .run()

  return { token: session, user: { id: user.id, email: user.email, displayName: user.display_name } }
}

engine.get('/auth/discord/start', (c) => {
  const webRedirect = `${new URL(c.req.url).origin}/api/engine/auth/discord/callback`
  // 데스크톱 앱은 redirect_uri 로 자기 로컬 주소를 보냅니다. 미리 정해 둔
  // 주소가 아니면 처음부터 거절합니다.
  const requested = c.req.query('redirect_uri')
  const state = c.req.query('state')
  let redirect = webRedirect
  if (requested) {
    if (!DESKTOP_CALLBACKS.includes(requested)) {
      return c.json({ error: '허용되지 않은 돌아오는 주소입니다.' }, 400)
    }
    redirect = requested
  }

  const clientId = c.env.DISCORD_CLIENT_ID
  // 설정 전에 눌러도 JSON 이나 501 이 뜨지 않도록 콘솔로 돌려보냅니다.
  if (!clientId) return c.redirect('/console?error=discord_not_configured')

  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('scope', 'identify email')
  // 로컬 콜백이 제대로 이 요청의 결과인지 확인할 수 있게 state 를 함께 보냅니다.
  if (state && requested) url.searchParams.set('state', state.slice(0, 64))
  return c.redirect(url.toString())
})

engine.get('/auth/discord/callback', async (c) => {
  const clientId = c.env.DISCORD_CLIENT_ID
  const secret = c.env.DISCORD_CLIENT_SECRET
  if (!clientId || !secret) return c.redirect('/console?error=discord_not_configured')

  const code = c.req.query('code')
  // 사용자가 취소하거나 Discord 가 오류를 돌려보낸 경우도 콘솔로 돌려보냅니다.
  if (!code) {
    const error = c.req.query('error')
    return c.redirect(`/console?error=${encodeURIComponent(error ? `discord_${error}` : 'discord_failed')}`)
  }
  try {
    const session = await discordSession(
      c.env,
      code,
      `${new URL(c.req.url).origin}/api/engine/auth/discord/callback`,
    )
    return c.redirect(`/console?token=${session.token}`)
  } catch {
    return c.redirect('/console?error=discord_failed')
  }
})

// 데스크톱 앱이 브라우저에서 받은 code 를 세션으로 바꿉니다.
engine.post('/auth/discord/desktop', async (c) => {
  const body = await c.req.json<{ code?: string; redirectUri?: string }>().catch(() => ({}) as never)
  const code = (body.code ?? '').trim()
  const redirect = body.redirectUri ?? ''
  if (!code || !DESKTOP_CALLBACKS.includes(redirect)) {
    return c.json({ error: '올바르지 않은 요청입니다.' }, 400)
  }
  if (!c.env.DISCORD_CLIENT_ID || !c.env.DISCORD_CLIENT_SECRET) {
    return c.json({ error: '디스코드 로그인이 설정되지 않았습니다.' }, 501)
  }
  try {
    return c.json(await discordSession(c.env, code, redirect))
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : '디스코드 로그인에 실패했습니다.' },
      502,
    )
  }
})

// --- 구글 로그인 -----------------------------------------------------------
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 을 넣으면 살아납니다. 디스코드와 같은
// 구조여서 웹·데스크톱 앱이 같은 방식으로 돌아옵니다.

engine.get('/auth/google/status', (c) =>
  c.json({ configured: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) }),
)

// code 를 받아 세션으로 바꿉니다. 웹 콜백과 데스크톱 앱이 함께 씁니다.
async function googleSession(env: Env, code: string, redirect: string) {
  const clientId = env.GOOGLE_CLIENT_ID
  const secret = env.GOOGLE_CLIENT_SECRET
  if (!clientId || !secret) throw new Error('구글 로그인이 설정되지 않았습니다.')

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
    }),
  })
  if (!tokenRes.ok) throw new Error('구글 인증에 실패했습니다.')
  const tokenData = (await tokenRes.json()) as { access_token?: string }
  if (!tokenData.access_token) throw new Error('구글 인증에 실패했습니다.')

  const meRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })
  const me = (await meRes.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
  }
  if (!me.sub) throw new Error('구글 정보를 받지 못했습니다.')

  await ensureEngine(env.DB)
  const email = (me.email ?? '').trim().toLowerCase()
  const name = (me.name || (email ? email.split('@')[0] : '') || 'Google 사용자').slice(0, 40)

  let user = await env.DB.prepare('SELECT id, email, display_name FROM engine_users WHERE google_id = ?')
    .bind(me.sub)
    .first<{ id: number; email: string; display_name: string }>()

  // 같은 이메일의 계정(비밀번호·디스코드 가입)이 있으면 그 계정에 붙여 하나로 씁니다.
  if (!user && email && me.email_verified !== false) {
    user = await env.DB.prepare('SELECT id, email, display_name FROM engine_users WHERE email = ?')
      .bind(email)
      .first<{ id: number; email: string; display_name: string }>()
    if (user) {
      await env.DB.prepare('UPDATE engine_users SET google_id = ? WHERE id = ?').bind(me.sub, user.id).run()
    }
  }

  if (!user) {
    const finalEmail = email || `google-${me.sub}@google.lubit.invalid`
    const result = await env.DB.prepare(
      'INSERT INTO engine_users (email, password_hash, google_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(finalEmail, `google$${me.sub}`, me.sub, name, Date.now())
      .run()
    user = { id: Number(result.meta.last_row_id), email: finalEmail, display_name: name }
  }

  const session = randomToken()
  await env.DB.prepare('INSERT INTO engine_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(session, user.id, Date.now() + 1000 * 60 * 60 * 24 * 30)
    .run()

  return { token: session, user: { id: user.id, email: user.email, displayName: user.display_name } }
}

engine.get('/auth/google/start', (c) => {
  const webRedirect = `${new URL(c.req.url).origin}/api/engine/auth/google/callback`
  const requested = c.req.query('redirect_uri')
  const state = c.req.query('state')
  let redirect = webRedirect
  if (requested) {
    if (!DESKTOP_CALLBACKS.includes(requested)) {
      return c.json({ error: '허용되지 않은 돌아오는 주소입니다.' }, 400)
    }
    redirect = requested
  }

  const clientId = c.env.GOOGLE_CLIENT_ID
  // 설정 전에 눌러도 JSON 이나 501 이 뜨지 않도록 콘솔로 돌려보냅니다.
  if (!clientId) return c.redirect('/console?error=google_not_configured')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('scope', 'openid email profile')
  // 계정 선택 화면을 먼저 띄워 다른 계정으로 넘어가는 것을 막습니다.
  url.searchParams.set('prompt', 'select_account')
  if (state && requested) url.searchParams.set('state', state.slice(0, 64))
  return c.redirect(url.toString())
})

engine.get('/auth/google/callback', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.redirect('/console?error=google_not_configured')
  }
  const code = c.req.query('code')
  if (!code) {
    const error = c.req.query('error')
    return c.redirect(`/console?error=${encodeURIComponent(error ? `google_${error}` : 'google_failed')}`)
  }
  try {
    const session = await googleSession(
      c.env,
      code,
      `${new URL(c.req.url).origin}/api/engine/auth/google/callback`,
    )
    return c.redirect(`/console?token=${session.token}`)
  } catch {
    return c.redirect('/console?error=google_failed')
  }
})

// 데스크톱 앱이 브라우저에서 받은 code 를 세션으로 바꿉니다.
engine.post('/auth/google/desktop', async (c) => {
  const body = await c.req.json<{ code?: string; redirectUri?: string }>().catch(() => ({}) as never)
  const code = (body.code ?? '').trim()
  const redirect = body.redirectUri ?? ''
  if (!code || !DESKTOP_CALLBACKS.includes(redirect)) {
    return c.json({ error: '올바르지 않은 요청입니다.' }, 400)
  }
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.json({ error: '구글 로그인이 설정되지 않았습니다.' }, 501)
  }
  try {
    return c.json(await googleSession(c.env, code, redirect))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : '구글 로그인에 실패했습니다.' }, 502)
  }
})

// --- 서버 (대시보드 쪽) -----------------------------------------------------

engine.get('/servers', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const rows = await c.env.DB.prepare(
    `SELECT id, name, device_id, java_cmd, server_dir, state, players, max_players, last_error, updated_at,
            mc_version, server_type, memory_mb, port, player_names, relay_port, domain,
            (user_id = ?) AS is_owner
     FROM engine_servers
     WHERE user_id = ? OR id IN (SELECT server_id FROM engine_admins WHERE LOWER(email) = LOWER(?))
     ORDER BY id DESC`,
  )
    .bind(user.id, user.id, user.email)
    .all()
  return c.json({ servers: rows.results })
})

engine.post('/servers', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const body = await c.req
    .json<{
      name?: string
      javaCmd?: string
      serverDir?: string
      version?: string
      type?: string
      memoryMb?: number
      port?: number
    }>()
    .catch(() => ({}) as never)
  const name = (body.name ?? '').trim().slice(0, 60)
  if (!name) return c.json({ error: '서버 이름을 입력해 주세요.' }, 400)

  const now = Date.now()
  const result = await c.env.DB.prepare(
    `INSERT INTO engine_servers
       (user_id, name, java_cmd, server_dir, mc_version, server_type, memory_mb, port, updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      user.id,
      name,
      (body.javaCmd ?? '').slice(0, 400),
      (body.serverDir ?? '').slice(0, 400),
      (body.version ?? '').slice(0, 40) || null,
      (body.type ?? '').slice(0, 40) || null,
      Number(body.memoryMb) > 0 ? Math.min(Number(body.memoryMb), 1024 * 64) : null,
      Number(body.port) > 0 && Number(body.port) < 65536 ? Number(body.port) : null,
      now,
      now,
    )
    .run()

  return c.json({ id: Number(result.meta.last_row_id) })
})

engine.delete('/servers/:id', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  // 삭제는 되돌릴 수 없으므로 주인만 할 수 있습니다.
  if (role !== 'owner') return c.json({ error: '서버를 삭제할 권한이 없습니다. 주인만 삭제할 수 있습니다.' }, 403)
  await c.env.DB.prepare('DELETE FROM engine_servers WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  await c.env.DB.prepare('DELETE FROM engine_commands WHERE server_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM engine_logs WHERE server_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM engine_maps WHERE server_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM engine_admins WHERE server_id = ?').bind(id).run()
  return c.json({ ok: true })
})

// 에이전트(기기) 등록 — 토큰은 한 번만 보여줍니다.
engine.post('/devices', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as never)
  const token = randomToken(32)
  const id = randomToken(8)
  await c.env.DB.prepare('INSERT INTO engine_devices (id, user_id, name, token_hash, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, (body.name ?? '내 PC').slice(0, 40), await sha256(token), Date.now())
    .run()
  return c.json({ id, token, name: body.name ?? '내 PC' })
})

// 데스크톱 앱이 계정으로 로그인한 뒤 이 PC를 기기로 자동 등록합니다.
// 이미 받은 기기 자격증명을 다시 보내면 그대로 재사용하고, 없으면 새로 만듭니다.
// (기기 토큰은 서버에 해시로만 남아 다시 조회할 수 없으므로 자격증명으로 확인합니다.)
engine.post('/devices/ensure', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const body = await c.req
    .json<{ name?: string; deviceId?: string; token?: string }>()
    .catch(() => ({}) as never)
  const name = (body.name ?? '내 PC').trim().slice(0, 40) || '내 PC'

  if (body.token) {
    const hash = await sha256(body.token)
    const existing = body.deviceId
      ? await c.env.DB.prepare(
          'SELECT id, name FROM engine_devices WHERE id = ? AND user_id = ? AND token_hash = ?',
        )
          .bind(body.deviceId, user.id, hash)
          .first<{ id: string; name: string }>()
      : await c.env.DB.prepare('SELECT id, name FROM engine_devices WHERE user_id = ? AND token_hash = ?')
          .bind(user.id, hash)
          .first<{ id: string; name: string }>()
    if (existing) {
      await c.env.DB.prepare('UPDATE engine_devices SET last_seen = ? WHERE id = ?')
        .bind(Date.now(), existing.id)
        .run()
      return c.json({ id: existing.id, token: body.token, name: existing.name, existing: true })
    }
  }

  const token = randomToken(32)
  const id = randomToken(8)
  await c.env.DB.prepare('INSERT INTO engine_devices (id, user_id, name, token_hash, last_seen) VALUES (?, ?, ?, ?, ?)')
    .bind(id, user.id, name, await sha256(token), Date.now())
    .run()
  return c.json({ id, token, name, existing: false })
})

engine.get('/devices', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const rows = await c.env.DB.prepare(
    'SELECT id, name, last_seen FROM engine_devices WHERE user_id = ? ORDER BY last_seen DESC',
  )
    .bind(user.id)
    .all()
  return c.json({ devices: rows.results })
})

// 서버·기기 목록을 한 번에 실시간으로 밀어 줍니다. 접속 인원과 플레이어 목록이
// 1초 안에 화면에 반영되는 것은 이 연결 덕분입니다. 끊기면 브라우저가 다시 엽니다.
engine.get('/stream', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)

  const signal = c.req.raw.signal
  const encoder = new TextEncoder()
  let closed = false

  const read = async () => {
    const [servers, devices] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, name, device_id, java_cmd, server_dir, state, players, max_players, last_error, updated_at,
                mc_version, server_type, memory_mb, port, player_names, relay_port, domain,
                (user_id = ?) AS is_owner
         FROM engine_servers
         WHERE user_id = ? OR id IN (SELECT server_id FROM engine_admins WHERE LOWER(email) = LOWER(?))
         ORDER BY id DESC`,
      )
        .bind(user.id, user.id, user.email)
        .all(),
      c.env.DB.prepare('SELECT id, name, last_seen FROM engine_devices WHERE user_id = ? ORDER BY last_seen DESC')
        .bind(user.id)
        .all(),
    ])
    // 바뀐 게 있을 때만 보내기 위해 JSON 문자열 전체를 비교합니다.
    return {
      snapshot: JSON.stringify({ servers: servers.results, devices: devices.results }),
      // 새 로그를 받기 위해 이번에 보이는 서버 목록도 함께 돌려줍니다.
      ids: servers.results.map((row) => Number(row.id)),
    }
  }

  // 새 로그는 스트림으로 바로 밀어줍니다 — 웹이 5초마다 따로 로그를 물어보지 않아도 됩니다.
  // 접속 직전까지의 로그는 웹이 열 때 한 번에 다시 읽으므로, 지금까지의 최댓값부터 시작합니다.
  let logCursor: number | null = null
  const readLogs = async (ids: number[]) => {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')

    if (logCursor === null) {
      const head = await c.env.DB.prepare(
        'SELECT COALESCE(MAX(id), 0) AS value FROM engine_logs WHERE server_id IN (' + placeholders + ')',
      )
        .bind(...ids)
        .first<{ value: number }>()
      logCursor = Number(head?.value ?? 0)
      return []
    }

    const rows = await c.env.DB.prepare(
      'SELECT id, server_id, ts, line FROM engine_logs WHERE id > ? AND server_id IN (' +
        placeholders +
        ') ORDER BY id ASC LIMIT 100',
    )
      .bind(logCursor, ...ids)
      .all<{ id: number; server_id: number; ts: number; line: string }>()
    const entries = rows.results
    if (entries.length > 0) logCursor = Number(entries[entries.length - 1].id)
    return entries
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = ''
      while (!closed && !signal.aborted) {
        try {
          const { snapshot, ids } = await read()
          if (snapshot !== last) {
            last = snapshot
            controller.enqueue(encoder.encode(`data: ${snapshot}\n\n`))
          }
          // 로그는 목록과 구분되도록 type 을 달아 보냅니다 — 웹이 그대로 콘솔에 붙입니다.
          const entries = await readLogs(ids)
          if (entries.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'logs', entries })}\n\n`),
            )
          }
        } catch {
          /* 잠시 실패해도 다음 주기에 다시 읽습니다 */
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      try {
        controller.close()
      } catch {
        /* 이미 닫힌 연결 */
      }
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})

// 서버를 특정 기기에 연결
engine.post('/servers/:id/assign', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  // 어느 PC 에서 돌지 정하는 것은 주인만 정합니다.
  if (role !== 'owner') return c.json({ error: '기기 변경은 주인만 할 수 있습니다.' }, 403)
  const body = await c.req.json<{ deviceId?: string | null }>().catch(() => ({}) as never)
  const device = body.deviceId
    ? await c.env.DB.prepare('SELECT id FROM engine_devices WHERE id = ? AND user_id = ?')
        .bind(body.deviceId, user.id)
        .first()
    : null
  if (body.deviceId && !device) return c.json({ error: '기기를 찾을 수 없습니다.' }, 404)
  await c.env.DB.prepare('UPDATE engine_servers SET device_id = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(device ? body.deviceId : null, Date.now(), id, user.id)
    .run()
  return c.json({ ok: true })
})

// --- 관리자 (서버 함께 관리) ------------------------------------------------
// 주인이 이메일로 관리자를 등록하면, 그 사람도 같은 서버를 함께 만집니다.
// 등록 시점에 계정이 없어도 이메일로 잡아 두므로, 나중에 그 이메일로 가입하면
// 바로 접근이 열립니다. 관리자는 시작·중지·콘솔·파일·플러그인·지도·도메인까지
// 쓸 수 있고, 서버 삭제·기기 변경·관리자 관리만 주인에게 남습니다.

const MAX_ADMINS = 20

type AdminRow = { email: string; display_name: string | null; created_at: number }

engine.get('/servers/:id/admins', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  const owner = await c.env.DB.prepare(
    'SELECT u.email, u.display_name FROM engine_servers s JOIN engine_users u ON u.id = s.user_id WHERE s.id = ?',
  )
    .bind(id)
    .first<{ email: string; display_name: string }>()
  const rows = await c.env.DB.prepare(
    `SELECT a.email, u.display_name, a.created_at
     FROM engine_admins a LEFT JOIN engine_users u ON LOWER(u.email) = LOWER(a.email)
     WHERE a.server_id = ? ORDER BY a.created_at ASC`,
  )
    .bind(id)
    .all<AdminRow>()

  return c.json({
    role,
    owner: owner ? { email: owner.email, displayName: owner.display_name } : null,
    admins: rows.results.map((row) => ({
      email: row.email,
      displayName: row.display_name,
      registered: Boolean(row.display_name),
      createdAt: row.created_at,
    })),
  })
})

engine.post('/servers/:id/admins', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (role !== 'owner') return c.json({ error: '관리자 등록은 주인만 할 수 있습니다.' }, 403)

  const body = await c.req.json<{ email?: string }>().catch(() => ({}) as never)
  const email = String(body.email ?? '').trim().toLowerCase()
  if (email.length > 160 || !EMAIL_RE.test(email)) {
    return c.json({ error: '이메일 형식이 올바르지 않습니다.' }, 400)
  }

  const owner = await c.env.DB.prepare(
    'SELECT u.email FROM engine_servers s JOIN engine_users u ON u.id = s.user_id WHERE s.id = ?',
  )
    .bind(id)
    .first<{ email: string }>()
  if (owner && owner.email.trim().toLowerCase() === email) {
    return c.json({ error: '주인 자신은 별도로 등록하지 않아도 이미 관리할 수 있습니다.' }, 400)
  }

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM engine_admins WHERE server_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if (Number(count?.n ?? 0) >= MAX_ADMINS) {
    return c.json({ error: `관리자는 최대 ${MAX_ADMINS}명까지 등록할 수 있습니다.` }, 409)
  }

  await c.env.DB.prepare(
    `INSERT INTO engine_admins (server_id, email, added_by, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(server_id, email) DO NOTHING`,
  )
    .bind(id, email, user.id, Date.now())
    .run()
  return c.json({ ok: true, email })
})

engine.delete('/servers/:id/admins', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (role !== 'owner') return c.json({ error: '관리자 삭제는 주인만 할 수 있습니다.' }, 403)

  const email = String(c.req.query('email') ?? '').trim().toLowerCase()
  if (!email) return c.json({ error: '지울 이메일이 필요합니다.' }, 400)
  const result = await c.env.DB.prepare('DELETE FROM engine_admins WHERE server_id = ? AND email = ?')
    .bind(id, email)
    .run()
  if (!Number(result.meta.changes)) return c.json({ error: '등록되지 않은 이메일입니다.' }, 404)
  return c.json({ ok: true })
})

// 명령 보내기 (시작/중지/재시작/콘솔 입력)
engine.post('/servers/:id/commands', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ type?: string; args?: Record<string, string> }>().catch(() => ({}) as never)
  const type = body.type ?? ''
  const allowed = [
    'start',
    'stop',
    'restart',
    'command',
    // 아래부터는 결과를 되돌려받는 명령입니다. /commands/:id 로 폴링합니다.
    'file_list',
    'file_read',
    'file_write',
    'plugin_list',
    'plugin_install',
    'plugin_remove',
    'world_map',
  ]
  if (!allowed.includes(type)) return c.json({ error: '지원하지 않는 명령입니다.' }, 400)

  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  const server = await c.env.DB.prepare('SELECT id, device_id FROM engine_servers WHERE id = ?')
    .bind(id)
    .first<{ device_id: string | null }>()
  if (!server) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (!server.device_id) return c.json({ error: '아직 실행 기기가 연결되지 않았습니다.' }, 409)

  // 파일 저장처럼 내용이 긴 명령도 받도록 여유를 둡니다.
  const args = JSON.stringify((body.args ?? {}) as Record<string, string>).slice(0, 2_000_000)
  const result = await c.env.DB.prepare(
    'INSERT INTO engine_commands (server_id, type, args, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, type, args, Date.now())
    .run()

  // 시작/중지는 상태를 미리 바꿔서 화면에서 바로 반영되게 합니다.
  const next = type === 'start' ? 'starting' : type === 'stop' ? 'stopping' : null
  if (next) {
    await c.env.DB.prepare('UPDATE engine_servers SET state = ?, updated_at = ? WHERE id = ?')
      .bind(next, Date.now(), id)
      .run()
  }
  return c.json({ id: Number(result.meta.last_row_id) })
})

engine.get('/servers/:id/logs', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const since = Number(c.req.query('since') ?? 0)
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000)
  const owned = await serverRole(c.env.DB, user, id)
  if (!owned) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  const rows = await c.env.DB.prepare(
    'SELECT id, ts, line FROM engine_logs WHERE server_id = ? AND id > ? ORDER BY id ASC LIMIT ?',
  )
    .bind(id, since, limit)
    .all()
  return c.json({ logs: rows.results, next: rows.results.length ? rows.results[rows.results.length - 1].id : since })
})

// --- 에이전트 쪽 ------------------------------------------------------------

engine.post('/agent/ping', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  await c.env.DB.prepare('UPDATE engine_devices SET last_seen = ? WHERE id = ?').bind(Date.now(), device.id).run()
  return c.json({ ok: true, serverTime: Date.now() })
})

engine.get('/agent/servers', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const rows = await c.env.DB.prepare(
    `SELECT id, name, java_cmd, server_dir, port, state, mc_version, server_type FROM engine_servers
     WHERE device_id = ? AND user_id = ? ORDER BY id ASC`,
  )
    .bind(device.id, device.user_id)
    .all()
  return c.json({ servers: rows.results })
})

// 중계 서버(포트포워딩 없이 접속하게 해주는 서비스)에 줄 정보를 돌려줍니다.
engine.get('/agent/relay', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)

  const env = c.env as EnvWithDns
  const host = (env.RELAY_HOST ?? '').trim()
  if (!host) return c.json({ enabled: false, host: '', controlPort: 0, servers: [] })

  const controlPort = Number(env.RELAY_CONTROL_PORT ?? 7777) || 7777
  const rows = await c.env.DB.prepare(
    'SELECT id, relay_port FROM engine_servers WHERE device_id = ? AND user_id = ? ORDER BY id ASC',
  )
    .bind(device.id, device.user_id)
    .all()

  const servers: { id: number; port: number }[] = []
  for (const row of rows.results as { id: number; relay_port: number | null }[]) {
    let port = row.relay_port
    if (!port) {
      const assigned = await assignRelayPort(c.env.DB, null)
      if (assigned.error || !assigned.port) break
      port = assigned.port
      await c.env.DB.prepare('UPDATE engine_servers SET relay_port = ? WHERE id = ?').bind(port, row.id).run()
    }
    servers.push({ id: row.id, port })
  }

  return c.json({ enabled: true, host, controlPort, servers })
})

// 에이전트가 주기적으로 이 서버를 호출합니다.
engine.get('/agent/commands', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const after = Number(c.req.query('after') ?? 0)

  const rows = await c.env.DB.prepare(
    `SELECT cmd.id, cmd.server_id, cmd.type, cmd.args
     FROM engine_commands cmd
     JOIN engine_servers s ON s.id = cmd.server_id
     WHERE s.device_id = ? AND s.user_id = ? AND cmd.status = 'pending' AND cmd.id > ?
     ORDER BY cmd.id ASC LIMIT 20`,
  )
    .bind(device.id, device.user_id, after)
    .all()

  const commands = (rows.results as { id: number; server_id: number; type: string; args: string }[]).map((row) => ({
    id: row.id,
    serverId: row.server_id,
    type: row.type,
    args: JSON.parse(row.args || '{}') as Record<string, string>,
  }))
  return c.json({ commands })
})

engine.post('/agent/ack', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const body = await c.req.json<{ commandId?: number; ok?: boolean; message?: string }>().catch(() => ({}) as never)
  await c.env.DB.prepare(
    `UPDATE engine_commands SET status = ?, result = ?, done_at = ? WHERE id = ? AND server_id IN
     (SELECT id FROM engine_servers WHERE device_id = ? AND user_id = ?)`,
  )
    .bind(
      body.ok ? 'done' : 'failed',
      // 파일 읽기 같은 명령은 결과가 길므로 여유를 두고 잘라냅니다.
      (body.message ?? '').slice(0, 300_000),
      Date.now(),
      Number(body.commandId),
      device.id,
      device.user_id,
    )
    .run()
  return c.json({ ok: true })
})

engine.post('/agent/status', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const body = await c.req
    .json<{
      serverId?: number
      state?: string
      players?: number | null
      maxPlayers?: number | null
      names?: string[]
      error?: string | null
    }>()
    .catch(() => ({}) as never)

  const states = ['offline', 'starting', 'running', 'stopping', 'crashed']
  const state = states.includes(body.state ?? '') ? (body.state as string) : 'offline'
  const names = Array.isArray(body.names)
    ? JSON.stringify(body.names.filter((name) => typeof name === 'string').slice(0, 100))
    : null

  await c.env.DB.prepare(
    `UPDATE engine_servers SET state = ?, players = ?, max_players = ?, last_error = ?, player_names = ?, updated_at =
     ? WHERE id = ? AND device_id = ? AND user_id = ?`,
  )
    .bind(
      state,
      body.players ?? null,
      body.maxPlayers ?? null,
      (body.error ?? null)?.slice(0, 400) ?? null,
      names,
      Date.now(),
      Number(body.serverId),
      device.id,
      device.user_id,
    )
    .run()
  return c.json({ ok: true })
})

engine.post('/agent/logs', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const body = await c.req.json<{ serverId?: number; lines?: string[] }>().catch(() => ({}) as never)
  const serverId = Number(body.serverId)
  const lines = (body.lines ?? []).slice(0, 300)
  if (!serverId || lines.length === 0) return c.json({ ok: true })

  const owned = await c.env.DB.prepare('SELECT 1 FROM engine_servers WHERE id = ? AND device_id = ? AND user_id = ?')
    .bind(serverId, device.id, device.user_id)
    .first()
  if (!owned) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  const now = Date.now()
  const values: (string | number)[] = []
  for (const line of lines) {
    values.push(serverId, now, String(line).slice(0, 500))
  }
  const placeholders = lines.map(() => '(?, ?, ?)').join(', ')
  await c.env.DB.prepare(`INSERT INTO engine_logs (server_id, ts, line) VALUES ${placeholders}`)
    .bind(...values)
    .run()

  // 로그는 서버당 최근 3000줄만 남깁니다. 스트리밍 로그가 지갑을 때우는 걸 막습니다.
  await c.env.DB.prepare(
    `DELETE FROM engine_logs WHERE server_id = ? AND id IN
     (SELECT id FROM engine_logs WHERE server_id = ? ORDER BY id DESC LIMIT -1 OFFSET 3000)`,
  )
    .bind(serverId, serverId)
    .run()

  return c.json({ ok: true })
})

// --- 결과를 되돌려받는 명령 ------------------------------------------------

// 파일·플러그인·지도 같은 명령은 응답이 필요하므로 만든 뒤 이 주소로 폴링합니다.
engine.get('/commands/:id', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(
    `SELECT cmd.id, cmd.status, cmd.result, cmd.done_at
     FROM engine_commands cmd
     JOIN engine_servers s ON s.id = cmd.server_id
     WHERE cmd.id = ? AND (s.user_id = ? OR EXISTS(
       SELECT 1 FROM engine_admins a WHERE a.server_id = s.id AND LOWER(a.email) = LOWER(?)))`,
  )
    .bind(id, user.id, user.email)
    .first<{ id: number; status: string; result: string | null; done_at: number | null }>()
  if (!row) return c.json({ error: '명령을 찾을 수 없습니다.' }, 404)
  return c.json({ id: row.id, status: row.status, result: row.result ?? '', doneAt: row.done_at })
})

// --- 월드 지도 -------------------------------------------------------------

engine.post('/agent/worldmap', async (c) => {
  const device = await deviceFromRequest(c)
  if (!device) return c.json({ error: '기기 인증에 실패했습니다.' }, 401)
  const body = await c.req
    .json<{ serverId?: number; world?: string; width?: number; height?: number; png?: string }>()
    .catch(() => ({}) as never)
  const serverId = Number(body.serverId)
  const png = String(body.png ?? '')
  if (!serverId || !png) return c.json({ error: '지도 데이터가 없습니다.' }, 400)

  const owned = await c.env.DB.prepare(
    'SELECT 1 FROM engine_servers WHERE id = ? AND device_id = ? AND user_id = ?',
  )
    .bind(serverId, device.id, device.user_id)
    .first()
  if (!owned) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO engine_maps (server_id, world, width, height, png, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       world = excluded.world, width = excluded.width, height = excluded.height,
       png = excluded.png, updated_at = excluded.updated_at`,
  )
    .bind(
      serverId,
      String(body.world ?? 'world').slice(0, 60),
      Math.max(0, Math.min(Number(body.width) || 0, 4096)),
      Math.max(0, Math.min(Number(body.height) || 0, 4096)),
      png.slice(0, 2_000_000),
      Date.now(),
    )
    .run()
  return c.json({ ok: true })
})

engine.get('/servers/:id/worldmap', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  const row = await c.env.DB.prepare(
    `SELECT m.world, m.width, m.height, m.png, m.updated_at
     FROM engine_maps m JOIN engine_servers s ON s.id = m.server_id
     WHERE m.server_id = ?`,
  )
    .bind(id)
    .first<{ world: string; width: number; height: number; png: string; updated_at: number }>()
  if (!row) return c.json({ error: '아직 그려둔 지도가 없습니다.' }, 404)
  return c.json({
    world: row.world,
    width: row.width,
    height: row.height,
    png: row.png,
    updatedAt: row.updated_at,
  })
})

// --- Modrinth (플러그인 검색) ----------------------------------------------

const MODRINTH_HEADERS = { 'User-Agent': 'lubit-engine (https://lubit.kr)' }
const SLUG_RE = /^[a-z0-9_.-]{1,64}$/i

engine.get('/modrinth/search', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)

  const query = (c.req.query('q') ?? '').slice(0, 60)
  const url = new URL('https://api.modrinth.com/v2/search')
  url.searchParams.set('query', query)
  url.searchParams.set('limit', '20')
  url.searchParams.set('index', 'relevance')
  // 플러그인과 서버 측 모드를 함께 보여줍니다. (같은 배열 안이면 OR)
  url.searchParams.set('facets', JSON.stringify([['project_type:plugin', 'project_type:mod']]))

  const res = await fetch(url.toString(), { headers: MODRINTH_HEADERS })
  if (!res.ok) return c.json({ error: 'Modrinth 응답을 받지 못했습니다.' }, 502)
  const data = (await res.json()) as {
    hits?: {
      slug: string
      title: string
      description: string
      downloads: number
      icon_url?: string
      categories?: string[]
      versions?: string[]
      updated_at?: string
    }[]
  }
  return c.json({
    hits: (data.hits ?? []).map((hit) => ({
      slug: hit.slug,
      title: hit.title,
      description: hit.description,
      downloads: hit.downloads,
      icon: hit.icon_url ?? '',
      loaders: hit.categories ?? [],
      gameVersions: hit.versions ?? [],
      updated: hit.updated_at ?? '',
    })),
  })
})

engine.get('/modrinth/versions', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const slug = (c.req.query('slug') ?? '').trim()
  if (!SLUG_RE.test(slug)) return c.json({ error: '플러그인 이름이 올바르지 않습니다.' }, 400)

  const res = await fetch(`https://api.modrinth.com/v2/project/${slug}/version?limit=40`, {
    headers: MODRINTH_HEADERS,
  })
  if (!res.ok) return c.json({ error: '버전 목록을 받지 못했습니다.' }, 502)
  const rows = (await res.json()) as {
    id: string
    name: string
    version_number: string
    loaders?: string[]
    game_versions?: string[]
    date_published?: string
    files?: { url: string; filename: string; size: number; primary?: boolean }[]
  }[]

  return c.json({
    versions: rows
      .filter((row) => (row.files ?? []).length > 0)
      .slice(0, 40)
      .map((row) => {
        const files = row.files ?? []
        const file = files.find((item) => item.primary) ?? files[0]
        return {
          id: row.id,
          name: row.name,
          version: row.version_number,
          loaders: row.loaders ?? [],
          gameVersions: row.game_versions ?? [],
          published: row.date_published ?? '',
          file: { url: file.url, filename: file.filename, size: file.size },
        }
      }),
  })
})

// --- 접속 (중계 서버 · 도메인) ---------------------------------------------

type EnvWithDns = Env & {
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ZONE_ID?: string
  RELAY_HOST?: string
  RELAY_IP?: string
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
// 다른 용도로 예약된 이름. 서브도메인으로 쓸 수 없습니다.
// upsertDns 는 같은 이름의 레코드가 이미 있으면 덮어쓰므로, 사이트·인프라가
// 쓰거나 쓸 법한 이름은 미리 막아 둡니다. (서버 주소로 흔히 쓰는 join · srv ·
// 숫자·지역 이름은 사용자가 고를 수 있게 열어 둡니다.)
const RESERVED_DOMAINS = new Set([
  // 서비스 본체 · 로그인
  'www', 'lubit', 'app', 'api', 'console', 'dashboard', 'panel', 'admin', 'auth',
  'login', 'signin', 'signup', 'register', 'account', 'accounts', 'portal', 'manage',
  'home', 'main', 'web', 'site', 'oauth', 'sso', 'callback', 'cb',
  // 안내 · 문서
  'status', 'health', 'monitor', 'monitoring', 'metrics', 'stats', 'logs', 'log',
  'support', 'help', 'docs', 'doc', 'wiki', 'faq', 'blog', 'news', 'notice',
  'community', 'forum', 'event', 'events', 'promo',
  // 상품 · 배포
  'shop', 'store', 'pay', 'payment', 'payments', 'billing', 'pricing', 'checkout',
  'cart', 'order', 'orders', 'download', 'downloads', 'update', 'updates',
  'release', 'releases', 'version', 'versions',
  // 인프라 · 연동
  'relay', 'node', 'nodes', 'edge', 'gateway', 'proxy', 'cdn', 'static', 'assets',
  'media', 'img', 'images', 'files', 'upload', 'uploads', 'ws', 'socket', 'realtime',
  'bot', 'bots', 'hooks', 'webhook', 'webhooks',
  // 메일 · 네트워크
  'mail', 'email', 'smtp', 'mx', 'ftp', 'ssh', 'vpn', 'dns', 'ns', 'ns1', 'ns2',
  // 개발 · 운영 환경
  'dev', 'test', 'staging', 'stage', 'demo', 'sandbox', 'lab', 'beta', 'alpha',
  'canary', 'git', 'ci', 'repo', 'internal', 'intranet', 'staff', 'old', 'new',
  'legacy', 'backup', 'bak', 'archive', 'tmp', 'temp',
  // 데이터 · 작업
  'db', 'database', 'cache', 'redis', 'queue', 'worker', 'workers', 'cron', 'search',
  // 마크 서버 주소로 이미 쓰는 이름
  'mc', 'play', 'playmc', 'minecraft',
  // 단축 주소
  'm', 'i', 'mobile', 'go', 'link',
])

type DnsRecord = { type: string; name: string; content?: string; data?: Record<string, unknown> }

// 같은 이름의 레코드가 있으면 갱신하고, 없으면 새로 만듭니다.
// 모든 서버 도메인이 가리키는 와일드카드 A 레코드입니다.
// 중계 IP 는 하나뿐이라 이걸 하나만 두면 신규 도메인은 A 등록이 필요 없습니다.
const WILDCARD_A_RECORD = '*.lubit.kr'

async function upsertDns(env: EnvWithDns, record: DnsRecord): Promise<{ error?: string }> {
  const token = (env.CLOUDFLARE_API_TOKEN ?? '').trim()
  const zone = (env.CLOUDFLARE_ZONE_ID ?? '').trim()
  if (!token || !zone) {
    return { error: 'Cloudflare API 토큰이 설정되지 않았습니다. (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID)' }
  }

  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const query = new URLSearchParams({ name: record.name, type: record.type })
  const found = (await fetch(`${endpoint}?${query}`, { headers })
    .then((res) => res.json())
    .catch(() => null)) as { success?: boolean; errors?: { message: string }[]; result?: { id: string }[] } | null
  if (!found) return { error: 'Cloudflare에 연결하지 못했습니다.' }
  if (!found.success) return { error: found.errors?.[0]?.message ?? 'DNS 조회에 실패했습니다.' }

  const payload: Record<string, unknown> = { type: record.type, name: record.name, ttl: 1 }
  if (record.data) payload.data = record.data
  else payload.content = record.content

  const existing = found.result?.[0]?.id
  const res = await fetch(existing ? `${endpoint}/${existing}` : endpoint, {
    method: existing ? 'PUT' : 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => null)) as {
    success?: boolean
    errors?: { message: string }[]
  } | null
  if (!res.ok || !data?.success) {
    return { error: data?.errors?.[0]?.message ?? `DNS 등록에 실패했습니다. (${res.status})` }
  }
  return {}
}

async function deleteDns(env: EnvWithDns, name: string, type: string) {
  const token = (env.CLOUDFLARE_API_TOKEN ?? '').trim()
  const zone = (env.CLOUDFLARE_ZONE_ID ?? '').trim()
  if (!token || !zone) return
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`
  const headers = { Authorization: `Bearer ${token}` }
  const query = new URLSearchParams({ name, type })
  const found = (await fetch(`${endpoint}?${query}`, { headers })
    .then((res) => res.json())
    .catch(() => null)) as { result?: { id: string }[] } | null
  for (const record of found?.result ?? []) {
    await fetch(`${endpoint}/${record.id}`, { method: 'DELETE', headers }).catch(() => undefined)
  }
}

// 서버마다 공인 포트를 하나 배정합니다. 25565 부터 쓰고 상한을 둡니다.
async function assignRelayPort(db: D1Database, current: number | null) {
  if (current) return { port: current }
  const row = await db.prepare('SELECT MAX(relay_port) AS m FROM engine_servers').first<{ m: number | null }>()
  const port = Math.max(25565, Number(row?.m ?? 0) + 1)
  if (port > 25664) return { error: '중계 포트가 모두 찼습니다.' }
  return { port }
}

engine.get('/servers/:id/access', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const server = await c.env.DB.prepare('SELECT id, domain, relay_port FROM engine_servers WHERE id = ?')
    .bind(id)
    .first<{ id: number; domain: string | null; relay_port: number | null }>()
  if (!server) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  const env = c.env as EnvWithDns
  const host = (env.RELAY_HOST ?? '').trim()
  const ip = (env.RELAY_IP ?? '').trim()
  return c.json({
    domain: server.domain ?? '',
    relayPort: server.relay_port ?? null,
    relayHost: host,
    relayIp: ip,
    configured: Boolean(host && ip),
    dnsConfigured: Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID),
  })
})

engine.post('/servers/:id/domain', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as never)
  const name = String(body.name ?? '').trim().toLowerCase().slice(0, 63)
  if (!DOMAIN_RE.test(name)) {
    return c.json({ error: '도메인은 영문 소문자·숫자·- 만 쓸 수 있고 1자 이상이어야 합니다.' }, 400)
  }
  if (RESERVED_DOMAINS.has(name)) {
    return c.json({ error: `'${name}'은(는) 예약된 이름이라 사용할 수 없습니다.` }, 400)
  }

  const server = await c.env.DB.prepare('SELECT id, relay_port FROM engine_servers WHERE id = ?')
    .bind(id)
    .first<{ id: number; relay_port: number | null }>()
  if (!server) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)

  const env = c.env as EnvWithDns
  const ip = (env.RELAY_IP ?? '').trim()
  if (!ip) return c.json({ error: '중계 서버 주소가 설정되지 않았습니다. (RELAY_IP)' }, 503)

  const assigned = await assignRelayPort(c.env.DB, server.relay_port)
  if (assigned.error || !assigned.port) {
    return c.json({ error: assigned.error ?? '포트를 잡지 못했습니다.' }, 409)
  }
  const relayPort = assigned.port

  const fqdn = `${name}.lubit.kr`
  // 도메인마다 A 를 하나씩 만드는 대신 와일드카드 하나를 보장합니다.
  // DNS 가 도메인 수만큼 늘어나 관리가 어려워지는 문제를 없앱니다.
  // (upsertDns 가 이미 있으면 덮어쓰므로 매번 호출해도 안전합니다.)
  const a = await upsertDns(env, { type: 'A', name: WILDCARD_A_RECORD, content: ip })
  if (a.error) return c.json({ error: a.error }, 502)

  const host = (env.RELAY_HOST ?? '').trim()
  if (host) {
    // SRV 레코드가 있으면 마인크래프트에 도메인만 입력해도 접속 포트가 알려집니다.
    const srv = await upsertDns(env, {
      type: 'SRV',
      name: `_minecraft._tcp.${fqdn}`,
      data: { priority: 0, weight: 5, port: relayPort, target: host.endsWith('.') ? host : `${host}.` },
    })
    if (srv.error) {
      // A 는 모든 서버가 공유하는 와일드카드라 되돌리면 안 됩니다 — 지우면 전부 멈춥니다.
      return c.json({ error: srv.error }, 502)
    }
  }

  await c.env.DB.prepare('UPDATE engine_servers SET domain = ?, relay_port = ? WHERE id = ?')
    .bind(fqdn, relayPort, id)
    .run()

  return c.json({ domain: fqdn, relayPort, relayHost: host || ip })
})

engine.delete('/servers/:id/domain', async (c) => {
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const id = Number(c.req.param('id'))
  const server = await c.env.DB.prepare('SELECT id, domain FROM engine_servers WHERE id = ?')
    .bind(id)
    .first<{ id: number; domain: string | null }>()
  if (!server) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  if (server.domain) {
    const env = c.env as EnvWithDns
    // A 는 와일드카드라 남깁니다 — 지우면 다른 서버의 도메인까지 죽습니다.
    await deleteDns(env, `_minecraft._tcp.${server.domain}`, 'SRV')
  }
  await c.env.DB.prepare('UPDATE engine_servers SET domain = NULL WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// --- 실행 명령 갱신 (버전 업그레이드 · 백업 복원) ---------------------------
// jar 가 바뀌면 실행 명령(java_cmd)과 마인크래프트 버전도 같이 바뀝니다.
// 이 PC(기기 토큰) 또는 주인·관리자(세션)만 할 수 있습니다.
engine.post('/servers/:id/upgrade', async (c) => {
  const id = Number(c.req.param('id'))
  const body = (await c.req.json().catch(() => ({}))) as { javaCmd?: unknown; version?: unknown }
  const javaCmd = String(body.javaCmd ?? '').slice(0, 2000)
  const version = String(body.version ?? '').slice(0, 64)
  if (!javaCmd.trim()) return c.json({ error: '실행 명령이 없습니다.' }, 400)

  const device = await deviceFromRequest(c)
  if (device) {
    const row = await c.env.DB.prepare('SELECT device_id FROM engine_servers WHERE id = ?')
      .bind(id)
      .first<{ device_id: string | null }>()
    if (!row) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
    if (row.device_id !== device.id) return c.json({ error: '이 기기에 등록된 서버가 아닙니다.' }, 403)
  } else {
    const user = await userFromRequest(c)
    if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
    if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '권한이 없습니다.' }, 403)
  }

  if (version) {
    await c.env.DB.prepare('UPDATE engine_servers SET java_cmd = ?, mc_version = ? WHERE id = ?')
      .bind(javaCmd, version, id)
      .run()
  } else {
    await c.env.DB.prepare('UPDATE engine_servers SET java_cmd = ? WHERE id = ?').bind(javaCmd, id).run()
  }
  return c.json({ ok: true })
})

// --- 클라우드 백업 (R2) -----------------------------------------------------
// 파일 이름은 이 서버 안에서만 읽히도록 제한합니다 — 폴더 밖으로 향할 수 없어야 합니다.
const BACKUP_NAME_RE = /^[\w\uAC00-\uD7A3.-]{1,80}\.zip$/
const BACKUP_LIMIT = 20 // 서버 한 대가 가질 수 있는 백업 수
const BACKUP_MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2GB

// R2 직접 주소 — 이 계정의 런타임이 지원할 때만 쓰고, 아니면 null 을 돌려
// 워커 경유 경로로 넘어갑니다. (타입 정의보다 런타임 존재 여부가 정답입니다.)
async function presign(bucket: R2Bucket, method: 'PUT' | 'GET', key: string) {
  const fn = (bucket as { createPresignedUrl?: (options: unknown) => Promise<string> }).createPresignedUrl
  if (typeof fn !== 'function') return null
  try {
    return String(await fn.call(bucket, { method, key, expiresIn: 3600 }))
  } catch {
    return null
  }
}

function backupKey(serverId: number, name: string) {
  return `servers/${serverId}/${name}`
}

// 목록 — 주인과 관리자가 같이 봅니다.
engine.get('/servers/:id/backups', async (c) => {
  const id = Number(c.req.param('id'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  const role = await serverRole(c.env.DB, user, id)
  if (!role) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  const rows = await c.env.DB.prepare(
    'SELECT id, name, size, created_at FROM engine_backups WHERE server_id = ? ORDER BY id DESC LIMIT 50',
  )
    .bind(id)
    .all<{ id: number; name: string; size: number; created_at: number }>()
  return c.json({
    role,
    backups: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      size: row.size,
      createdAt: row.created_at,
    })),
  })
})

// 업로드 준비 — R2 직접 주소를 받습니다. R2 를 쓸 수 없는 환경이면 워커가 대신 받습니다.
engine.post('/servers/:id/backups/presign', async (c) => {
  const id = Number(c.req.param('id'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '권한이 없습니다.' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown }
  const name = String(body.name ?? '')
  if (!BACKUP_NAME_RE.test(name)) return c.json({ error: '백업 이름이 올바르지 않습니다.' }, 400)
  if (!c.env.BACKUPS) return c.json({ error: '클라우드 백업 저장소가 아직 연결되지 않았습니다.' }, 503)

  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM engine_backups WHERE server_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if ((used?.n ?? 0) >= BACKUP_LIMIT) {
    return c.json({ error: `클라우드 백업이 ${BACKUP_LIMIT}개 가 가득 찼습니다 — 오래된 것을 지운 뒤 올려 주세요.` }, 400)
  }

  const key = backupKey(id, name)
  const uploadUrl = await presign(c.env.BACKUPS, 'PUT', key)
  if (uploadUrl) return c.json({ uploadUrl, key })
  // presign 을 못 쓰는 계정이면 워커 경유 경로를 돌려줍니다 (100MB 이하).
  return c.json({
    uploadUrl: `/api/engine/servers/${id}/backups/upload?name=${encodeURIComponent(name)}`,
    key,
    proxy: true,
  })
})

// 워커 경유 업로드 — R2 presign 을 못 쓸 때의 대비책.
engine.put('/servers/:id/backups/upload', async (c) => {
  const id = Number(c.req.param('id'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '권한이 없습니다.' }, 403)
  const name = c.req.query('name') || ''
  if (!BACKUP_NAME_RE.test(name)) return c.json({ error: '백업 이름이 올바르지 않습니다.' }, 400)
  if (!c.env.BACKUPS) return c.json({ error: '클라우드 백업 저장소가 아직 연결되지 않았습니다.' }, 503)
  const body = c.req.raw.body
  if (!body) return c.json({ error: '보낸 파일이 없습니다.' }, 400)
  await c.env.BACKUPS.put(backupKey(id, name), body, {
    httpMetadata: { contentType: 'application/zip' },
  })
  return c.json({ ok: true })
})

// 업로드 확인 — 실제로 올라갔는지 확인한 뒤 목록에 남깁니다.
engine.post('/servers/:id/backups', async (c) => {
  const id = Number(c.req.param('id'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '권한이 없습니다.' }, 403)

  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; size?: unknown }
  const name = String(body.name ?? '')
  if (!BACKUP_NAME_RE.test(name)) return c.json({ error: '백업 이름이 올바르지 않습니다.' }, 400)
  if (!c.env.BACKUPS) return c.json({ error: '클라우드 백업 저장소가 아직 연결되지 않았습니다.' }, 503)

  const key = backupKey(id, name)
  const object = await c.env.BACKUPS.head(key)
  if (!object) return c.json({ error: '파일이 아직 올라가지 않았습니다 — 다시 시도해 주세요.' }, 400)
  if (object.size > BACKUP_MAX_BYTES) {
    await c.env.BACKUPS.delete(key)
    return c.json({ error: '백업이 2GB 를 넘어 클라우드에 넣을 수 없습니다.' }, 400)
  }

  const existing = await c.env.DB.prepare('SELECT id FROM engine_backups WHERE server_id = ? AND name = ?')
    .bind(id, name)
    .first<{ id: number }>()
  if (existing) {
    await c.env.DB.prepare('UPDATE engine_backups SET size = ?, created_at = ? WHERE id = ?')
      .bind(object.size, Date.now(), existing.id)
      .run()
    return c.json({ ok: true, id: existing.id })
  }

  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM engine_backups WHERE server_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if ((used?.n ?? 0) >= BACKUP_LIMIT) {
    await c.env.BACKUPS.delete(key)
    return c.json({ error: `클라우드 백업이 ${BACKUP_LIMIT}개 가 가득 찼습니다.` }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO engine_backups (server_id, name, object_key, size, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, name, key, object.size, Date.now())
    .run()
  return c.json({ ok: true, id: result.meta.last_row_id })
})

// 내려받기 주소 — R2 직접 주소를 받고, 못 받으면 워커가 대신 흘려보냅니다.
engine.get('/servers/:id/backups/:bid/url', async (c) => {
  const id = Number(c.req.param('id'))
  const bid = Number(c.req.param('bid'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  const row = await c.env.DB.prepare('SELECT object_key, name FROM engine_backups WHERE id = ? AND server_id = ?')
    .bind(bid, id)
    .first<{ object_key: string; name: string }>()
  if (!row) return c.json({ error: '백업을 찾을 수 없습니다.' }, 404)
  if (!c.env.BACKUPS) return c.json({ error: '클라우드 백업 저장소가 아직 연결되지 않았습니다.' }, 503)
  const direct = await presign(c.env.BACKUPS, 'GET', row.object_key)
  if (direct) return c.json({ url: direct })
  return c.json({ url: `/api/engine/servers/${id}/backups/${bid}/file` })
})

// 워커 경유 내려받기 — presign 을 못 쓸 때.
engine.get('/servers/:id/backups/:bid/file', async (c) => {
  const id = Number(c.req.param('id'))
  const bid = Number(c.req.param('bid'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '서버를 찾을 수 없습니다.' }, 404)
  const row = await c.env.DB.prepare('SELECT object_key, name FROM engine_backups WHERE id = ? AND server_id = ?')
    .bind(bid, id)
    .first<{ object_key: string; name: string }>()
  if (!row) return c.json({ error: '백업을 찾을 수 없습니다.' }, 404)
  if (!c.env.BACKUPS) return c.json({ error: '클라우드 백업 저장소가 연결되지 않았습니다.' }, 503)
  const object = await c.env.BACKUPS.get(row.object_key)
  if (!object) return c.json({ error: '파일이 저장소에 없습니다.' }, 404)
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${row.name}"`,
    },
  })
})

// 삭제 — 저장소에서도 지웁니다.
engine.delete('/servers/:id/backups/:bid', async (c) => {
  const id = Number(c.req.param('id'))
  const bid = Number(c.req.param('bid'))
  const user = await userFromRequest(c)
  if (!user) return c.json({ error: '로그인이 필요합니다.' }, 401)
  if (!(await serverRole(c.env.DB, user, id))) return c.json({ error: '권한이 없습니다.' }, 403)
  const row = await c.env.DB.prepare('SELECT object_key FROM engine_backups WHERE id = ? AND server_id = ?')
    .bind(bid, id)
    .first<{ object_key: string }>()
  if (!row) return c.json({ error: '백업을 찾을 수 없습니다.' }, 404)
  if (c.env.BACKUPS) await c.env.BACKUPS.delete(row.object_key).catch(() => undefined)
  await c.env.DB.prepare('DELETE FROM engine_backups WHERE id = ? AND server_id = ?').bind(bid, id).run()
  return c.json({ ok: true })
})
