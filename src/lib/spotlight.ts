// 카드 안에서 마우스를 따라오는 스포트라이트.
//
// 카드마다 리스너를 거는 대신 전역 리스너 하나만 쓰고, 카드에 들어갔을 때만
// pointermove 를 듣습니다. 좌표 갱신은 requestAnimationFrame 으로 묶어
// 한 프레임에 한 번, CSS 변수 두 개만 바꿉니다 — 리렌더도, 레이아웃도 없음.

const CARD = '[data-spotlight]'

export function initSpotlight() {
  if (typeof window === 'undefined') return

  let card: HTMLElement | null = null
  let clientX = 0
  let clientY = 0
  let frame = 0

  const paint = () => {
    frame = 0
    if (!card) return
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${Math.round(clientX - rect.left)}px`)
    card.style.setProperty('--my', `${Math.round(clientY - rect.top)}px`)
  }

  const move = (event: PointerEvent) => {
    clientX = event.clientX
    clientY = event.clientY
    if (frame) return
    frame = window.requestAnimationFrame(paint)
  }

  const over = (event: PointerEvent) => {
    const target = event.target as Element | null
    const next = target?.closest?.(CARD) as HTMLElement | null
    if (!next || next === card) return
    leave()
    card = next
    window.addEventListener('pointermove', move, { passive: true })
    // 카드 안으로 들어온 순간의 위치도 바로 그려 넣습니다.
    move(event)
  }

  // 포인터가 카드 밖으로 나가면(자식 요소 사이 이동은 무시) 리스너를 떼어
  // 마우스가 없을 때는 작업이 전혀 쌓이지 않게 합니다.
  function leave() {
    if (!card) return
    window.removeEventListener('pointermove', move)
    if (frame) {
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    card = null
  }

  const out = (event: PointerEvent) => {
    if (!card) return
    const related = event.relatedTarget as Node | null
    if (related && card.contains(related)) return
    leave()
  }

  window.addEventListener('pointerover', over, { passive: true })
  window.addEventListener('pointerout', out, { passive: true })

  return () => {
    window.removeEventListener('pointerover', over)
    window.removeEventListener('pointerout', out)
    leave()
  }
}
