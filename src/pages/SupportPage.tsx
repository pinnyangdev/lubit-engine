import { motion } from 'motion/react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'

import { Aurora } from '../components/Aurora'
import { Button } from '../components/Button'
import { openChat } from '../components/ChatWidget'
import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { contact, support } from '../content'
import { Cta } from '../sections/Cta'

const ease = [0.22, 1, 0.36, 1] as const

export function SupportPage() {
  return (
    <>
      <section className="relative overflow-hidden pt-36 pb-12 sm:pt-44">
        <Aurora />
        <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[560px]" />
        <div aria-hidden className="noise pointer-events-none absolute inset-0" />

        <Container className="relative">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="depth relative inline-flex h-8 items-center rounded-[12px] bg-white/[0.04] px-3 text-[13px] text-muted backdrop-blur"
            >
              {support.badge}
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease }}
              className="mt-6 text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[46px] sm:leading-[1.06] md:text-[58px]"
            >
              {support.title}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease }}
              className="mt-6 max-w-xl text-pretty text-[16px] leading-relaxed text-muted sm:text-[18px]"
            >
              {support.description}
            </motion.p>
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-20 sm:py-24">
        <Container>
          <SectionHeading eyebrow="연락 채널" title="이렇게 연락주세요" align="left" />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {support.channels.map((channel, i) => {
              const action = channel.action
              const isChat = action.kind === 'chat'
              const needsForm = action.kind === 'email' && !contact.email
              const href =
                action.kind === 'link' ? action.href : contact.email ? `mailto:${contact.email}` : '#cta'
              return (
              <Reveal key={channel.title} delay={i * 0.08} className="h-full">
                <article data-spotlight className="depth relative flex h-full flex-col rounded-card bg-surface p-6 shadow-glow">
                  <h3 className="text-[17px] font-semibold tracking-tight">{channel.title}</h3>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{channel.description}</p>
                  {isChat ? (
                    <Button
                      variant="secondary"
                      onClick={openChat}
                      className="mt-6 w-full justify-between px-4"
                    >
                      {action.label}
                      <ArrowUpRight />
                    </Button>
                  ) : (
                    // 주소가 등록돼 있으면 그쪽으로, 아니면 아래 문의 폼으로 보냅니다.
                    <Button variant="secondary" href={href} className="mt-6 w-full justify-between px-4">
                      {needsForm ? '문의 남기기' : action.label}
                      <ArrowUpRight />
                    </Button>
                  )}
                </article>
              </Reveal>
              )
            })}
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-20 sm:py-24">
        <Container>
          <SectionHeading eyebrow="바로가기" title="자주 찾는 페이지" align="left" />
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {support.quickLinks.map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  className="depth relative flex h-full items-center justify-between gap-3 rounded-card bg-surface px-5 py-4 text-[15px] transition-colors hover:[--depth-edge:rgb(74_222_128/0.45)]"
                >
                  {link.label}
                  <ArrowRight className="size-4 shrink-0 text-faint" />
                </a>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <Cta />

      <div className="border-t border-line py-6">
        <Container>
          <p className="text-center text-[13px] text-faint">
            운영자용 —{' '}
            <a href="/support/inbox" className="underline decoration-line underline-offset-4 hover:text-fg">
              채팅 수신함
            </a>
          </p>
        </Container>
      </div>
    </>
  )
}
