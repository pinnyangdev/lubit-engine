import { useEffect, useRef, useState } from 'react'
import { Download, Laptop, Loader2, Monitor, Smartphone, Tablet } from 'lucide-react'

import { Button } from './Button'
import { cx } from '../lib/cx'
import { downloadArtifact, type DownloadProgress } from '../lib/download'

// /download/manifest.json — scripts/split-installer.mjs 가 빌드 때 만듭니다.
// 파일이 실제로 존재하는 배포본만 available 로 올라옵니다.
type Artifact = {
  key: string
  label: string
  url: string
  size: number
  version?: string
  available: boolean
}

type Platform = 'engine' | 'mac' | 'android' | 'ios'

const icon: Record<Platform, typeof Monitor> = {
  engine: Monitor,
  mac: Laptop,
  android: Smartphone,
  ios: Tablet,
}

function detect(): Platform {
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
  return 'engine'
}

function sizeLabel(bytes: number) {
  if (!bytes) return ''
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// 다운로드 버튼 — 누르면 무엇을 받을지 고르는 창을 띄웁니다.
export function DownloadButton({
  label,
  href,
  className,
}: {
  label: string
  href: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size="lg" className={className} onClick={() => setOpen(true)}>
        {label}
        <Download />
      </Button>
      {open && <Chooser onClose={() => setOpen(false)} fallback={href} />}
    </>
  )
}

function Chooser({ onClose, fallback }: { onClose: () => void; fallback: string }) {
  const [items, setItems] = useState<Artifact[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Artifact | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const device = detect()

  useEffect(() => {
    let alive = true
    fetch('/download/manifest.json')
      .then(async (res) => (res.ok ? ((await res.json()) as { artifacts?: Artifact[] }) : Promise.reject(new Error('no manifest'))))
      .then((data) => {
        if (alive) setItems(data.artifacts ?? [])
      })
      .catch(() => {
        // 매니페스트를 못 받으면 예전처럼 바로 받는 주소로 보냅니다.
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, working])

  // 조각을 직접 받아 브라우저에서 붙입니다. Worker가 대신 보내면 CPU 한도에
  // 걸려 파일이 조용히 작아져서, 중간에 끊겨도 알 수 없었습니다.
  async function pick(item: Artifact) {
    if (!item.available || working) return
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setPicked(item)
    setProgress({ loaded: 0, total: item.size, label: '준비 중' })
    setWorking(true)
    try {
      await downloadArtifact(item.key, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      onClose()
    } catch (err) {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : '내려받기에 실패했습니다')
      setWorking(false)
      setProgress(null)
    }
  }

  function retry() {
    const item = picked
    setError(null)
    if (item) void pick(item)
  }

  if (failed) {
    window.location.href = fallback
    return null
  }

  const percent = progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="다운로드할 플랫폼 선택"
      onClick={(event) => {
        if (event.target === event.currentTarget && !working) onClose()
      }}
    >
      <div className="depth w-full max-w-md rounded-card bg-surface p-6 shadow-glow">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em]">무엇으로 받으시겠어요?</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              받을 기기를 고르세요. 이 기기에 맞는 항목을 먼저 골라 뒀습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (working) return
              onClose()
            }}
            aria-label="닫기"
            className="grid size-8 shrink-0 place-items-center rounded-[10px] text-muted transition hover:bg-white/[0.06] hover:text-fg disabled:opacity-40"
            disabled={working}
          >
            ✕
          </button>
        </div>

        {working && progress ? (
          <div className="mt-6">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-muted">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span className="truncate">{progress.label}</span>
              </span>
              <span className="shrink-0 tabular-nums font-medium text-fg">{percent}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="mt-2.5 text-[12px] text-faint">
              {sizeLabel(progress.loaded)} / {sizeLabel(progress.total)} · 창을 닫으면 받기가 중단됩니다
            </p>
          </div>
        ) : error ? (
          <div className="mt-6">
            <p className="rounded-[12px] border border-red-400/30 bg-red-400/[0.08] px-4 py-3 text-[13px] text-red-200">
              {error}
            </p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Button onClick={retry}>다시 시도</Button>
              <Button variant="secondary" href={picked?.url ?? fallback}>
                그대로 내려받기
              </Button>
            </div>
          </div>
        ) : items === null ? (
          <div className="mt-6 flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" />
            목록 확인 중…
          </div>
        ) : (
          <ul className="mt-5 flex flex-col gap-2.5">
            {items.map((item) => {
              const Icon = icon[item.key as Platform] ?? Monitor
              const isDefault = item.key === device
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    disabled={!item.available}
                    onClick={() => pick(item)}
                    className={cx(
                      'flex w-full items-center gap-3.5 rounded-[14px] border px-4 py-3.5 text-left transition',
                      item.available
                        ? 'border-line bg-white/[0.03] hover:border-accent/50 hover:bg-accent/[0.07]'
                        : 'cursor-not-allowed border-line/60 bg-white/[0.015] opacity-60',
                    )}
                  >
                    <span
                      className={cx(
                        'grid size-10 shrink-0 place-items-center rounded-[12px]',
                        isDefault ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted',
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-medium">{item.label}</span>
                        {isDefault && (
                          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
                            이 기기
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-faint">
                        {item.available
                          ? [sizeLabel(item.size), item.version && `v${item.version}`].filter(Boolean).join(' · ')
                          : '준비 중입니다'}
                      </span>
                    </span>
                    {item.available && <Download className="size-4 shrink-0 text-accent" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-5 text-[12px] leading-relaxed text-faint">
          내려받은 설치 파일을 실행하면 서버 폴더(
          <span className="text-muted">{device === 'mac' ? '~/LubitServers' : 'C:\LubitServers'}</span>)가 만들어집니다.
        </p>
      </div>
    </div>
  )
}
