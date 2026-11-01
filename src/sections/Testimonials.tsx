import { Bot, Gamepad2, Globe, Monitor, Server, Wrench } from 'lucide-react'

import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { testimonials } from '../content'

// One icon per scope card, keyed by `icon` in content.ts.
const icons: Record<string, typeof Wrench> = {
  wrench: Wrench,
  monitor: Monitor,
  server: Server,
  bot: Bot,
  globe: Globe,
  game: Gamepad2,
}

export function Testimonials() {
  return (
    <section id="customers" className="scroll-mt-24 border-t border-line py-24 sm:py-32">
      <Container>
        <SectionHeading eyebrow={testimonials.eyebrow} title={testimonials.title} />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {testimonials.items.map((t, i) => {
            const Icon = icons[t.icon] ?? Globe
            return (
              <Reveal key={t.name} delay={(i % 3) * 0.08} className="h-full">
                <figure className="depth relative flex h-full flex-col justify-between rounded-card bg-surface p-6 shadow-glow">
                  <p className="text-pretty text-[15px] leading-relaxed text-fg/90">{t.quote}</p>
                  <figcaption className="mt-6 flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-white/[0.06] text-accent">
                      <Icon className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{t.name}</p>
                      <p className="truncate text-[13px] text-muted">{t.role}</p>
                    </div>
                  </figcaption>
                </figure>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}
