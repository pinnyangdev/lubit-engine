import { motion } from 'motion/react'
import { ArrowUpRight, MousePointer2 } from 'lucide-react'
import type { ReactElement } from 'react'

import { Container } from '../components/Container'
import { Monogram } from '../components/DashboardMock'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { features } from '../content'
import { cx } from '../lib/cx'

const visuals: Record<string, () => ReactElement> = {
  outsourcing: CollabVisual,
  engine: AutomationVisual,
  bot: IntegrationsVisual,
  client: AnalyticsVisual,
}

export function Features() {
  return (
    <section id="features" className="scroll-mt-24 py-24 sm:py-32">
      <Container>
        <SectionHeading eyebrow={features.eyebrow} title={features.title} description={features.description} />
        <div className="mt-14 grid auto-rows-[320px] grid-cols-1 gap-4 md:grid-cols-3">
          {features.items.map((item, i) => {
            const Visual = visuals[item.key]
            return (
              <Reveal key={item.key} delay={(i % 3) * 0.08} className={cx(item.span === 2 && 'md:col-span-2')}>
                <a href={item.href} className="group block h-full">
                  <article data-spotlight className="depth relative flex h-full flex-col overflow-hidden rounded-card bg-surface shadow-glow transition-colors duration-300 hover:[--depth-edge:rgb(74_222_128/0.4)]">
                    <div className="relative flex-1 overflow-hidden">
                      <Visual />
                    </div>
                    {/* Fixed height so dividers line up across a row regardless of copy length. */}
                    <div className="relative flex h-[96px] items-start justify-between gap-3 border-t border-line px-6 pt-4">
                      <div className="min-w-0">
                        <h3 className="text-[16px] font-semibold tracking-tight">{item.title}</h3>
                        <p className="mt-1 line-clamp-2 text-[14px] leading-snug text-muted">{item.description}</p>
                      </div>
                      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-faint transition-colors group-hover:text-accent" />
                    </div>
                  </article>
                </a>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}

function Cursor({ name, hue, className }: { name: string; hue: number; className?: string }) {
  return (
    <div className={cx('absolute flex items-start', className)}>
      <MousePointer2 className="size-4" style={{ color: `hsl(${hue} 80% 70%)`, fill: `hsl(${hue} 80% 70%)` }} />
      <span
        className="ml-3 mt-3 rounded-[8px] px-1.5 py-0.5 text-[11px] font-medium text-bg"
        style={{ background: `hsl(${hue} 80% 70%)` }}
      >
        {name}
      </span>
    </div>
  )
}

function CollabVisual() {
  return (
    <div className="absolute inset-0 p-6 pb-0">
      <div className="depth relative h-[calc(100%+2px)] overflow-hidden rounded-t-[16px] bg-bg/50 p-5">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-28 rounded-[4px] bg-white/[0.12]" />
          <div className="ml-auto flex">
            <Monogram initials="LV" hue={150} className="ring-2 ring-surface" />
            <Monogram initials="CL" hue={190} className="-ml-2 ring-2 ring-surface" />
            <Monogram initials="PD" hue={260} className="-ml-2 ring-2 ring-surface" />
          </div>
        </div>
        <div className="mt-5 space-y-2.5">
          <div className="h-2 w-[92%] rounded-[4px] bg-white/[0.08]" />
          <div className="h-2 w-[76%] rounded-[4px] bg-white/[0.08]" />
          <div className="h-2 w-[84%] rounded-[4px] bg-accent/30" />
          <div className="h-2 w-[60%] rounded-[4px] bg-white/[0.08]" />
          <div className="h-2 w-[70%] rounded-[4px] bg-white/[0.08]" />
        </div>
        <div className="depth absolute bottom-5 left-5 inline-flex max-w-[280px] items-start gap-2 rounded-[12px] bg-surface-2 p-2.5">
          <Monogram initials="CL" hue={190} className="size-5 text-[9px]" />
          <p className="text-[11px] leading-snug text-muted">보스 패턴 2단계도 추가해 주세요. 일정은 목요일로 잡으면 됩니다.</p>
        </div>
        <Cursor name="lubit" hue={150} className="left-[42%] top-[34%] animate-cursor-a" />
        <Cursor name="고객사" hue={190} className="left-[72%] top-[22%] animate-cursor-b" />
      </div>
    </div>
  )
}

const flow = [
  { label: '엔진 실행', color: '#4ade80' },
  { label: '플러그인 로드', color: '#22d3ee' },
  { label: '자동 재시작', color: '#a78bfa' },
]

function AutomationVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="relative flex w-full max-w-[260px] flex-col gap-6">
        <svg aria-hidden className="absolute left-[19px] top-6 h-[calc(100%-48px)] w-px overflow-visible">
          <line x1="0.5" y1="0" x2="0.5" y2="100%" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="4 6" className="animate-dash" strokeLinecap="round" />
        </svg>
        <ol className="flex w-full flex-col gap-6">
          {flow.map((step, i) => (
            <motion.li
              key={step.label}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15, duration: 0.5 }}
              className="depth relative flex h-11 items-center gap-3 rounded-[14px] bg-bg/60 pl-3 pr-4 text-[13px] backdrop-blur"
            >
              <span className="round size-3 shrink-0 ring-4 ring-surface" style={{ background: step.color, boxShadow: `0 0 16px ${step.color}66` }} />
              {step.label}
            </motion.li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function AnalyticsVisual() {
  const bars = [38, 52, 44, 68, 60, 82, 74, 96, 88, 100]
  return (
    <div className="absolute inset-0 flex items-end p-6">
      <div className="flex h-[78%] w-full items-end gap-2">
        {bars.map((b, i) => (
          <motion.div
            key={i}
            className="flex-1 origin-bottom rounded-[6px] bg-gradient-to-t from-accent/30 to-accent"
            style={{ height: `${b}%` }}
            initial={{ scaleY: 0.1, opacity: 0.4 }}
            whileInView={{ scaleY: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.06, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ))}
      </div>
      <div className="depth absolute left-6 top-6 rounded-[10px] bg-surface-2 px-2.5 py-1.5 text-[11px] text-muted">
        최적화 후 FPS <span className="ml-1 text-accent-2">+34</span>
      </div>
    </div>
  )
}

const botFeatures = [
  { label: '공지', hue: 150 },
  { label: '티켓', hue: 190 },
  { label: '추첨', hue: 260 },
  { label: '로그', hue: 45 },
  { label: '상태', hue: 150 },
  { label: '투표', hue: 190 },
  { label: '인증', hue: 260 },
  { label: '알림', hue: 45 },
  { label: '예약', hue: 150 },
  { label: '경고', hue: 340 },
  { label: '역할', hue: 190 },
  { label: '대기', hue: 260 },
]

function IntegrationsVisual() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="grid grid-cols-6 gap-3">
        {botFeatures.map((app, i) => (
          <div
            key={app.label}
            title={app.label}
            className="depth relative grid size-13 place-items-center rounded-[16px] text-[15px] font-semibold animate-float"
            style={{
              animationDelay: `${(i % 6) * 0.4}s`,
              color: `hsl(${app.hue} 70% 76%)`,
              background: `linear-gradient(180deg, hsl(${app.hue} 70% 55% / 0.20), hsl(${app.hue} 70% 40% / 0.06))`,
            }}
          >
            {app.label}
          </div>
        ))}
      </div>
    </div>
  )
}
