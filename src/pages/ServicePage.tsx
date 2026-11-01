import { motion } from 'motion/react'
import { ArrowRight, ArrowUpRight, Check, Plus } from 'lucide-react'
import { useState } from 'react'

import { Aurora } from '../components/Aurora'
import { Button } from '../components/Button'
import { Container } from '../components/Container'
import { DownloadButton } from '../components/DownloadChooser'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { services, type Service } from '../content'
import { cx } from '../lib/cx'

const ease = [0.22, 1, 0.36, 1] as const

// 대표 버튼 하나만 두는 페이지들: 접속 방법, 다운로드, 초대처럼
// 행동이 하나로 확정되는 서비스는 보조 버튼을 붙이지 않습니다.
const singleCta = new Set(['mc-server', 'client', 'engine', 'bot'])

// One template for every service page. The copy comes from `services` in
// content.ts, so adding a service there is enough to publish a new page.
export function ServicePage({ service }: { service: Service }) {
  const [before, after] = service.title.split(service.highlight)
  const related = services.filter((s) => s.slug !== service.slug).slice(0, 3)

  return (
    <>
      <ServiceHeader service={service} before={before ?? ''} after={after ?? ''} />
      <ServiceMedia service={service} />
      <Points service={service} />
      <IncludesAndFaq service={service} />
      <Related items={related} />
    </>
  )
}

// 서버 구동기는 "써 보는 느낌"이 중요한 페이지라 영상 자리를 헤더 바로 아래에 둡니다.
// public/download/engine/demo.mp4 를 넣으면 그 영상이 뜨고, 아직 없으면
// 앱 화면을 흉내 낸 패널로 자리를 채워 빈 구멍이 남지 않게 합니다.
function ServiceMedia({ service }: { service: Service }) {
  const [failed, setFailed] = useState(false)
  if (service.slug !== 'engine') return null

  return (
    <Container className="relative mt-8 sm:mt-10">
      <div className="depth relative overflow-hidden rounded-card bg-surface shadow-glow">
        {failed ? (
          <div className="grid gap-6 p-6 sm:grid-cols-[1.15fr_1fr] sm:items-center sm:p-8">
            <div className="rounded-[14px] border border-line/60 bg-bg/60 p-5">
              <p className="text-[12px] text-faint">서버 구동기 · PC 앱</p>
              <p className="mt-2 text-[18px] font-semibold tracking-tight">
                서버 만들기 · 콘솔 입력 · 실시간 로그
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                PC 앱에서 서버를 만들면 같은 계정으로 웹과 휴대폰에서도 바로 관리됩니다.
                포트포워딩 없이 밖에서 접속할 수 있게 주소까지 알아서 잡아 줍니다.
              </p>
            </div>
            <ul className="grid gap-2.5 text-[14px] text-muted">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                버킷·버전·메모리를 골라 바로 생성
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                시작·중지·재시작과 콘솔 입력
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                CPU · RAM · TPS 실시간 확인
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                플러그인 설치와 백업, 화이트리스트
              </li>
            </ul>
          </div>
        ) : (
          <video
            className="aspect-video w-full bg-bg"
            src="/download/engine/demo.mp4"
            controls
            autoPlay
            muted
            loop
            playsInline
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </Container>
  )
}

function ServiceHeader({ service, before, after }: { service: Service; before: string; after: string }) {
  return (
    <section className="relative overflow-hidden pt-36 pb-12 sm:pt-44">
      <Aurora />
      <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[620px]" />
      <div aria-hidden className="noise pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <motion.a
            href="/#services"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease }}
            className="depth relative inline-flex h-8 items-center gap-2 rounded-[12px] bg-white/[0.04] px-3 text-[13px] text-muted backdrop-blur transition-colors hover:text-fg"
          >
            {service.kind}
            <ArrowUpRight className="size-3.5" />
          </motion.a>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease }}
            className="mt-6 text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[46px] sm:leading-[1.06] md:text-[58px]"
          >
            {before}
            <span className="text-gradient">{service.highlight}</span>
            {after}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
            className="mt-6 max-w-xl text-pretty text-[16px] leading-relaxed text-muted sm:text-[18px]"
          >
            {service.description}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease }}
            className="mt-8 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row"
          >
            {service.cta.href === '#' ? (
              // 아직 준비된 링크가 없는 서비스는 죽은 버튼으로 두지 않고,
              // 누를 수 없음을 분명히 보여줍니다.
              <Button size="lg" variant="secondary" disabled className="w-full sm:w-auto">
                {service.cta.label} 준비 중
              </Button>
            ) : service.downloadChooser ? (
              // 누르면 윈도우 · 안드로이드 · iOS 중 무엇을 받을지 고르게 합니다.
              <DownloadButton
                label={service.cta.label}
                href={service.cta.href}
                className="w-full sm:w-auto"
              />
            ) : (
              <Button size="lg" href={service.cta.href} className="w-full sm:w-auto">
                {service.cta.label}
                <ArrowRight />
              </Button>
            )}
            {service.secondary ? (
              <Button size="lg" variant="secondary" href={service.secondary.href} className="w-full sm:w-auto">
                {service.secondary.label}
                <ArrowRight />
              </Button>
            ) : (
              !singleCta.has(service.slug) && (
                <Button size="lg" variant="secondary" href="/#services" className="w-full sm:w-auto">
                  전체 서비스 보기
                </Button>
              )
            )}
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-4 text-[13px] text-faint"
          >
            <span className="text-fg">{service.price.label}</span> · {service.price.note}
          </motion.p>
        </div>
      </Container>
    </section>
  )
}

