import { LogOut, Play, RotateCw, Send, Square, Terminal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Aurora } from '../components/Aurora'
import { Button } from '../components/Button'
import { Container } from '../components/Container'
import { AccessPanel, AdminsPanel, FilesPanel, MapPanel, PlayersPanel, PluginsPanel } from '../components/ServerPanels'
import { cx } from '../lib/cx'
import { API, api, isModServer, streamEngine, TOKEN_KEY, type DeviceRow, type EngineSnapshot, type LogRow, type ServerRow } from '../lib/engineApi'

type User = { id: number; email: string; displayName: string }

type Tab = 'console' | 'files' | 'plugins' | 'players' | 'map' | 'access' | 'admins'

const TABS: [Tab, string][] = [
  ['console', '콘솔'],
  ['files', '파일'],
  ['plugins', '플러그인'],
  ['players', '플레이어'],
  ['map', '월드 지도'],
  ['access', '접속'],
  ['admins', '관리자'],
]

// OAuth 리다이렉트가 ?error= 로 돌아올 때 보여줄 문구.
const oauthErrors: Record<string, string> = {
  discord_not_configured: '디스코드 로그인은 아직 설정되지 않았습니다. 지금은 이메일로 가입할 수 있습니다.',
  discord_access_denied: '디스코드 로그인을 취소하셨습니다.',
  discord_invalid_code: '디스코드 인증에 실패했습니다. 다시 시도해 주세요.',
  google_not_configured: '구글 로그인은 아직 설정되지 않았습니다. 지금은 이메일로 가입할 수 있습니다.',
  google_access_denied: '구글 로그인을 취소하셨습니다.',
  google_invalid_code: '구글 인증에 실패했습니다. 다시 시도해 주세요.',
}

const stateStyle: Record<string, string> = {
  running: 'bg-accent',
  starting: 'bg-accent-2',
  stopping: 'bg-accent-2',
  crashed: 'bg-accent-3',
  offline: 'bg-white/20',
}
const stateLabel: Record<string, string> = {
  running: '실행 중',
  starting: '시작 중',
  stopping: '중지 중',
  crashed: '중지됨(오류)',
  offline: '중지됨',
}

export function ConsolePage() {
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem(TOKEN_KEY)
    const fromUrl = new URLSearchParams(window.location.search).get('token')
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl)
      window.history.replaceState({}, '', '/console')
      return fromUrl
    }
    return saved
  })
  const [user, setUser] = useState<User | null>(null)
  // 디스코드 OAuth 가 실패하거나 아직 설정되지 않은 경우 콘솔로 되돌아옵니다.
  const [error, setError] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('error')
    if (!code) return ''
    params.delete('error')
    const rest = params.toString()
    window.history.replaceState({}, '', `/console${rest ? `?${rest}` : ''}`)
    return (
      oauthErrors[code] ??
      (code.startsWith('discord_')
        ? '디스코드 로그인에 실패했습니다. 다시 시도해 주세요.'
        : code.startsWith('google_')
          ? '구글 로그인에 실패했습니다. 다시 시도해 주세요.'
          : '로그인하지 못했습니다.')
    )
  })

  const load = useCallback(async (next: string | null) => {
    if (!next) {
      setUser(null)
      return
    }
    try {
      const data = await api<{ user: User }>('/auth/me', { token: next })
      setUser(data.user)
      setError('')
    } catch (err) {
      localStorage.removeItem(TOKEN_KEY)
      setToken(null)
      setUser(null)
      setError(err instanceof Error ? err.message : '')
    }
  }, [])

  useEffect(() => {
    void load(token)
  }, [token, load])

  function signOut() {
    void api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  return (
    <section className="relative min-h-screen overflow-hidden pt-32 pb-20 sm:pt-36">
      <Aurora intensity={0.5} />
      <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[520px]" />
      <Container className="relative">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-accent">서버 구동기</p>
            <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.03em] sm:text-[38px]">
              {user ? `${user.displayName}님의 서버` : '서버 관리 콘솔'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <>
                <span className="text-[13px] text-muted">{user.email}</span>
                <Button variant="ghost" onClick={signOut}>
                  <LogOut className="size-4" />
                  로그아웃
                </Button>
              </>
            )}
          </div>
        </header>

        {error && <p className="mt-4 text-[13px] text-accent-3">{error}</p>}

        <div className="mt-8">
          {!user ? (
            <AuthBox
              onSignedIn={(next) => {
                setToken(next)
                void load(next)
              }}
            />
          ) : (
            <Dashboard />
          )}
        </div>
      </Container>
    </section>
  )
}

