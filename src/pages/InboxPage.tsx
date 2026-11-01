import { LogOut, RefreshCw, Send } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Aurora } from '../components/Aurora'
import { Container } from '../components/Container'
import { cx } from '../lib/cx'

const TOKEN_KEY = 'lubit-inbox-token'

type Session = {
  sessionId: string
  lastBody: string
  lastRole: string
  updated: number
  visitorCount: number
  agentCount: number
  name: string | null
}

type ChatMessage = { id: number; role: string; body: string; created_at: number }

function formatTime(ms: number) {
  if (!ms) return ''
  return new Date(ms).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Private inbox for the studio owner: same site, password-protected.
export function InboxPage() {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [draft, setDraft] = useState('')

  const [sessions, setSessions] = useState<Session[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token],
  )

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/inbox', { headers: headers() })
      if (response.status === 401 || response.status === 403) {
        setToken('')
        setError('비밀번호가 맞지 않습니다.')
        return
      }
      if (!response.ok) throw new Error()
      const data = (await response.json()) as { sessions: Session[] }
      setSessions(data.sessions)
      setError('')
    } catch {
      setError('수신함을 불러오지 못했습니다.')
    }
  }, [headers])

  const loadThread = useCallback(
    async (sessionId: string) => {
      try {
        const response = await fetch(`/api/inbox/${encodeURIComponent(sessionId)}`, { headers: headers() })
        if (!response.ok) throw new Error()
        const data = (await response.json()) as { messages: ChatMessage[] }
        setThread(data.messages)
      } catch {
        /* keep the previous thread on a transient failure */
      }
    },
    [headers],
  )

  useEffect(() => {
    if (!token) return
    void loadSessions()
    // 요청 한도를 아끼기 위한 주기 — 관리자 화면이라 즉시성이 덜 중요합니다.
    const id = window.setInterval(() => void loadSessions(), 15000)
    return () => window.clearInterval(id)
  }, [token, loadSessions])

  useEffect(() => {
    if (!token || !active) {
      setThread([])
      return
    }
    void loadThread(active)
    const id = window.setInterval(() => void loadThread(active), 15000)
    return () => window.clearInterval(id)
  }, [token, active, loadThread])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [thread])

  function submitToken(event: FormEvent) {
    event.preventDefault()
    const value = (event.target as HTMLFormElement & { token: HTMLInputElement }).token.value.trim()
    if (!value) return
    try {
      sessionStorage.setItem(TOKEN_KEY, value)
    } catch {
      /* ignore */
    }
    setToken(value)
    setError('')
  }

  async function reply(event: FormEvent) {
    event.preventDefault()
    if (!active || !draft.trim()) return
    setSending(true)
    try {
      const response = await fetch(`/api/inbox/${encodeURIComponent(active)}/reply`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ body: draft.trim() }),
      })
      if (!response.ok) throw new Error()
      setDraft('')
      await loadThread(active)
      await loadSessions()
    } catch {
      setError('회신을 보내지 못했습니다.')
    } finally {
      setSending(false)
    }
  }

  if (!token) {
    return (
      <section className="relative overflow-hidden pt-36 pb-20 sm:pt-44">
        <Aurora intensity={0.6} />
        <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[520px]" />
        <Container className="relative max-w-[440px]">
          <div className="depth relative rounded-card bg-surface p-7 shadow-glow">
            <h1 className="text-[24px] font-semibold tracking-tight">채팅 수신함</h1>
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
              <button type="submit" className="h-11 shrink-0 rounded-[12px] bg-accent px-5 text-[14px] font-medium text-bg">
                열기
              </button>
            </form>
            {error && <p className="mt-3 text-[13px] text-accent-3">{error}</p>}
            <a href="/support" className="mt-5 inline-block text-[13px] text-muted hover:text-fg">
              지원 페이지로 돌아가기
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
            <h1 className="text-[24px] font-semibold tracking-tight">채팅 수신함</h1>
            <p className="mt-1 text-[14px] text-muted">새 대화는 6초마다 자동으로 갱신됩니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadSessions()}
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
              }}
              className="grid size-10 place-items-center rounded-[12px] text-muted transition hover:bg-white/[0.06] hover:text-fg"
              aria-label="로그아웃"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>

        {error && <p className="mt-4 text-[13px] text-accent-3">{error}</p>}

        <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="depth max-h-[60vh] overflow-y-auto rounded-card bg-surface p-2">
            {sessions.length === 0 && (
              <p className="px-3 py-6 text-[13px] text-faint">아직 접수된 대화가 없습니다.</p>
            )}
            {sessions.map((session) => (
              <button
                key={session.sessionId}
                type="button"
                onClick={() => setActive(session.sessionId)}
                className={cx(
                  'w-full rounded-[12px] px-3 py-3 text-left transition',
                  active === session.sessionId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-medium">
                    {session.name || '익명 방문자'}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">
                    {formatTime(Number(session.updated))}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">
                  {session.lastBody}
                </p>
                {Number(session.visitorCount) > Number(session.agentCount) && (
                  <span className="mt-1.5 inline-block rounded-[6px] bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
                    미응답 {Number(session.visitorCount) - Number(session.agentCount)}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="depth flex min-h-[420px] flex-col rounded-card bg-surface">
            {!active ? (
              <p className="m-auto px-6 text-center text-[14px] text-faint">
                왼쪽에서 대화를 선택하세요.
              </p>
            ) : (
              <>
                <div className="flex-1 space-y-3 overflow-y-auto p-5">
                  {thread.map((message) => (
                    <div
                      key={message.id}
                      className={cx('flex', message.role === 'agent' ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cx(
                          'max-w-[75%] rounded-[14px] px-3.5 py-2.5 text-[14px] leading-relaxed',
                          message.role === 'agent' ? 'bg-accent text-bg' : 'bg-white/[0.07] text-fg',
                        )}
                      >
                        <p className="whitespace-pre-wrap">{message.body}</p>
                        <p
                          className={cx(
                            'mt-1 text-[11px]',
                            message.role === 'agent' ? 'text-bg/60' : 'text-faint',
                          )}
                        >
                          {formatTime(Number(message.created_at))}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>

                <form onSubmit={reply} className="flex gap-2 border-t border-line p-3">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="회신 입력"
                    maxLength={2000}
                    className="depth h-11 min-w-0 flex-1 rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent text-bg transition disabled:opacity-40"
                    aria-label="회신 보내기"
                  >
                    <Send className="size-4" />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </Container>
    </section>
  )
}