function Points({ service }: { service: Service }) {
  return (
    <section className="border-t border-line py-20 sm:py-24">
      <Container>
        <SectionHeading eyebrow="핵심 포인트" title="이 서비스가 편한 이유" align="left" />
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {service.points.map((point, i) => (
            <Reveal key={point.title} delay={i * 0.08} className="h-full">
              <article data-spotlight className="depth relative flex h-full flex-col rounded-card bg-surface p-6 shadow-glow">
                <span className="depth relative grid size-10 place-items-center rounded-[13px] bg-surface-2 text-[14px] font-semibold tabular-nums text-accent">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{point.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{point.description}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}

function IncludesAndFaq({ service }: { service: Service }) {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className="border-t border-line py-20 sm:py-24">
      <Container>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal>
            <SectionHeading eyebrow="포함 사항" title="이런 게 포함됩니다" align="left" />
            <ul className="depth relative mt-8 flex flex-col gap-3.5 rounded-card bg-surface p-6 shadow-glow">
              {service.includes.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[15px] text-fg/90">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] bg-accent/15 text-accent">
                    <Check className="size-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1}>
            <SectionHeading eyebrow="자주 묻는 질문" title="상담 전에 많이 묻는 것" align="left" />
            <ul className="depth relative mt-8 divide-y divide-line rounded-card bg-surface shadow-glow">
              {service.faq.map((item, i) => {
                const isOpen = open === i
                return (
                  <li key={item.q}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                    >
                      <span className="text-[15px] font-medium">{item.q}</span>
                      <span
                        className={cx(
                          'depth relative grid size-7 shrink-0 place-items-center rounded-[9px] text-muted transition-transform duration-300',
                          isOpen && 'rotate-45 text-fg',
                        )}
                      >
                        <Plus className="size-3.5" />
                      </span>
                    </button>
                    <motion.div
                      initial={false}
                      animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                      transition={{ duration: 0.3, ease }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 text-[14px] leading-relaxed text-muted">{item.a}</p>
                    </motion.div>
                  </li>
                )
              })}
            </ul>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}

function Related({ items }: { items: Service[] }) {
  return (
    <section className="border-t border-line py-20 sm:py-24">
      <Container>
        <SectionHeading eyebrow="함께 맡기기 좋은" title="이어서 필요한 서비스" align="left" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {items.map((service) => (
            <a key={service.slug} href={`/${service.slug}`} className="group block">
              <article data-spotlight className="depth relative flex h-full flex-col rounded-card bg-surface p-5 shadow-glow transition-colors hover:[--depth-edge:rgb(74_222_128/0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[16px] font-semibold tracking-tight">{service.name}</h3>
                  <ArrowUpRight className="size-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
                </div>
                <p className="mt-2 line-clamp-3 text-[14px] leading-relaxed text-muted">{service.description}</p>
              </article>
            </a>
          ))}
        </div>
      </Container>
    </section>
  )
}

