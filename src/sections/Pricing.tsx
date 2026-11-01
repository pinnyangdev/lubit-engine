import { Check } from 'lucide-react'

import { Button } from '../components/Button'
import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { pricing } from '../content'
import { cx } from '../lib/cx'

// Quoting, not a rate card: scope is agreed first, then a fixed number.
export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-24 border-t border-line py-24 sm:py-32">
      <Container>
        <SectionHeading eyebrow={pricing.eyebrow} title={pricing.title} description={pricing.description} />

        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {pricing.tiers.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 0.08} className="h-full">
              <article
                data-spotlight
                className={cx(
                  'depth relative flex h-full flex-col rounded-card bg-surface p-7',
                  tier.popular
                    ? '[--depth-edge:rgb(74_222_128/0.45)] [--depth-highlight:rgb(34_211_238/0.25)] shadow-[0_40px_80px_-40px_rgb(74_222_128/0.35)]'
                    : 'shadow-glow',
                )}
              >
                {tier.popular && (
                  <span className="absolute right-6 top-6 rounded-[8px] bg-accent/15 px-2 py-1 text-[12px] font-medium text-accent">
                    흔히 요청
                  </span>
                )}
                <h3 className="text-[16px] font-semibold">{tier.name}</h3>
                <p className="mt-1 min-h-[44px] text-[14px] leading-snug text-muted">{tier.description}</p>
                <div className="mt-6 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[32px] font-semibold leading-none tracking-[-0.03em]">{tier.price}</span>
                  <span className="text-[14px] text-muted">{tier.note}</span>
                </div>
                <Button variant={tier.popular ? 'primary' : 'secondary'} href="/support" className="mt-7 w-full">
                  {tier.cta}
                </Button>
                <ul className="mt-7 flex flex-col gap-3 border-t border-line pt-7">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-3 text-[14px] text-fg/90">
                      <span className="mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-[6px] bg-white/[0.08]">
                        <Check className="size-3" />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}
