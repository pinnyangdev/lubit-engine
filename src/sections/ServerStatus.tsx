import { Container } from '../components/Container'
import { Reveal } from '../components/Reveal'
import { SectionHeading } from '../components/SectionHeading'
import { server } from '../content'
import { cx } from '../lib/cx'
import { formatTime, useServerStatus } from '../lib/useServerStatus'

// Replaces the old scripted demo: every number here is fetched from the
// Worker's live status route on each visit and re-fetched every 30 seconds.
export function ServerStatus() {
  const { status, error, configured } = useServerStatus()

  const online = status?.online ?? false
  const resolved = status?.resolved ?? false
  const stateLabel = !configured
    ? '서버 주소가 설정되지 않았습니다'
    : status
      ? !resolved
        ? '서버 주소가 아직 연결되지 않았습니다'
        : online
          ? '서버가 정상적으로 켜져 있습니다'
          : '서버가 꺼져 있습니다'
      : error
        ? '상태를 불러오지 못했습니다'
        : '확인 중…'

  const players = status?.playersOnline ?? null
  const max = status?.playersMax ?? null

  const facts: { label: string; value: string }[] = [
    { label: '서버 주소', value: server.host || '미설정' },
    { label: '버전', value: status?.version ?? '—' },
    {
      label: '상태',
      value: configured
        ? status
          ? !resolved
            ? '주소 미연결'
            : online
              ? '온라인'
              : '오프라인'
          : '확인 중'
        : '미설정',
    },
    { label: '최대 접속 인원', value: max !== null ? `${max}명` : '—' },
    { label: '서버 응답 시각', value: formatTime(status?.retrievedAt) },
    { label: '확인 시각', value: formatTime(status?.checkedAt) },
  ]

  return (
    <section id="status" className="scroll-mt-24 border-t border-line py-24 sm:py-32">
      <Container>
        <SectionHeading
          eyebrow="실시간 서버 상태"
          title="지금 이 서버가 이러고 있습니다"
          description={`${server.host || '서버 주소'}에서 직접 받아오는 값입니다. 30초마다 갱신되며, 저장해 둔 예시 데이터가 아닙니다.`}
          align="left"
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Reveal className="h-full">
            <article data-spotlight className="depth relative flex h-full flex-col rounded-card bg-surface p-7 shadow-glow">
              <div className="flex items-center gap-2.5">
                <span
                  className={cx('round size-2.5 shrink-0', online ? 'bg-accent' : 'bg-accent-3')}
                  style={online ? { boxShadow: '0 0 14px rgb(74_222_128/0.9)' } : undefined}
                />
                <span className="text-[13px] text-muted">{stateLabel}</span>
                <span className="ml-auto shrink-0 text-[12px] tabular-nums text-faint">
                  {formatTime(status?.checkedAt)}
                </span>
              </div>

              <div className="mt-8 flex items-baseline gap-2">
                <span className="text-[56px] font-semibold leading-none tracking-[-0.03em] tabular-nums sm:text-[64px]">
                  {players !== null ? players : '—'}
                </span>
                <span className="text-[16px] text-muted">명 접속 중</span>
              </div>
              <p className="mt-3 text-[14px] text-faint">
                {status && !resolved
                  ? `${server.host} 도메인의 DNS 기록이 아직 없습니다.`
                  : max !== null
                    ? `최대 ${max}명까지 동시에 접속할 수 있습니다.`
                    : '접속 인원 정보를 기다리는 중입니다.'}
              </p>

              <div className="mt-auto border-t border-line pt-5">
                <p className="text-[11px] text-faint">MOTD</p>
                <p className="mt-1 line-clamp-3 text-[14px] leading-relaxed text-fg/90">{status?.motd ?? '—'}</p>
              </div>
            </article>
          </Reveal>

          <Reveal delay={0.1} className="h-full">
            <article data-spotlight className="depth relative h-full rounded-card bg-surface p-7 shadow-glow">
              <p className="text-[13px] font-semibold">서버 정보</p>
              <dl className="mt-5 flex flex-col">
                {facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-center justify-between gap-4 border-b border-line py-3.5 last:border-b-0"
                  >
                    <dt className="text-[14px] text-muted">{fact.label}</dt>
                    <dd className="truncate text-[14px] font-medium tabular-nums text-fg">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          </Reveal>
        </div>
      </Container>
    </section>
  )
}
