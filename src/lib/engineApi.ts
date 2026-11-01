// 서버 구동기 웹 콘솔이 쓰는 API 조각입니다.
// 콘솔 페이지와 각 탭(파일·플러그인·플레이어·지도·접속)이 함께 씁니다.

export const API = '/api/engine'
export const TOKEN_KEY = 'lubit-engine-token'

export type ServerRow = {
  id: number
  name: string
  device_id: string | null
  java_cmd: string
  server_dir: string
  state: string
  players: number | null
  max_players: number | null
  last_error: string | null
  updated_at: number
  port: number | null
  server_type: string | null
  player_names: string | null
  relay_port: number | null
  domain: string | null
  // 1 이면 내가 이 서버의 주인입니다. 0 이면 관리자로 등록돼서 보이는 서버입니다.
  is_owner?: number | null
}

export type DeviceRow = { id: string; name: string; last_seen: number | null }
export type LogRow = { id: number; ts: number; line: string }
export type EngineSnapshot = { servers: ServerRow[]; devices: DeviceRow[] }

// 팩토리·포지 계열 서버는 플러그인 대신 모드를 씁니다 — 탭 이름과 폴더가 달라집니다.
const MOD_SERVER_TYPES = new Set(['fabric', 'forge', 'neoforge', 'quilt'])
export function isModServer(serverType?: string | null): boolean {
  return MOD_SERVER_TYPES.has(String(serverType ?? '').toLowerCase())
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const token = options.token ?? localStorage.getItem(TOKEN_KEY)
  const response = await fetch(API + path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `오류가 발생했습니다. (${response.status})`)
  return data
}

// 서버·기기 목록을 실시간으로 받습니다. 헤더에 토큰을 넣어야 해서 EventSource 대신
// fetch 스트림을 직접 읽습니다. 끊기면 호출 쪽에서 다시 부릅니다.
export async function streamEngine(
  onSnapshot: (data: EngineSnapshot) => void,
  signal?: AbortSignal,
  onLogs?: (rows: LogRow[]) => void,
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  const response = await fetch(`${API}/stream`, {
    headers: {
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  })
  if (!response.ok || !response.body) throw new Error('실시간 연결을 열지 못했습니다.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((part) => part.startsWith('data:'))
      if (!line) continue
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as EngineSnapshot & {
          type?: string
          entries?: LogRow[]
        }
        // 목록 스트림에 함께 실려온 로그는 별도 콜백으로 넘겨 콘솔에 바로 붙입니다.
        if (parsed && parsed.type === 'logs') {
          if (onLogs && Array.isArray(parsed.entries)) onLogs(parsed.entries)
          continue
        }
        onSnapshot(parsed)
      } catch {
        /* 깨진 줄은 버리고 다음 줄을 받습니다 */
      }
    }
  }
}

// 결과를 되돌려받는 명령(파일·플러그인·지도)을 보내고 끝날 때까지 기다립니다.
// 에이전트는 1.5초 주기로 명령을 받으므로 그보다 넉넉하게 폴링합니다.
export async function runCommand<T = Record<string, unknown>>(
  serverId: number,
  type: string,
  args: Record<string, string> = {},
  timeoutMs = 45_000,
): Promise<T> {
  const { id } = await api<{ id: number }>(`/servers/${serverId}/commands`, {
    method: 'POST',
    body: { type, args },
  })

  const started = Date.now()
  for (;;) {
    const row = await api<{ status: string; result: string }>(`/commands/${id}`)
    if (row.status === 'done') {
      try {
        return JSON.parse(row.result || '{}') as T
      } catch {
        return row.result as unknown as T
      }
    }
    if (row.status === 'failed') throw new Error(row.result || '명령이 실패했습니다.')
    if (Date.now() - started > timeoutMs) {
      throw new Error('기기가 응답하지 않습니다. PC 앱이 켜져 있는지 확인해 주세요.')
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

// 콘솔 입력처럼 결과가 필요 없는 명령은 바로 보냅니다.
export function sendCommand(serverId: number, type: string, args: Record<string, string> = {}) {
  return api(`/servers/${serverId}/commands`, { method: 'POST', body: { type, args } })
}

export function playerNames(server: ServerRow): string[] {
  if (!server.player_names) return []
  try {
    const parsed = JSON.parse(server.player_names) as unknown
    return Array.isArray(parsed) ? parsed.filter((name): name is string => typeof name === 'string') : []
  } catch {
    return []
  }
}

export function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
