import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_LABELS, CATEGORY_ORDER, type ChangelogCategory } from '../data/changelog'
import { changelogEntries } from '../data/changelog'

type Release = {
  tag: string
  name: string
  publishedAt: string
  url: string
  body: string
}

// 화면에 그리는 한 항목 — GitHub 릴리스(구동기)와 직접 적은 항목(클라이언트 · 디스코드 봇)을
// 같은 모양으로 섞기 위해 통일한 형태입니다.
type Entry = {
  key: string
  category: ChangelogCategory
  title: string
  publishedAt: string
  body: string
  url?: string
}

// 변경점 — 구동기는 /api/changelog 이 GitHub 릴리스를 10분 캐시해 주는 곳에서 받고,
// 클라이언트 · 디스코드 봇은 저장소가 없어 src/data/changelog.ts 에서 직접 읽습니다.
export function ChangelogPage() {
  const [releases, setReleases] = useState<Release[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<ChangelogCategory | 'all'>('all')

  useEffect(() => {
    let alive = true
    fetch('/api/changelog')
      .then((response) => response.json() as Promise<{ releases?: Release[]; error?: string }>)
      .then((data) => {
        if (!alive) return
        setReleases(Array.isArray(data.releases) ? data.releases : [])
        setFailed(Boolean(data.error))
      })
      .catch(() => {
        if (!alive) return
        setReleases([])
        setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const entries = useMemo<Entry[]>(() => {
    // 직접 적은 항목이 GitHub 릴리스보다 먼저 오도록 합친 뒤 날짜 내림차순으로 정렬합니다.
    const manual: Entry[] = changelogEntries.map((item) => ({
      key: `${item.category}-${item.tag}`,
      category: item.category,
      title: item.tag,
      publishedAt: item.publishedAt,
      body: item.body,
      url: item.url,
    }))
    const fromGithub: Entry[] = (releases ?? []).map((item) => ({
      key: `engine-${item.tag}`,
      category: 'engine' as const,
      title: item.name || item.tag,
      publishedAt: item.publishedAt,
      body: item.body,
      url: item.url,
    }))
    return [...manual, ...fromGithub].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
  }, [releases])

  const counts = useMemo(() => {
    const map: Record<ChangelogCategory, number> = { client: 0, engine: 0, bot: 0 }
    for (const entry of entries) map[entry.category] += 1
    return map
  }, [entries])

  const visible = filter === 'all' ? entries : entries.filter((entry) => entry.category === filter)

  return (
    <div className="mx-auto w-full max-w-[880px] px-5 pb-24 pt-32">
      <p className="text-[13px] font-semibold tracking-[0.18em] text-accent uppercase">Changelog</p>
      <h1 className="mt-3 text-[34px] leading-[1.15] font-semibold tracking-[-0.02em] text-fg sm:text-[42px]">
        변경점
      </h1>
      <p className="mt-4 max-w-[620px] text-[15px] leading-[1.75] text-muted">
        클라이언트 · 서버 구동기 · 디스코드 봇에 무엇이 새로 들어갔는지 버전별로 정리합니다. 구동기는
        앱이 켜져 있을 때 최대 1시간 안에 자동 업데이트를 받습니다.
      </p>

      {/* 카테고리 — 항목이 하나도 없는 카테고리는 누르지 못하게 둡니다. */}
      <div className="mt-8 flex flex-wrap gap-2">
        {[{ key: 'all' as const, label: '전체', count: entries.length }, ...CATEGORY_ORDER.map((key) => ({ key, label: CATEGORY_LABELS[key], count: counts[key] }))].map(
          (tab) => {
            const on = filter === tab.key
            const disabled = tab.key !== 'all' && tab.count === 0
            return (
              <button
                key={tab.key}
                type="button"
                disabled={disabled}
                onClick={() => setFilter(tab.key)}
                className={
                  on
                    ? 'rounded-full border border-accent/50 bg-accent/10 px-4 py-1.5 text-[13px] font-medium text-accent'
                    : 'rounded-full border border-line/60 bg-white/[0.03] px-4 py-1.5 text-[13px] text-muted transition-colors hover:text-fg disabled:opacity-40 disabled:hover:text-muted'
                }
              >
                {tab.label}
                <span className="ml-1.5 tabular-nums opacity-70">{tab.count}</span>
              </button>
            )
          },
        )}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {releases === null && (
          <div className="card rounded-control-lg border border-line/60 bg-white/[0.03] px-5 py-8 text-[14px] text-faint">
            변경점을 불러오는 중…
          </div>
        )}

        {releases !== null && visible.length === 0 && (
          <div className="card rounded-control-lg border border-line/60 bg-white/[0.03] px-5 py-8 text-[14px] text-faint">
            {failed && filter !== 'client' && filter !== 'bot'
              ? '일시적으로 변경점을 받지 못했습니다. 잠시 후 다시 시도해 주세요.'
              : '아직 기록된 변경점이 없습니다.'}
          </div>
        )}

        {visible.map((entry) => (
          <article
            key={entry.key}
            className="rounded-control-lg border border-line/60 bg-white/[0.03] px-5 py-5 sm:px-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                  {CATEGORY_LABELS[entry.category]}
                </span>
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-fg">{entry.title}</h2>
              </div>
              <span className="text-[13px] text-faint tabular-nums">
                {new Date(entry.publishedAt).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
            <div className="mt-3 whitespace-pre-wrap text-[14px] leading-[1.8] text-muted empty:hidden">
              {entry.body || '변경 사항이 요약되어 있지 않은 버전입니다.'}
            </div>
            {entry.url && (
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex text-[13px] text-accent transition-colors hover:text-accent/80"
              >
                GitHub에서 보기 ↗
              </a>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}
