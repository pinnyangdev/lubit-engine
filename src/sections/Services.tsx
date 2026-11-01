import { ArrowUpRight } from 'lucide-react'

import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { services } from '../content'

// The services index: every service gets its own page under this one domain,
// and this section is the doorway from the introduction page.
export function Services() {
  return (
    <section id="services" className="scroll-mt-24 py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="전체 서비스"
          title="필요한 항목만 골라 맡기세요"
          description="직접 만드는 제품과 외주로 맡기는 작업을 한 팀에서 처리합니다."
        />
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service, i) => (
            <Reveal key={service.slug} delay={(i % 3) * 0.08} className="h-full">
              <a href={`/${service.slug}`} className="group block h-full">
                <article data-spotlight className="depth relative flex h-full flex-col rounded-card bg-surface p-6 shadow-glow transition-[color,transform] duration-300 ease-out hover:-translate-y-1 hover:[--depth-edge:rgb(74_222_128/0.45)]">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[12px] font-medium text-accent">{service.eyebrow}</span>
                    <ArrowUpRight className="size-4 shrink-0 text-faint transition-[color,transform] duration-300 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <h3 className="text-[19px] font-semibold tracking-tight">{service.name}</h3>
                    <span className="shrink-0 rounded-[7px] bg-white/[0.06] px-2 py-1 text-[11px] text-muted">
                      {service.kind}
                    </span>
                  </div>
                  <p className="mt-2 flex-1 text-[14px] leading-relaxed text-muted">{service.description}</p>
                  <p className="mt-5 flex flex-wrap items-baseline gap-2 border-t border-line pt-4">
                    <span className="text-[15px] font-semibold text-fg">{service.price.label}</span>
                    <span className="text-[13px] text-faint">{service.price.note}</span>
                  </p>
                </article>
              </a>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}