// --- 로그인 / 가입 ----------------------------------------------------------

function AuthBox({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [discordReady, setDiscordReady] = useState<boolean | null>(null)
  const [googleReady, setGoogleReady] = useState<boolean | null>(null)

  // 서버에 시크릿이 있는지 확인해 버튼을 그대로 둡니다. (없는 쪽은 안내로 대체)
  useEffect(() => {
    let alive = true
    const check = async (path: string) => {
      try {
        const res = await fetch(`${API}${path}`)
        const data = (await res.json()) as { configured?: boolean }
        return Boolean(data.configured)
      } catch {
        return false
      }
    }
    void (async () => {
      const [discord, google] = await Promise.all([
        check('/auth/discord/status'),
        check('/auth/google/status'),
      ])
      if (!alive) return
      setDiscordReady(discord)
      setGoogleReady(google)
    })()
    return () => {
      alive = false
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const data = await api<{ token: string }>(
        mode === 'login' ? '/auth/login' : '/auth/register',
        { method: 'POST', body: { email, password, name } },
      )
      localStorage.setItem(TOKEN_KEY, data.token)
      onSignedIn(data.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const input =
    'depth h-11 w-full rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]'

  return (
    // [&>*]:min-w-0 — 휴대폰에서 한 칸이 화면보다 넓어지는 것을 막습니다.
    <div className="grid gap-4 lg:grid-cols-[420px_1fr] [&>*]:min-w-0">
      <div className="depth rounded-card bg-surface p-6 shadow-glow">
        <div className="flex gap-1 rounded-[12px] bg-white/[0.04] p-1">
          {(['login', 'register'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={cx(
                'h-9 flex-1 rounded-[9px] text-[13px] font-medium transition',
                mode === key ? 'bg-white/[0.10] text-fg' : 'text-muted hover:text-fg',
              )}
            >
              {key === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-2.5">
          {mode === 'register' && (
            <>
              <label className="sr-only" htmlFor="engine-name">
                이름
              </label>
              <input
                id="engine-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름 (선택)"
                className={input}
              />
            </>
          )}
          <label className="sr-only" htmlFor="engine-email">
            이메일
          </label>
          <input
            id="engine-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            className={input}
          />
          <label className="sr-only" htmlFor="engine-password">
            비밀번호
          </label>
          <input
            id="engine-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 (8자 이상)"
            className={input}
          />
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? '확인 중…' : mode === 'login' ? '로그인' : '계정 만들기'}
          </Button>
        </form>

        {error && <p className="mt-3 text-[13px] text-accent-3">{error}</p>}

        {googleReady === false && discordReady === false ? (
          <p className="depth mt-3 flex h-11 items-center justify-center rounded-[12px] bg-white/[0.03] px-3 text-[12px] text-faint">
            소셜 로그인은 준비 중입니다. 지금은 이메일로 가입할 수 있습니다.
          </p>
        ) : (
          <>
            {googleReady === true && (
              <a
                href={`${API}/auth/google/start`}
                className="depth mt-3 flex h-11 items-center justify-center gap-2 rounded-[12px] bg-white/[0.04] text-[14px] text-fg transition hover:bg-white/[0.08]"
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-4">
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.44a5.52 5.52 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.59-5.17 3.59-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
                  />
                </svg>
                구글로 로그인
              </a>
            )}
            {discordReady === true && (
              <a
                href={`${API}/auth/discord/start`}
                className={`depth flex h-11 items-center justify-center gap-2 rounded-[12px] bg-white/[0.04] text-[14px] text-fg transition hover:bg-white/[0.08] ${googleReady === true ? 'mt-2' : 'mt-3'}`}
              >
                <svg aria-hidden viewBox="0 0 24 24" className="size-4 fill-current">
                  <path d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4l-.2.4c1.4.4 2.6 1 3.7 1.8a13.7 13.7 0 0 0-11.2 0c1.1-.8 2.3-1.4 3.7-1.8L10.9 4a16.6 16.6 0 0 0-4.17 1.33C3.7 9.3 2.9 13.2 3.3 17a16.7 16.7 0 0 0 5 2.5c.4-.55.77-1.14 1.08-1.76-.6-.22-1.17-.5-1.7-.83.14-.1.28-.22.42-.33a12 12 0 0 0 10.2 0c.14.11.28.23.42.33-.54.33-1.1.6-1.7.83.31.62.68 1.2 1.08 1.77a16.6 16.6 0 0 0 5-2.5c.5-4.45-.74-8.32-3.53-11.67ZM8.7 14.7c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2c1 0 1.82.9 1.79 2 0 1.1-.79 2-1.79 2Zm6.6 0c-.98 0-1.79-.9-1.79-2s.79-2 1.79-2c1 0 1.82.9 1.79 2 0 1.1-.79 2-1.79 2Z" />
                </svg>
                디스코드로 로그인
              </a>
            )}
            {(googleReady === true || discordReady === true) && (
              <p className="mt-3 text-[12px] leading-relaxed text-faint">
                소셜 계정으로 바로 로그인합니다. 같은 이메일로 만든 계정이 있으면 그 계정에 그대로 연결됩니다.
              </p>
            )}
          </>
        )}
      </div>

      <div className="depth relative overflow-hidden rounded-card bg-surface p-7 shadow-glow">
        <h2 className="text-[19px] font-semibold tracking-tight">이런 순서로 씁니다</h2>
        <ol className="mt-5 flex flex-col gap-4">
          {          [
            ['PC 앱 내려받기', '서버 구동기를 내려받아 같은 계정으로 로그인하면, 이 PC가 자동으로 연결됩니다.'],
            ['서버 만들기', 'PC 앱에서 버킷 종류(페이퍼·포지·페브릭 등)와 버전, 메모리를 골라 서버를 만듭니다. 서버는 C:\\LubitServers 에 생깁니다.'],
            ['관리', '이 웹과 휴대폰에서도 같은 계정으로 로그인하면 시작·중지·재시작과 콘솔 입력, 로그를 실시간으로 봅니다.'],
            ['권한', '서버를 만드는 일만 PC 에서 하고, 관리는 어느 기기에서든 됩니다.'],
            ['휴대폰', '휴대폰은 서버 구동기 페이지의 내려받기에서 Android 앱을 설치하면 앱으로 열립니다. 아이폰은 사파리에서 홈 화면에 추가해 주세요.'],
          ].map(([title, description], i) => (
            <li key={title} className="flex gap-4">
              <span className="depth grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-[13px] font-semibold tabular-nums text-accent">
                {i + 1}
              </span>
              <div>
                <p className="text-[15px] font-medium">{title}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-muted">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

// --- 대시보드 ---------------------------------------------------------------

function Dashboard() {
  const [servers, setServers] = useState<ServerRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  // 실시간 연결이 살아 있는 동안에는 같은 내용을 폴링으로 다시 받지 않습니다.
  const lastLive = useRef(0)

  // 로그는 실시간 스트림으로 받습니다 — 웹이 주기적으로 따로 로그를 물어보던 걸 없앱니다.
  const [logs, setLogs] = useState<LogRow[]>([])
  const logCursor = useRef(0)

  // 스트림에서 온 로그를 이어 붙입니다. 이미 받은 줄은 id 로 걸러 중복을 막습니다.
  const appendLogs = useCallback((rows: LogRow[]) => {
    if (rows.length === 0) return
    const fresh = rows.filter((row) => row.id > logCursor.current)
    if (fresh.length === 0) return
    logCursor.current = fresh[fresh.length - 1].id
    setLogs((prev) => [...prev, ...fresh].slice(-600))
  }, [])

  // 서버를 고르면 지난 로그를 한 번 읽어 화면을 채우고, 그 뒤로는 스트림이 이어 붙입니다.
  useEffect(() => {
    if (selected === null) return
    let alive = true
    setLogs([])
    logCursor.current = 0

    const pull = async () => {
      try {
        const data = await api<{ logs: LogRow[]; next: number }>(
          '/servers/' + selected + '/logs?since=' + logCursor.current + '&limit=300',
        )
        if (!alive) return
        const fresh = data.logs.filter((row) => row.id > logCursor.current)
        if (fresh.length === 0) return
        logCursor.current = data.next
        setLogs((prev) => [...prev, ...fresh].slice(-600))
      } catch {
        /* 스트림이 이미 채우고 있으면 조용히 넘어갑니다 */
      }
    }
    void pull()
    // 실시간 스트림이 죽었을 때의 안전망 — 주기를 크게 늘려 Workers 요청 수를 아닙니다.
    const id = window.setInterval(pull, 60_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [selected])

  useEffect(() => {
    let alive = true
    const controller = new AbortController()

    // 서버·기기 목록을 1초 주기로 밀어받습니다. 플레이어 접속·퇴장도 여기서 반영됩니다.
    const apply = (data: EngineSnapshot) => {
      if (!alive) return
      lastLive.current = Date.now()
      setServers(data.servers)
      setDevices(data.devices)
    }

    const open = async () => {
      while (alive) {
        try {
          await streamEngine(apply, controller.signal, appendLogs)
        } catch {
          /* 로그아웃·네트워크 끊김 — 잠시 후 다시 엽니다 */
        }
        if (!alive) return
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
    void open()

    const tick = async () => {
      // 실시간으로 방금 받았으면 폴링은 건너뜁니다. 스트림이 죽었을 때의 안전망입니다.
      if (Date.now() - lastLive.current < 8000) return
      try {
        const [list, deviceList] = await Promise.all([
          api<{ servers: ServerRow[] }>('/servers'),
          api<{ devices: DeviceRow[] }>('/devices'),
        ])
        if (!alive) return
        setServers(list.servers)
        setDevices(deviceList.devices)
      } catch {
        /* 잠시 실패해도 다음 폴링에서 다시 받습니다 */
      }
    }
    void tick()
    // 실시간 스트림이 죽었을 때의 안전망 — 길수록 Workers 일일 요청 한도를 아낍니다.
    const id = window.setInterval(tick, 10000)
    return () => {
      alive = false
      controller.abort()
      window.clearInterval(id)
    }
  }, [])

  const active = servers.find((s) => s.id === selected) ?? null

  return (
    // [&>*]:min-w-0 — 휴대폰에서 옆으로 밀리지 않도록 한 칸의 최소 폭을 0 으로 둡니다.
    <div className="grid gap-4 lg:grid-cols-[320px_1fr] [&>*]:min-w-0">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="depth rounded-card bg-surface p-4 shadow-glow">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-semibold">서버</p>
          </div>

          {/* 서버 생성은 폴더와 서버 파일이 필요한 PC 앱에서만 합니다. */}
          <p className="mt-3 rounded-[12px] border border-line bg-white/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-faint">
            서버 만들기는 <span className="text-muted">PC 앱</span>에서만 가능합니다.{' '}
            <a href="/engine" className="text-accent underline-offset-2 hover:underline">
              서버 구동기 내려받기
            </a>
            후 같은 계정으로 로그인하면 서버가 이 목록에 나타납니다.
          </p>

          <ul className="mt-3 flex flex-col gap-1.5">
            {servers.length === 0 && <li className="px-1 py-3 text-[13px] text-faint">등록된 서버가 없습니다.</li>}
            {servers.map((server) => (
              <li key={server.id}>
                <button
                  type="button"
                  onClick={() => setSelected(server.id)}
                  className={cx(
                    'w-full rounded-[12px] px-3 py-2.5 text-left transition',
                    selected === server.id ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cx('size-2 shrink-0 rounded-full', stateStyle[server.state] ?? 'bg-white/20')} />
                    <span className="truncate text-[14px] font-medium">{server.name}</span>
                  </span>
                  <span className="mt-1 block text-[12px] text-faint">
                    {stateLabel[server.state] ?? server.state}
                    {server.state === 'running' && server.players !== null
                      ? ` · ${server.players}/${server.max_players ?? '?'}명`
                      : ''}
                    {server.device_id ? '' : ' · 기기 미연결'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <DevicePanel devices={devices} />
      </div>

      {active ? (
        <ConsolePanel server={active} devices={devices} logs={logs} />
      ) : (
        <div className="depth flex min-h-[420px] items-center justify-center rounded-card bg-surface p-8 text-center shadow-glow">
          <p className="text-[14px] text-muted">
            왼쪽에서 서버를 고르세요.
            <br />
            서버 만들기는 PC 앱에서, 관리는 웹·휴대폰 어디에서든 할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}

function DevicePanel({ devices }: { devices: DeviceRow[] }) {
  return (
    <div className="depth rounded-card bg-surface p-4 shadow-glow">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold">연결된 PC</p>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">
        PC 앱(<a href="/engine" className="text-accent underline-offset-2 hover:underline">서버 구동기</a>)에 같은 계정으로 로그인하면 기기가 자동으로 연결됩니다.
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {devices.length === 0 && <li className="px-1 py-2 text-[13px] text-faint">아직 등록된 PC가 없습니다.</li>}
        {devices.map((device) => (
          <li key={device.id} className="flex items-center justify-between gap-2 px-1 py-1.5">
            <span className="truncate text-[13px]">{device.name}</span>
            <span
              className={cx(
                'shrink-0 text-[11px]',
                device.last_seen && Date.now() - device.last_seen < 90_000 ? 'text-accent' : 'text-faint',
              )}
            >
              {device.last_seen && Date.now() - device.last_seen < 90_000 ? '연결됨' : '대기'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- 콘솔 -------------------------------------------------------------------

function ConsolePanel({ server, devices, logs }: { server: ServerRow; devices: DeviceRow[]; logs: LogRow[] }) {
  const [line, setLine] = useState('')
  const [copied, setCopied] = useState(false)
  const logBox = useRef<HTMLDivElement>(null)
  // 로그 목록은 부모가 실시간 스트림으로 모읍니다 — 여기선 그리기만 합니다.

  useEffect(() => {
    // 스크롤박스 안쪽만 내려서, 휴대폰에서 키보드가 뜬 채로 페이지 전체가 튕기지 않게 합니다.
    const box = logBox.current
    if (box) box.scrollTop = box.scrollHeight
  }, [logs])

  async function send(type: 'start' | 'stop' | 'restart' | 'command', args: Record<string, string> = {}) {
    try {
      await api(`/servers/${server.id}/commands`, { method: 'POST', body: { type, args } })
    } catch {
      /* 실패하면 상태가 그대로라 바로 알 수 있습니다 */
    }
  }

  async function assign(deviceId: string) {
    await api(`/servers/${server.id}/assign`, { method: 'POST', body: { deviceId: deviceId || null } })
  }

  const running = server.state === 'running' || server.state === 'starting'
  const [tab, setTab] = useState<Tab>('console')

  return (
    <div className="depth flex max-h-[calc(100vh-320px)] min-h-[520px] flex-col rounded-card bg-surface shadow-glow">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className={cx('size-2.5 rounded-full', stateStyle[server.state] ?? 'bg-white/20')} />
        <h2 className="text-[16px] font-semibold">{server.name}</h2>
        <span className="text-[13px] text-muted">{stateLabel[server.state] ?? server.state}</span>

        <div className="ml-auto flex items-center gap-2">
          {/* 기기 변경은 주인만 할 수 있으므로 관리자에게는 고르는 칸을 숨깁니다. */}
          {server.is_owner !== 0 && (
          <select
            value={server.device_id ?? ''}
            onChange={(e) => void assign(e.target.value)}
            className="h-9 rounded-[10px] border border-line bg-bg/60 px-2 text-[13px] text-fg focus:outline-none"
          >
            <option value="">기기 선택</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
          )}
          <button
            type="button"
            onClick={() => void send(running ? 'stop' : 'start')}
            className="grid size-9 place-items-center rounded-[10px] bg-accent text-bg transition hover:brightness-110"
            aria-label={running ? '중지' : '시작'}
          >
            {running ? <Square className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => void send('restart')}
            className="grid size-9 place-items-center rounded-[10px] bg-white/[0.06] text-fg transition hover:bg-white/[0.10]"
            aria-label="재시작"
          >
            <RotateCw className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cx(
              'shrink-0 rounded-[10px] px-3 py-1.5 text-[13px] transition',
              tab === key ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-white/[0.05] hover:text-fg',
            )}
          >
            {/* 모드 서버에서는 플러그인 탭을 "모드" 로 부릅니다. */}
            {key === 'plugins' && isModServer(server.server_type) ? '모드' : label}
          </button>
        ))}
      </div>

      {tab === 'console' && (
      <div className="flex items-center gap-4 border-b border-line px-5 py-3 text-[13px] text-muted">
        <span>
          접속 <span className="text-fg tabular-nums">{server.players ?? '—'}</span>
          {server.max_players !== null ? ` / ${server.max_players}` : ''}
        </span>
        <span className="truncate">폴더 {server.server_dir || '미지정'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(server.java_cmd)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
          className="ml-auto flex shrink-0 items-center gap-1.5 text-faint transition hover:text-fg"
        >
          <Terminal className="size-3.5" />
          {copied ? '복사됨' : '실행 명령 복사'}
        </button>
      </div>
      )}

      {server.last_error && (
        <p className="border-b border-line bg-accent-3/10 px-5 py-2 text-[13px] text-accent-3">{server.last_error}</p>
      )}

      {tab !== 'console' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'files' && <FilesPanel server={server} />}
          {tab === 'plugins' && <PluginsPanel server={server} />}
          {tab === 'players' && <PlayersPanel server={server} />}
          {tab === 'map' && <MapPanel server={server} />}
          {tab === 'access' && <AccessPanel server={server} />}
          {tab === 'admins' && <AdminsPanel server={server} />}
        </div>
      ) : (
        <>
      <div
        ref={logBox}
        className="min-h-0 flex-1 overflow-y-auto bg-bg/40 px-5 py-4 font-mono text-[13px] leading-relaxed"
      >
        {logs.length === 0 && <p className="text-faint">로그가 없습니다. 서버를 시작하면 여기에 쌓입니다.</p>}
        {logs.map((log) => (
          <p key={log.id} className="whitespace-pre-wrap break-words text-fg/85">
            {log.line}
          </p>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          const value = line.trim()
          if (!value) return
          void send('command', { line: value })
          setLine('')
        }}
        className="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <input
          value={line}
          onChange={(e) => setLine(e.target.value)}
          placeholder="콘솔 명령 입력 (예: say 안녕하세요, list, stop)"
          className="depth h-11 min-w-0 flex-1 rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
        />
        <button
          type="submit"
          className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent text-bg transition hover:brightness-110"
          aria-label="명령 보내기"
        >
          <Send className="size-4" />
        </button>
      </form>
        </>
      )}
    </div>
  )
}
