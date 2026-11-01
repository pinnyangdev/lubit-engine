import { useEffect, useRef, useState } from 'react'

import { cx } from '../lib/cx'

// Slow-moving colour fields behind the hero and the closing call to action.
// Pure CSS; each blob is a blurred radial gradient on its own animation.
//
// The blobs are large blurs, so they are animated with translate only (a
// scale change forces the blur to be recomputed) and are frozen entirely
// while the section is off screen.
export function Aurora({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { rootMargin: '160px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      className={cx(
        'pointer-events-none absolute inset-0 overflow-hidden',
        !onScreen && 'aurora-paused',
        className,
      )}
      style={{ opacity: intensity }}
    >
      <div
        className="round absolute left-1/2 top-[-20%] h-[70%] w-[90%] -translate-x-1/2 animate-aurora-a rounded-full bg-[radial-gradient(closest-side,rgb(255_122_69/0.42),transparent)] blur-3xl"
        style={{ willChange: 'transform' }}
      />
      <div
        className="round absolute left-[10%] top-[0%] h-[60%] w-[55%] animate-aurora-b rounded-full bg-[radial-gradient(closest-side,rgb(255_77_109/0.3),transparent)] blur-3xl"
        style={{ willChange: 'transform' }}
      />
      <div
        className="round absolute right-[5%] top-[10%] h-[55%] w-[50%] animate-aurora-c rounded-full bg-[radial-gradient(closest-side,rgb(255_181_71/0.28),transparent)] blur-3xl"
        style={{ willChange: 'transform' }}
      />
    </div>
  )
}
