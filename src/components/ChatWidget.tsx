import { MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { cx } from '../lib/cx'

type ChatMessage = {
  id: number
  role: 'visitor' | 'agent'
  body: string
  created_at: number
}

const SESSION_KEY = 'lubit-chat-session'

function getSessionId() {
  let id = ''
  try {
    id = localStorage.getItem(SESSION_KEY) ?? ''
  } catch {
    id = ''
  }
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID()
    try {
      localStorage.setItem(SESSION_KEY, id)
    } catch {
      /* private mode — the conversation just will not persist */
    }
  }
  return id
}

// Support cards and any other page element can open the panel through this.
export function openChat() {
  window.dispatchEvent(new CustomEvent('lubit:chat-open'))
}

export function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')
  const bottom = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<string>('')

  useEffect(() => {
    sessionRef.current = getSessionId()
    const onOpen = () => setOpen(true)
    window.addEventListener('lubit:chat-open', onOpen)
    return () => window.removeEventListener('lubit:chat-open', onOpen)
  }, [])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, open])

  // Poll only while the panel is open so a closed widget costs nothing.
  useEffect(() => {
    if (!open) return
    let alive = true
    const load = async () => {
      try {
        const response = await fetch(`/api/chat?session=${encodeURIComponent(sessionRef.current)}`)
        if (!response.ok) throw new Error()
        const data = (await response.json()) as { messages: ChatMessage[] }
        if (alive) {
          setMessages(data.messages)
          setError('')
        }
      } catch {
        if (alive) setError('채팅 서버에 연결하지 못했습니다.')
      }
    }
    void load()
    // 창이 열려 있는 동안에만 — 긴 주기일수록 Workers 요청을 아낍니다.
    const id = window.setInterval(load, 15000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [open])

  async function send(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setStatus('sending')
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionRef.current, name: name.trim(), body: text }),
      })
      const data = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(data.error ?? '전송하지 못했습니다.')
      setDraft('')
      setStatus('idle')
      setError('')
      const payload = await fetch(`/api/chat?session=${encodeURIComponent(sessionRef.current)}`)
      if (payload.ok) {
        const fresh = (await payload.json()) as { messages: ChatMessage[] }
        setMessages(fresh.messages)
      }
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : '전송하지 못했습니다.')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '채팅 닫기' : '채팅 열기'}
        className="fixed bottom-5 right-5 z-50 grid size-14 place-items-center rounded-full bg-accent text-bg shadow-[0_12px_36px_-12px_rgb(74_222_128/0.9)] transition-transform hover:scale-105 active:scale-95"
      >
        {!open && (
          <>
            <span aria-hidden className="pointer-events-none absolute right-2.5 top-2.5 size-2.5 animate-ping rounded-full bg-accent-3" />
            <span aria-hidden className="pointer-events-none absolute right-2.5 top-2.5 size-2.5 rounded-full bg-accent-3" />
          </>
        )}
        {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
      </button>

      {open && (
        <div className="depth fixed bottom-24 right-5 z-50 flex h-[min(560px,72vh)] w-[min(92vw,370px)] flex-col overflow-hidden rounded-card bg-surface shadow-glow">
          <div className="border-b border-line px-5 py-4">
            <p className="text-[15px] font-semibold">실시간 채팅</p>
            <p className="mt-0.5 text-[12px] text-muted">
              접수 중에는 보통 24시간 안에 회신합니다.
            </p>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <p className="text-[13px] leading-relaxed text-faint">
                궁금한 점을 남겨주세요. 문의 내용은 사이트에 저장되고, 담당자에게 바로 알림이 갑니다.
              </p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={cx('flex', message.role === 'agent' ? 'justify-start' : 'justify-end')}
              >
                <p
                  className={cx(
                    'max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-[14px] leading-relaxed',
                    message.role === 'agent'
                      ? 'bg-white/[0.07] text-fg'
                      : 'bg-accent text-bg',
                  )}
                >
                  {message.body}
                </p>
              </div>
            ))}
            <div ref={bottom} />
          </div>

          {error && <p className="px-5 pb-1 text-[12px] text-accent-3">{error}</p>}

          <form onSubmit={send} className="border-t border-line p-3">
            {messages.length === 0 && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름 (선택)"
                maxLength={60}
                className="depth mb-2 h-10 w-full rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
              />
            )}
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="메시지 입력"
                maxLength={2000}
                className="depth h-11 min-w-0 flex-1 rounded-[12px] bg-bg/60 px-3.5 text-[14px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
              />
              <button
                type="submit"
                disabled={status === 'sending' || !draft.trim()}
                aria-label="보내기"
                className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-accent text-bg transition disabled:opacity-40"
              >
                <Send className="size-4" />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
