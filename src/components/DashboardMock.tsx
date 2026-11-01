import { motion } from 'motion/react'
import { BarChart3, Inbox, KanbanSquare, Layers, Target } from 'lucide-react'

import { LogoMark } from './Logo'
import { brand, server } from '../content'
import { cx } from '../lib/cx'
import { formatTime, useServerStatus } from '../lib/useServerStatus'

const navItems = [
  { icon: Layers, label: '서버', active: true },
  { icon: Inbox, label: '콘솔' },
  { icon: BarChart3, label: '모니터링' },
  { icon: KanbanSquare, label: '외주 현황' },
  { icon: Target, label: '백업' },
]

export function Monogram({ initials, hue, className }: { initials: string; hue: number; className?: string }) {
  return (
    <span
      className={cx('round grid size-6 shrink-0 place-items-center text-[10px] font-semibold text-white', className)}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${hue + 40} 70% 42%))`,
      }}
    >
      {initials}
    </span>
  )
}

export function DashboardMock() {
  // Every figure in this panel comes from the live status route, not copy.
  const { status, error, configured } = useServerStatus()

  const online = status?.online ?? false
  const stateText = !configured
    ? '미설정'
    : status
      ? !status.resolved
        ? '주소 미연결'
        : online
          ? '온라인'
          : '오프라인'
      : error
        ? '확인 실패'
        : '확인 중'

  const facts: { label: string; value: string }[] = [
    { label: '서버 주소', value: server.host || '미설정' },
    { label: '버전', value: status?.version ?? '—' },
    { label: '최대 인원', value: status?.playersMax !== null && status ? `${status.playersMax}명` : '—' },
    { label: '응답 시각', value: formatTime(status?.retrievedAt) },
  ]

  return (
    <div className="depth relative flex aspect-[16/10] w-full overflow-hidden rounded-window bg-surface text-left shadow-glow sm:aspect-[16/9]">
      {/* Sidebar */}
      <aside className="hidden w-[200px] shrink-0 flex-col border-r border-line bg-bg/60 p-3 sm:flex">
        <div className="flex items-center gap-2 px-1.5 py-1">
          <LogoMark className="size-6 rounded-[8px]" />
          <span className="text-[12px] font-semibold">{brand.name}</span>
        </div>
        <ul className="mt-4 flex flex-col gap-0.5">
          {navItems.map(({ icon: Icon, label, active }) => (
            <li
              key={label}
              className={cx(
                'flex h-8 items-center gap-2 rounded-[10px] px-2 text-[12px]',
                active ? 'bg-white/[0.07] text-fg' : 'text-muted',
              )}
            >
              <Icon className="size-3.5" />
              <span className="flex-1">{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 px-2 text-[11px] text-faint">연결된 서버</p>
        <ul className="mt-1 flex flex-col gap-0.5">
          <li className="flex h-7 items-center gap-2 rounded-[10px] px-2 text-[12px] text-muted">
            <span
              className={cx('size-2 shrink-0 rounded-[3px]', online ? 'bg-accent' : 'bg-accent-3')}
              style={online ? { boxShadow: '0 0 8px rgb(74_222_128/0.8)' } : undefined}
            />
            <span className="min-w-0 flex-1 truncate">{server.host || '미설정'}</span>
          </li>
        </ul>
        <div className="mt-auto px-2 text-[11px] text-faint">{formatTime(status?.checkedAt)} 확인</div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium">실시간 서버 상태</span>
            <span className="hidden text-[12px] text-faint sm:inline">30초마다 갱신</span>
          </div>
          <div className="depth relative flex items-center gap-1 rounded-[10px] bg-white/[0.04] p-0.5 text-[11px]">
            <span className="rounded-[8px] bg-white/[0.08] px-2 py-1 text-fg">상태</span>
            <span className="px-2 py-1 text-muted">정보</span>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 gap-3 p-4">
          {[
            {
              label: '접속자',
              value: status && status.resolved && status.online ? `${status.playersOnline ?? 0}` : '—',
              delta:
                status && status.resolved && status.online && status.playersMax !== null
                  ? `/ ${status.playersMax}`
                  : '',
              tone: online ? 'text-accent' : 'text-muted',
            },
            { label: '서버 상태', value: stateText, delta: '', tone: online ? 'text-accent' : 'text-accent-3' },
            { label: '서버 버전', value: status?.version ?? '—', delta: '', tone: 'text-accent-2' },
          ].map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.5 }}
              className="depth relative min-w-0 rounded-[14px] bg-white/[0.02] p-3"
            >
              <p className="text-[11px] text-muted">{kpi.label}</p>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="min-w-0 truncate text-[20px] font-semibold tracking-tight">{kpi.value}</span>
                {kpi.delta && <span className={cx('text-[11px]', kpi.tone)}>{kpi.delta}</span>}
              </div>
            </motion.div>
          ))}

          <div className="depth relative col-span-3 flex flex-col rounded-[14px] bg-white/[0.02] p-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium">실시간 서버 정보</p>
              <span className="text-[11px] text-faint">{configured ? (status ? '실시간' : '확인 중') : '주소 미설정'}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
              {facts.map((fact) => (
                <div key={fact.label} className="min-w-0">
                  <dt className="text-[11px] text-faint">{fact.label}</dt>
                  <dd className="mt-0.5 truncate text-[13px] font-medium text-fg">{fact.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[11px] text-faint">MOTD</p>
              <p className="mt-0.5 truncate text-[13px] text-fg/90">{status?.motd ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
