import { ArrowRight, Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Aurora } from '../components/Aurora'
import { Button } from '../components/Button'
import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { cta } from '../content'

// 오로라가 바로 뒤에서 움직이는 자리라 backdrop-blur 를 빼둡니다. 배경색이
// 60% 로 충분히 가려주고, 매 프레임 다시 계산되는 비용을 없앱니다.
const inputClass =
  'depth relative h-13 w-full rounded-control-lg bg-bg/70 px-5 text-[15px] text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]'

// 문의 폼. 접수된 내용은 D1에 보관되고 동시에 디스코드 채널로 알림이 갑니다.
export function Cta() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [feedback, setFeedback] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setState('sending')
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? '요청을 처리하지 못했습니다. 다시 시도해 주세요.')
      setState('done')
      setFeedback(cta.success)
    } catch (error) {
      setState('error')
      setFeedback(error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 다시 시도해 주세요.')
    }
  }

  return (
    <section id="cta" className="scroll-mt-24 py-12">
      <Container>
        <Reveal>
          <div className="depth relative overflow-hidden rounded-[32px] bg-surface px-6 py-20 text-center shadow-glow sm:px-12 sm:py-28">
            <Aurora intensity={0.8} />
            <div aria-hidden className="grid-lines absolute inset-0" />
            <div aria-hidden className="noise pointer-events-none absolute inset-0" />
            <div className="relative mx-auto max-w-xl">
              <h2 className="text-balance text-[36px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[52px]">{cta.title}</h2>
              <p className="mt-4 text-[16px] text-muted sm:text-[18px]">{cta.description}</p>

              {state === 'done' ? (
                <p className="depth relative mx-auto mt-8 inline-flex h-13 items-center gap-2 rounded-control-lg bg-accent-2/10 px-5 text-[15px] text-accent-2 [--depth-edge:rgb(255_181_71/0.35)]">
                  <Check className="size-4" />
                  {feedback}
                </p>
              ) : (
                <form onSubmit={submit} className="mx-auto mt-8 flex max-w-md flex-col gap-2">
                  <label className="sr-only" htmlFor="cta-name">
                    {cta.fields.name}
                  </label>
                  <input
                    id="cta-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={cta.fields.name}
                    maxLength={80}
                    className={inputClass}
                  />
                  <label className="sr-only" htmlFor="cta-email">
                    {cta.fields.email}
                  </label>
                  <input
                    id="cta-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={cta.fields.email}
                    maxLength={200}
                    className={inputClass}
                  />
                  <label className="sr-only" htmlFor="cta-message">
                    {cta.fields.message}
                  </label>
                  <textarea
                    id="cta-message"
                    required
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={cta.fields.message}
                    maxLength={4000}
                    className="depth relative min-h-28 w-full resize-y rounded-control-lg bg-bg/70 px-5 py-3.5 text-[15px] leading-relaxed text-fg placeholder:text-faint focus:outline-none focus:[--depth-edge:rgb(74_222_128/0.7)]"
                  />
                  <Button size="lg" type="submit" className="w-full" disabled={state === 'sending'}>
                    {state === 'sending' ? '전송 중…' : cta.button}
                    <ArrowRight />
                  </Button>
                </form>
              )}
              {state === 'error' && <p className="mt-3 text-[13px] text-accent-3">{feedback}</p>}
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
