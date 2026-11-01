import { animate, useInView } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import { Container } from '../components/Container'
import { metrics } from '../content'

function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!inView) return
    const controls = animate(0, value, {
      duration: 1.6,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    })
    return () => controls.stop()
  }, [inView, value])
  return (
    <span ref={ref} className="tabular-nums">
      {display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}

export function Metrics() {
  return (
    <section className="border-t border-line py-20">
      <Container>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-2 md:items-center md:text-center">
              <dt className="order-2 text-[14px] text-muted">{m.label}</dt>
              <dd className="order-1 text-[40px] font-semibold leading-none tracking-[-0.03em] sm:text-[48px]">
                <CountUp value={m.value} decimals={m.decimals} suffix={m.suffix} />
              </dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  )
}
