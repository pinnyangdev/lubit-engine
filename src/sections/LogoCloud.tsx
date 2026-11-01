import { Container } from '../components/Container'
import type { ReactElement } from 'react'
import { Reveal } from '../components/Reveal'
import { logos } from '../content'

// Simple geometric marks for the stack we build on. Swap for partner or
// client logos when you have permission to use them.
const marks: Record<string, ReactElement> = {
  Minecraft: <path d="M4 4h16v16H4zM4 12h16M12 4v16" />,
  Paper: <path d="M6 3h8l4 4v14H6zM14 3v4h4" />,
  Velocity: <path d="M4 12h12M12 6l6 6-6 6M20 6v12" />,
  Discord: <path d="M6 17C4.5 15 4 12 4.5 8.5 6 6.5 8 5.5 10 5.2l1 2h2l1-2c2 .3 4 1.3 5.5 3.3.5 3.5 0 6.5-1.5 8.5" />,
  'Node.js': <path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z" />,
  Docker: <path d="M3 13h18M6 16h12M8 10h3v3H8zM12 10h3v3h-3zM16 10h3v3h-3zM11 6h3v3h-3z" />,
  Cloudflare: <path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.2 9.4 4.3 4.3 0 0 0 7 18z" />,
  Python: <path d="M12 4a4 4 0 0 0-4 4v2h4M12 20a4 4 0 0 0 4-4v-2h-4M8 18H6a2 2 0 0 1-2-2M16 6h2a2 2 0 0 1 2 2" />,
}

export function LogoCloud() {
  const doubled = [...logos, ...logos]
  return (
    <section className="py-12">
      <Container>
        <Reveal>
          <p className="text-center text-[13px] text-faint">이런 기술 위에서 만듭니다</p>
        </Reveal>
        <div className="section-mask relative mt-6 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
          <ul className="flex w-max animate-marquee items-center gap-14 pr-14 hover:[animation-play-state:paused]">
            {doubled.map((name, i) => (
              <li key={`${name}-${i}`} className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-fg/45">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {marks[name]}
                </svg>
                {name}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  )
}
