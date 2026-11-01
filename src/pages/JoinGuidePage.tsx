import { motion } from 'motion/react'
import { ArrowLeft, Check, Copy, HelpCircle, Server } from 'lucide-react'
import { useState } from 'react'

import { Aurora } from '../components/Aurora'
import { Button } from '../components/Button'
import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { server } from '../content'
import { ServerStatus } from '../sections/ServerStatus'

const ease = [0.22, 1, 0.36, 1] as const

const steps = [
  {
    title: '마인크래프트 자바 에디션 실행',
    description: '런처에서 플레이 버튼을 누릅니다. 모바일·콘솔(베드락) 버전은 접속할 수 없습니다.',
  },
  {
    title: '멀티플레이어 → 서버 추가',
    description: '메인 메뉴의 멀티플레이어를 연 뒤, 목록 오른쪽 아래에 있는 서버 추가를 누릅니다.',
  },
  {
    title: '서버 주소 입력',
    description: '서버 주소 칸에 아래 주소를 그대로 붙여 넣습니다. 서버 이름은 아무렇게나 적어도 됩니다.',
  },
  {
    title: '서버 접속',
    description: '목록에서 방금 추가한 서버를 선택하고 접속을 누릅니다. 처음 접속하면 리소스팩 설치를 묻습니다.',
  },
]

const troubles = [
  {
    q: '접속이 안 될 때 가장 먼저',
    a: '주소를 다시 확인해 주세요. 오타 하나로 실패합니다. 주소는 소문자여야 하며, 끝에 포트 번호나 / 를 붙이지 않습니다.',
  },
  {
    q: '서버가 꺼져 있다고 나올 때',
    a: '위 실시간 상태에서 온라인 여부를 확인할 수 있습니다. 꺼져 있으면 점검 중이니 디스코드 공지를 확인해 주세요.',
  },
  {
    q: '네트워크가 막힌 곳에서',
    a: '학교·회사 와이파이는 게임 포트가 막혀 있는 경우가 많습니다. 모바일 테더링 등 다른 네트워크에서 먼저 시도해 보세요.',
  },
  {
    q: '버전이 달라도 되나요',
    a: '네. 서버가 허용하는 버전 범위 안에서는 접속됩니다. 접속이 계속되면 디스코드로 오류 메시지를 알려주세요.',
  },
]

export function JoinGuidePage() {
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(server.host)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // 클립보드 권한이 없으면 주소가 그대로 보이도록 두면 됩니다.
    }
  }

  return (
    <>
      <section className="relative overflow-hidden pt-36 pb-12 sm:pt-44">
        <Aurora />
        <div aria-hidden className="grid-lines absolute inset-x-0 top-0 h-[620px]" />
        <div aria-hidden className="noise pointer-events-none absolute inset-0" />

        <Container className="relative">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <motion.a
              href="/mc-server"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease }}
              className="depth relative inline-flex h-8 items-center gap-2 rounded-[12px] bg-white/[0.04] px-3 text-[13px] text-muted backdrop-blur transition-colors hover:text-fg"
            >
              <ArrowLeft className="size-3.5" />
              마크 서버
            </motion.a>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease }}
              className="mt-6 text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[46px] sm:leading-[1.06] md:text-[58px]"
            >
              서버에 접속하는 방법
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease }}
              className="mt-6 max-w-xl text-pretty text-[16px] leading-relaxed text-muted sm:text-[18px]"
            >
              네 단계면 끝입니다. 아래 주소만 추가하면 바로 접속할 수 있습니다.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease }}
              className="depth relative mt-8 flex w-full max-w-md items-center justify-between gap-3 rounded-control-lg bg-surface px-5 py-4 text-left"
            >
              <div className="min-w-0">
                <p className="text-[12px] text-faint">서버 주소</p>
                <p className="truncate text-[17px] font-semibold tracking-tight text-fg">{server.host}</p>
              </div>
              <button
                type="button"
                onClick={copyAddress}
                className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-accent text-bg transition hover:brightness-110"
                aria-label="서버 주소 복사"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </motion.div>
            {copied && <p className="mt-3 text-[13px] text-accent">주소를 복사했습니다.</p>}
          </div>
        </Container>
      </section>

      <ServerStatus />

      <section className="border-t border-line py-20 sm:py-24">
        <Container className="max-w-[860px]">
          <SectionHeading eyebrow="접속 방법" title="네 단계로 접속합니다" align="left" />
          <ol className="relative mt-10 flex flex-col gap-4">
            {steps.map((step, i) => (
              <Reveal key={step.title} delay={i * 0.07}>
                <li className="depth relative flex gap-5 rounded-card bg-surface p-6 shadow-glow">
                  <span className="depth relative grid size-10 shrink-0 place-items-center rounded-[13px] bg-surface-2 text-[14px] font-semibold tabular-nums text-accent">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[17px] font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted">{step.description}</p>
                    {i === 2 && (
                      <button
                        type="button"
                        onClick={copyAddress}
                        className="depth mt-4 inline-flex max-w-full items-center gap-2.5 rounded-[12px] bg-bg/70 px-4 py-2.5 text-left transition hover:[--depth-edge:rgb(74_222_128/0.6)]"
                      >
                        <Server className="size-4 shrink-0 text-accent" />
                        <span className="truncate text-[15px] font-medium text-fg">{server.host}</span>
                        {copied ? (
                          <Check className="size-4 shrink-0 text-accent" />
                        ) : (
                          <Copy className="size-4 shrink-0 text-faint" />
                        )}
                      </button>
                    )}
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-t border-line py-20 sm:py-24">
        <Container className="max-w-[860px]">
          <SectionHeading eyebrow="문제 해결" title="접속이 안 될 때" align="left" />
          <ul className="depth relative mt-10 flex flex-col gap-3.5 rounded-card bg-surface p-6 shadow-glow">
            {troubles.map((item) => (
              <li key={item.q} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[7px] bg-accent/15 text-accent">
                  <HelpCircle className="size-3.5" />
                </span>
                <div>
                  <p className="text-[15px] font-medium text-fg">{item.q}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">{item.a}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button href="/support" className="sm:flex-1">
              그래도 안 되면 문의하기
            </Button>
            <Button variant="secondary" href="/mc-server" className="sm:flex-1">
              마크 서버 페이지로
            </Button>
          </div>
        </Container>
      </section>
    </>
  )
}
