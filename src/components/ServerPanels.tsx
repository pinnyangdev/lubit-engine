import {
  ArrowLeft,
  Ban,
  Check,
  Copy,
  Download,
  File as FileIcon,
  Folder,
  Globe,
  Map as MapIcon,
  RefreshCw,
  Save,
  Search,
  ShieldMinus,
  ShieldOff,
  ShieldPlus,
  Star,
  StarOff,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { cx } from '../lib/cx'
import { api, formatBytes, isModServer, playerNames, runCommand, sendCommand, type ServerRow } from '../lib/engineApi'

const card = 'depth rounded-card bg-surface p-5 shadow-glow'
const button =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition disabled:opacity-50'
const primary = `${button} bg-accent text-bg hover:brightness-110`
const quiet = `${button} bg-white/[0.06] text-fg hover:bg-white/[0.10]`
const input =
  'h-9 min-w-0 flex-1 rounded-[10px] border border-line bg-bg/60 px-3 text-[13px] text-fg placeholder:text-faint focus:outline-none'

function Notice({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'info' }) {
  return (
    <p
      className={cx(
        'rounded-[12px] border px-3.5 py-2.5 text-[13px] leading-relaxed',
        tone === 'error' ? 'border-red-400/30 bg-red-400/[0.08] text-red-200' : 'border-line bg-white/[0.03] text-muted',
      )}
    >
      {children}
    </p>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-6 text-[13px] text-muted">
      <RefreshCw className="size-4 animate-spin" />
      {label}
    </p>
  )
}

// --- 파일 -------------------------------------------------------------------

type FileEntry = { name: string; type: 'dir' | 'file'; size: number; mtime: number }

export function FilesPanel({ server }: { server: ServerRow }) {
  const [folder, setFolder] = useState('.')
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function load(path: string) {
    setBusy(true)
    setError('')
    try {
      const data = await runCommand<{ entries?: FileEntry[] }>(server.id, 'file_list', { path })
      setFolder(path)
      setEntries(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '목록을 받지 못했습니다.')
      setEntries([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setEntries(null)
    setEditing(null)
    void load('.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  async function open(name: string) {
    const path = folder === '.' ? name : `${folder}/${name}`
    setBusy(true)
    setError('')
    try {
      const data = await runCommand<{ content: string; path: string }>(server.id, 'file_read', { path })
      setEditing({ path: data.path, content: data.content })
    } catch (err) {
      setError(err instanceof Error ? err.message : '파일을 열지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await runCommand(server.id, 'file_write', { path: editing.path, content: editing.content })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const crumbs = folder === '.' ? [] : folder.split('/')

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || folder === '.'}
          onClick={() => void load(crumbs.slice(0, -1).join('/') || '.')}
          className={quiet}
        >
          <ArrowLeft className="size-4" />
          상위
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-[13px] text-muted">
          <button type="button" onClick={() => void load('.')} className="shrink-0 hover:text-fg">
            서버 폴더
          </button>
          {crumbs.map((part, index) => (
            <span key={`${part}-${index}`} className="shrink-0">
              <span className="text-faint">/</span>
              <button
                type="button"
                onClick={() => void load(crumbs.slice(0, index + 1).join('/'))}
                className="hover:text-fg"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
        <button type="button" className={quiet} disabled={busy} onClick={() => void load(folder)}>
          <RefreshCw className={cx('size-4', busy && 'animate-spin')} />
          새로고침
        </button>
      </div>

      {error && <div className="mt-3">{<Notice>{error}</Notice>}</div>}

      {editing ? (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate font-mono text-[13px] text-muted">{editing.path}</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" className={quiet} onClick={() => setEditing(null)}>
                목록
              </button>
              <button type="button" className={primary} disabled={busy} onClick={() => void save()}>
                {saved ? <Check className="size-4" /> : <Save className="size-4" />}
                {saved ? '저장됨' : '저장'}
              </button>
            </div>
          </div>
          <textarea
            value={editing.content}
            onChange={(event) => setEditing({ ...editing, content: event.target.value })}
            spellCheck={false}
            className="mt-3 h-[360px] w-full resize-y rounded-[12px] border border-line bg-bg/60 p-3.5 font-mono text-[13px] leading-relaxed text-fg focus:outline-none"
          />
        </div>
      ) : entries === null ? (
        <Loading label="폴더 내용을 받는 중…" />
      ) : (
        <ul className="mt-4 flex max-h-[420px] flex-col gap-1 overflow-y-auto">
          {entries.length === 0 && <li className="py-4 text-[13px] text-faint">비어 있습니다.</li>}
          {entries.map((entry) => (
            <li key={entry.name}>
              <button
                type="button"
                disabled={busy}
                onClick={() => (entry.type === 'dir' ? void load(folder === '.' ? entry.name : `${folder}/${entry.name}`) : void open(entry.name))}
                className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition hover:bg-white/[0.05]"
              >
                {entry.type === 'dir' ? (
                  <Folder className="size-4 shrink-0 text-accent" />
                ) : (
                  <FileIcon className="size-4 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{entry.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-faint">
                  {entry.type === 'file' ? formatBytes(entry.size) : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- 플러그인 ---------------------------------------------------------------

type PluginEntry = { name: string; size: number; mtime: number }
type ModrinthHit = { slug: string; title: string; description: string; downloads: number; icon: string }

export function PluginsPanel({ server }: { server: ServerRow }) {
  const [installed, setInstalled] = useState<PluginEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ModrinthHit[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  // 팩토리·포지 계열은 모드를 plugins 가 아닌 mods 폴더에 씁니다.
  const mods = isModServer(server.server_type)
  const folder = mods ? 'mods' : 'plugins'
  const kind = mods ? '모드' : '플러그인'

  async function refresh() {
    setError('')
    try {
      const data = await runCommand<{ entries?: PluginEntry[] }>(server.id, 'plugin_list', {})
      setInstalled(data.entries ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : `${kind} 목록을 받지 못했습니다.`)
      setInstalled([])
    }
  }

  useEffect(() => {
    setInstalled(null)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  async function search(event: React.FormEvent) {
    event.preventDefault()
    const term = query.trim()
    if (!term) return
    setBusy('검색 중')
    setError('')
    try {
      const data = await api<{ hits: ModrinthHit[] }>(`/modrinth/search?q=${encodeURIComponent(term)}`)
      setHits(data.hits)
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색에 실패했습니다.')
    } finally {
      setBusy('')
    }
  }

  async function install(hit: ModrinthHit) {
    setBusy(`설치 중 · ${hit.title}`)
    setError('')
    try {
      const data = await api<{ versions: { id: string; version: string; loaders: string[] }[] }>(
        `/modrinth/versions?slug=${encodeURIComponent(hit.slug)}`,
      )
      if (data.versions.length === 0) throw new Error('설치할 수 있는 버전이 없습니다.')
      // 서버 종류에 맞는 로더만 골라 넣습니다. (예: Paper 서버에 NeoForge 짝은 안 맞음)
      const loaders: Record<string, string[]> = {
        paper: ['paper', 'bukkit', 'spigot', 'folia'],
        purpur: ['purpur', 'paper'],
        velocity: ['velocity'],
        fabric: ['fabric'],
        forge: ['forge', 'neoforge'],
        vanilla: [],
      }
      const wanted = loaders[server.server_type ?? ''] ?? []
      const matched = wanted.length ? data.versions.filter((item) => item.loaders.some((loader) => wanted.includes(loader))) : data.versions
      const latest = (matched.length ? matched : data.versions)[0]
      if (!latest) throw new Error('이 서버 종류에 맞는 버전이 없습니다.')
      await runCommand(server.id, 'plugin_install', { versionId: latest.id }, 120_000)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '설치에 실패했습니다.')
    } finally {
      setBusy('')
    }
  }

  async function remove(name: string) {
    setBusy(`삭제 중 · ${name}`)
    try {
      await runCommand(server.id, 'plugin_remove', { file: name })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={card}>
      <form onSubmit={(event) => void search(event)} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Modrinth 에서 ${kind} 검색 (예: ${mods ? 'Sodium, Lithium' : 'Essentials, LuckPerms'})`}
          className={input}
        />
        <button type="submit" className={primary} disabled={Boolean(busy)}>
          <Search className="size-4" />
          검색
        </button>
      </form>

      {error && <div className="mt-3">{<Notice>{error}</Notice>}</div>}
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
          <RefreshCw className="size-4 animate-spin" />
          {busy}
        </p>
      )}

      {hits && (
        <ul className="mt-4 flex flex-col gap-2">
          {hits.length === 0 && <li className="py-3 text-[13px] text-faint">검색 결과가 없습니다.</li>}
          {hits.slice(0, 8).map((hit) => (
            <li key={hit.slug} className="flex items-start gap-3 rounded-[12px] border border-line bg-white/[0.02] p-3">
              {hit.icon ? (
                <img src={hit.icon} alt="" className="size-9 shrink-0 rounded-[8px] object-cover" />
              ) : (
                <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white/[0.06]">
                  <Download className="size-4 text-muted" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium">{hit.title}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-faint">
                    {hit.downloads.toLocaleString()}회
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted">
                  {hit.description}
                </span>
              </span>
              <button
                type="button"
                className={`${primary} shrink-0`}
                disabled={Boolean(busy)}
                onClick={() => void install(hit)}
              >
                설치
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex items-center justify-between">
        <p className="text-[13px] font-medium">설치된 {kind}</p>
        <button type="button" className={quiet} disabled={Boolean(busy)} onClick={() => void refresh()}>
          <RefreshCw className="size-4" />
          새로고침
        </button>
      </div>

      {installed === null ? (
        <Loading label={`${folder} 폴더를 확인하는 중…`} />
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {installed.length === 0 && (
            <li className="rounded-[12px] border border-dashed border-line px-3 py-4 text-center text-[13px] text-faint">
              아직 설치된 {mods ? '모드가' : '플러그인이'} 없습니다. 위에서 검색해 보세요.
            </li>
          )}
          {installed.map((plugin) => (
            <li key={plugin.name} className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 hover:bg-white/[0.04]">
              <FileIcon className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{plugin.name}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-faint">{formatBytes(plugin.size)}</span>
              <button
                type="button"
                className="grid size-8 shrink-0 place-items-center rounded-[8px] text-faint transition hover:bg-red-400/15 hover:text-red-200 disabled:opacity-40"
                disabled={Boolean(busy)}
                aria-label={`${plugin.name} 삭제`}
                onClick={() => void remove(plugin.name)}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- 플레이어 ---------------------------------------------------------------

// 이름 옆·설정 줄에 쓰는 정사각 아이콘 버튼. 마우스를 올리면 title 로 이름이 뜹니다.
function IconBtn({
  title,
  disabled,
  danger,
  small,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  danger?: boolean
  small?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'grid place-items-center rounded-[10px] border border-line bg-white/[0.04] text-muted transition',
        small ? 'size-7 rounded-full' : 'size-9',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-white/[0.08] hover:text-fg',
        danger && !disabled && 'hover:border-red-400/40 hover:bg-red-400/15 hover:text-red-200',
      )}
    >
      {children}
    </button>
  )
}

export function PlayersPanel({ server }: { server: ServerRow }) {
  const names = playerNames(server)
  const [name, setName] = useState('')
  const [banned, setBanned] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function command(line: string) {
    setError('')
    void sendCommand(server.id, 'command', { line }).catch(() =>
      setError('명령을 보내지 못했습니다. 서버가 실행 중인지 확인해 주세요.'),
    )
  }

  async function loadBanned() {
    setBusy(true)
    setError('')
    try {
      const data = await runCommand<{ content?: string }>(server.id, 'file_read', { path: 'banned-players.json' })
      const parsed = JSON.parse(data.content || '[]') as { name?: string }[]
      setBanned(parsed.map((entry) => entry.name).filter((entry): entry is string => Boolean(entry)))
    } catch {
      setBanned([])
    } finally {
      setBusy(false)
    }
  }

  const target = name.trim()

  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium">접속 중인 플레이어</p>
        <span className="text-[12px] tabular-nums text-faint">
          {server.players ?? 0}
          {server.max_players !== null ? ` / ${server.max_players}` : ''}
        </span>
      </div>

      {names.length === 0 ? (
        <p className="mt-2 text-[13px] text-faint">지금 접속한 플레이어가 없습니다.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {names.map((entry) => (
            <li
              key={entry}
              className="flex items-center gap-2 rounded-full border border-line bg-white/[0.04] py-1.5 pl-3.5 pr-2"
            >
              <span className="text-[13px]">{entry}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-full text-faint transition hover:bg-white/[0.08] hover:text-fg"
                aria-label={`${entry} 강퇴`}
                title="강퇴"
                onClick={() => command(`kick ${entry}`)}
              >
                <UserMinus className="size-3.5" />
              </button>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-full text-faint transition hover:bg-red-400/20 hover:text-red-200"
                aria-label={`${entry} 밴`}
                title="밴"
                onClick={() => command(`ban ${entry}`)}
              >
                <Ban className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="플레이어 이름"
          className={`${input} max-w-[190px]`}
        />
        <IconBtn title="화이트리스트 추가" disabled={!target} onClick={() => command(`whitelist add ${target}`)}>
          <ShieldPlus className="size-4" />
        </IconBtn>
        <IconBtn title="화이트리스트 제거" disabled={!target} onClick={() => command(`whitelist remove ${target}`)}>
          <ShieldMinus className="size-4" />
        </IconBtn>
        <IconBtn title="밴" danger disabled={!target} onClick={() => command(`ban ${target}`)}>
          <Ban className="size-4" />
        </IconBtn>
        <IconBtn title="밴 해제" disabled={!target} onClick={() => command(`pardon ${target}`)}>
          <ShieldOff className="size-4" />
        </IconBtn>
        <IconBtn title="OP 부여" disabled={!target} onClick={() => command(`op ${target}`)}>
          <Star className="size-4" />
        </IconBtn>
        <IconBtn title="OP 회수" disabled={!target} onClick={() => command(`deop ${target}`)}>
          <StarOff className="size-4" />
        </IconBtn>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <p className="text-[13px] font-medium">밴 목록</p>
        <IconBtn title="밴 목록 불러오기" disabled={busy} onClick={() => void loadBanned()}>
          <RefreshCw className={cx('size-4', busy && 'animate-spin')} />
        </IconBtn>
      </div>
      {banned === null ? (
        <p className="mt-2 text-[13px] text-faint">banned-players.json 을 불러오면 여기에 표시됩니다.</p>
      ) : banned.length === 0 ? (
        <p className="mt-2 text-[13px] text-faint">밴된 플레이어가 없습니다.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {banned.map((entry) => (
            <li key={entry} className="flex items-center gap-2 rounded-full bg-red-400/10 px-3 py-1.5 text-[13px]">
              {entry}
              <IconBtn small title={`${entry} 밴 해제`} onClick={() => command(`pardon ${entry}`)}>
                <ShieldOff className="size-3.5" />
              </IconBtn>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="mt-3">{<Notice>{error}</Notice>}</div>}
    </div>
  )
}

// --- 월드 지도 ---------------------------------------------------------------

type MapRow = {
  world: string
  width: number
  height: number
  png: string
  updatedAt: number
}

export function MapPanel({ server }: { server: ServerRow }) {
  const [map, setMap] = useState<MapRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const data = await api<MapRow>(`/servers/${server.id}/worldmap`)
      setMap(data)
      setError('')
    } catch (err) {
      setMap(null)
      setError(err instanceof Error ? err.message : '')
    }
  }

  async function draw() {
    setBusy(true)
    setError('')
    try {
      await runCommand(server.id, 'world_map', {}, 120_000)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '지도를 그리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    setMap(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium">월드 지도</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {map
              ? `${map.world} · ${new Date(map.updatedAt).toLocaleString('ko-KR')} 그림`
              : '서버 폴더의 월드 파일을 읽어 그립니다. 서버는 꺼져 있어도 됩니다.'}
          </p>
        </div>
        <button type="button" className={primary} disabled={busy} onClick={() => void draw()}>
          <MapIcon className={cx('size-4', busy && 'animate-spin')} />
          {busy ? '그리는 중…' : map ? '다시 그리기' : '지도 그리기'}
        </button>
      </div>

      {error && <div className="mt-3">{<Notice>{error}</Notice>}</div>}

      {map ? (
        <div className="mt-4 overflow-hidden rounded-[14px] border border-line bg-black/40">
          <img src={`data:image/png;base64,${map.png}`} alt={`${map.world} 지도`} className="w-full" />
        </div>
      ) : (
        !error && <Loading label="지도 정보를 확인하는 중…" />
      )}
    </div>
  )
}

// --- 접속 (중계 서버 · 도메인) ------------------------------------------------

type AccessRow = {
  domain: string
  relayPort: number | null
  relayHost: string
  relayIp: string
  configured: boolean
  dnsConfigured: boolean
}

export function AccessPanel({ server }: { server: ServerRow }) {
  const [info, setInfo] = useState<AccessRow | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setInfo(await api<AccessRow>(`/servers/${server.id}/access`))
    } catch (err) {
      setError(err instanceof Error ? err.message : '')
    }
  }

  useEffect(() => {
    setInfo(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // 실시간 스트림이 server.domain 을 갱신하면 그때마다 접속 정보도 다시 받습니다.
  }, [server.id, server.domain])

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/servers/${server.id}/domain`, { method: 'POST', body: { name: name.trim() } })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '도메인을 만들지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await api(`/servers/${server.id}/domain`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '도메인을 지우지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  // 스트림으로 방금 받은 도메인을 가장 먼저 씁니다 — 새로고침 없이 즉시 바뀝니다.
  const address =
    server.domain ||
    info?.domain ||
    (info?.relayHost && info.relayPort ? `${info.relayHost}:${info.relayPort}` : '')

  return (
    <div className={cx(card, 'space-y-5')}>
      <div>
        <p className="text-[13px] font-medium">접속 주소</p>
        {address ? (
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-bg/60 px-3 py-2.5 text-[13.5px] text-accent">
              {address}
            </code>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                void navigator.clipboard.writeText(address)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[13px] leading-relaxed text-faint">
            아직 중계 서버가 연결되지 않았습니다. 중계 서버를 준비하면 포트포워딩 없이도 이 주소로 접속할 수 있습니다.
          </p>
        )}
      </div>

      <div className="rounded-[12px] border border-line bg-white/[0.03] p-3.5">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <Globe className="size-4 text-accent" />
          내 도메인 만들기
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          {info?.domain
            ? `현재 ${info.domain} · 마인크래프트 서버 주소창에 이 이름만 입력하면 됩니다.`
            : '이름을 정하면 내 서버 이름.lubit.kr 주소가 생깁니다.'}
        </p>

        {info?.domain ? (
          <button type="button" className={`${quiet} mt-3`} disabled={busy} onClick={() => void remove()}>
            <Trash2 className="size-4" />
            도메인 삭제
          </button>
        ) : (
          <form onSubmit={(event) => void create(event)} className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value.toLowerCase())}
              placeholder="내 서버 이름 (영문)"
              className={input}
            />
            <button type="submit" className={primary} disabled={busy || !name.trim()}>
              만들기
            </button>
          </form>
        )}
      </div>

      {error && <Notice>{error}</Notice>}

      <div className="space-y-1.5 text-[12.5px] leading-relaxed text-faint">
        {!info?.configured && (
          <p>
            중계 서버 설정이 필요합니다 — <span className="text-muted">relay/</span> 폴더를 VPS 에서 돌리고{' '}
            <span className="text-muted">RELAY_HOST</span> · <span className="text-muted">RELAY_IP</span> 를
            넣어주세요.
          </p>
        )}
        {!info?.dnsConfigured && (
          <p>
            도메인 자동 등록에는 <span className="text-muted">CLOUDFLARE_API_TOKEN</span> 과{' '}
            <span className="text-muted">CLOUDFLARE_ZONE_ID</span> 시크릿이 필요합니다.
          </p>
        )}
        <p>
          접속 방식 — 플레이어는 중계 서버로 들어오고, 그 연결을 에이전트가 집 PC의 서버 포트로 이어 붙입니다. 집
          공유기에서 아무것도 열지 않아도 됩니다.
        </p>
      </div>
    </div>
  )
}

// --- 관리자 (함께 관리하는 사람) ---------------------------------------------

type AdminsRow = {
  role: 'owner' | 'admin'
  owner: { email: string; displayName: string } | null
  admins: { email: string; displayName: string | null; registered: boolean; createdAt: number }[]
}

export function AdminsPanel({ server }: { server: ServerRow }) {
  const [data, setData] = useState<AdminsRow | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      setData(await api<AdminsRow>(`/servers/${server.id}/admins`))
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자 목록을 받지 못했습니다.')
    }
  }

  useEffect(() => {
    setData(null)
    setEmail('')
    setError('')
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const value = email.trim()
    if (!value || busy) return
    setBusy(true)
    setError('')
    try {
      await api(`/servers/${server.id}/admins`, { method: 'POST', body: { email: value } })
      setEmail('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자를 등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api(`/servers/${server.id}/admins?email=${encodeURIComponent(target)}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '관리자를 삭제하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const isOwner = data?.role === 'owner'

  return (
    <div className={cx(card, 'space-y-5')}>
      <div>
        <p className="text-[13px] font-medium">함께 관리하는 사람</p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          이메일로 등록하면 그 사람도 자신의 계정으로 로그인해 이 서버를 함께 관리합니다. 시작·중지·콘솔·파일·
          플러그인·도메인까지 같고, 서버 삭제와 기기 변경·관리자 관리만 주인에게 남습니다.
        </p>
      </div>

      {data === null ? (
        <Loading label="관리자 목록을 확인하는 중…" />
      ) : isOwner ? (
        <form onSubmit={(event) => void add(event)} className="flex gap-2">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="관리자 이메일 (예: friend@example.com)"
            className={input}
            type="email"
          />
          <button type="submit" className={primary} disabled={busy || !email.trim()}>
            <UserPlus className="size-4" />
            등록
          </button>
        </form>
      ) : (
        <p className="rounded-[12px] border border-line bg-white/[0.03] px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
          이 서버의 주인은 <span className="text-fg">{data.owner?.email ?? '—'}</span> 님입니다. 관리자 등록과 삭제는
          주인만 할 수 있습니다.
        </p>
      )}

      {error && <Notice>{error}</Notice>}
      {busy && (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <RefreshCw className="size-4 animate-spin" />
          처리 중…
        </p>
      )}

      <div>
        <p className="text-[13px] font-medium">관리자 {data?.admins.length ?? 0}명</p>
        <ul className="mt-2 flex flex-col gap-1">
          {data && data.admins.length === 0 && (
            <li className="rounded-[12px] border border-dashed border-line px-3 py-4 text-center text-[13px] text-faint">
              아직 등록된 관리자가 없습니다. 위에 이메일을 적어 등록하세요.
            </li>
          )}
          {data?.admins.map((admin) => (
            <li key={admin.email} className="flex items-center gap-3 rounded-[10px] px-2.5 py-2 hover:bg-white/[0.04]">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-white/[0.06]">
                <UserPlus className="size-4 text-accent" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{admin.email}</span>
                <span className="block truncate text-[12px] text-faint">
                  {admin.registered
                    ? `${admin.displayName} · 가입됨`
                    : '아직 가입 전 — 그 이메일로 가입하면 바로 열립니다'}
                </span>
              </span>
              {isOwner && (
                <button
                  type="button"
                  className="grid size-8 shrink-0 place-items-center rounded-[8px] text-faint transition hover:bg-red-400/15 hover:text-red-200 disabled:opacity-40"
                  disabled={busy}
                  aria-label={`${admin.email} 관리자 삭제`}
                  onClick={() => void remove(admin.email)}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
