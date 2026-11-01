import { motion } from 'motion/react'

import { Aurora } from '../components/Aurora'
import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import type { LegalDoc } from '../content'

const ease = [0.22, 1, 0.36, 1] as const

// Policy documents: 이용약관 / 개인정보처리방침 / 환불 정책.
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <section className="relative overflow-hidden pt-36 pb-10 sm:pt-44">
        <Aurora intensity={0.7} />
        <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[480px]" />
        <div aria-hidden className="noise pointer-events-none absolute inset-0" />

        <Container className="relative">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="depth relative inline-flex h-8 items-center rounded-[12px] bg-white/[0.04] px-3 text-[13px] text-muted backdrop-blur"
            >
              정책
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease }}
              className="mt-6 text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[46px]"
            >
              {doc.title}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="mt-4 text-[13px] text-faint"
            >
              {doc.updated}
            </motion.p>
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-16 sm:py-20">
        <Container className="max-w-[760px]">
          <Reveal>
            <p className="text-pretty text-[16px] leading-relaxed text-muted">{doc.intro}</p>
          </Reveal>

          {doc.sections.map((section, i) => (
            <Reveal key={section.heading} delay={Math.min(i * 0.05, 0.3)}>
              <div className="mt-10 border-t border-line pt-8 first:mt-10">
                <h2 className="text-[19px] font-semibold tracking-tight">{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-3 text-pretty text-[15px] leading-relaxed text-muted">
                    {paragraph}
                  </p>
                ))}
              </div>
            </Reveal>
          ))}

          <div className="mt-12 border-t border-line pt-8">
            <p className="text-[13px] text-faint">
              본 문서는 {doc.updated.replace('시행일 ', '')} 기준이며, 문의는 지원 페이지에서 접수합니다.{' '}
              <a href="/support" className="text-accent hover:underline">
                지원 페이지로 이동
              </a>
            </p>
          </div>
        </Container>
      </section>
    </>
  )
}
