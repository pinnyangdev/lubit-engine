import { LogOut, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { Aurora } from '../components/Aurora'
import { Container } from '../components/Container'

const TOKEN_KEY = 'lubit-admin-token'

type Stats = {
  servers: number
  running: number
  users: number
  admins: number
  domains: number
  inquiries: number
}

const TILES: { key: keyof Stats; label: string; note: string }[] = [
  { key: 'servers', label: '전체 서버', note: '등록된 서버' },
  { key: 'running', label: '실행 중', note: '지금 돌고 있는 서버' },
  { key: 'users', label: '회원', note: '가입한 계정' },
  { key: 'admins', label: '관리자 위임', note: '서버를 공유한 수' },
  { key: 'domains', label: '도메인 사용', note: '자기 도메인을 단 서버' },
  { key: 'inquiries', label: '문의함', note: '채팅으로 들어온 대화' },
]

// 스태프 전용 대시보드입니다 — 채팅 수신함과 똑같은 INBOX_TOKEN 비밀번호로 엽니다.
// 서버 · 회원 현황을 한 화면에서 보고, 문의함은 바로 넘어갑니다.
export function AdminPage() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')

  const headers = useCallback(
    (): HeadersInit => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token],
  )

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/stats', { headers: headers() })
      const data = (await response.json()) as Partial<Stats> & { error?: string }
      if (!response.ok) {
        setError(data.error ?? '현황을 받지 못했습니다.')
        if (response.status === 401 || response.status === 403) setToken('')
        return
      }
      setError('')
      setStats({
        servers: Number(data.servers ?? 0),
        running: Number(data.running ?? 0),
        users: Number(data.users ?? 0),
        admins: Number(data.admins ?? 0),
        domains: Number(data.domains ?? 0),
        inquiries: Number(data.inquiries ?? 0),
      })
    } catch {
      setError('현황을 받지 못했습니다 — 잠시 후 다시 시도해 주세요.')
    }
  }, [headers])

  useEffect(() => {
    if (!token) return
    void load()
    const id = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(id)
  }, [token, load])

  function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = (event.currentTarget.elements.namedItem('token') as HTMLInputElement).value.trim()
    if (!value) return
    try {
      sessionStorage.setItem(TOKEN_KEY, value)
    } catch {
      /* 저장을 못 하면 이번 탭 동안만 씁니다 */
    }
    setToken(value)
  }

  if (!token) {
    return (
      <section className="relative overflow-hidden pt-36 pb-20 sm:pt-44">
        <Aurora intensity={0.6} />
        <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[520px]" />
        <Container className="relative max-w-[440px]">
          <div className="depth relative rounded-card bg-surface p-7 shadow-glow">
            <h1 className="text-[24px] font-semibold tracking-tight">관리자 대시보드</h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">
              접속 비밀번호를 입력하세요. 설정하지 않았다면 .dev.vars 의 INBOX_TOKEN 을 채워 주세요.
            </p>
            <form onSubmit={submitToken} className="mt-6 flex gap-2">
              <input
                name="token"
                type="password"
                autoFocus
                placeholder="비밀번호"
                className="depth h-11 min-w-0 flex-1 rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-[12px] bg-accent px-5 text-[14px] font-medium text-bg"
              >
                열기
              </button>
            </form>
            {error && <p className="mt-3 text-[13px] text-accent-3">{error}</p>}
            <a href="/" className="mt-5 inline-block text-[13px] text-muted hover:text-fg">
              홈으로 돌아가기
            </a>
          </div>
        </Container>
      </section>
    )
  }

  return (
    <section className="border-t border-line py-10 sm:py-14">
      <Container>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight">관리자 대시보드</h1>
            <p className="mt-1 text-[14px] text-muted">10초마다 자동으로 갱신됩니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/support/inbox"
              className="h-10 rounded-[12px] border border-line/60 px-4 text-[14px] text-muted transition hover:text-fg"
            >
              문의함 열기
            </a>
            <button
              type="button"
              onClick={() => void load()}
              className="grid size-10 place-items-center rounded-[12px] text-muted transition hover:bg-white/[0.06] hover:text-fg"
              aria-label="새로고침"
            >
              <RefreshCw className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  sessionStorage.removeItem(TOKEN_KEY)
                } catch {
                  /* ignore */
                }
                setToken('')
                setStats(null)
              }}
              className="grid size-10 place-items-center rounded-[12px] text-muted transition hover:bg-white/[0.06] hover:text-fg"
              aria-label="로그아웃"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-[13px] text-accent-3">{error}</p>}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((tile) => (
            <div key={tile.key} className="depth rounded-card bg-surface p-5">
              <p className="text-[13px] text-muted">{tile.label}</p>
              <p className="mt-2 text-[32px] leading-none font-semibold tracking-tight tabular-nums text-fg">
                {stats === null ? '—' : stats[tile.key]}
              </p>
              <p className="mt-2 text-[12px] text-faint">{tile.note}</p>
            </div>
          ))}
        </div>

        {stats === null && !error && (
          <p className="mt-6 text-[14px] text-faint">현황을 불러오는 중…</p>
        )}
      </Container>
    </section>
  )
}
