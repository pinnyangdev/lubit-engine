// 설치 파일 내려받기 — Worker가 87MB를 이어 붙여 보내면 CPU 한도에 걸려
// 중간에 끊길 수 있습니다(실제로 계속 재현됐습니다). 대신 조각을 하나씩
// 받아 브라우저에서 붙입니다. 조각 요청은 정적 자산을 통과할 뿐이라 비용이
// 거의 들지 않고, 각 조각의 길이와 전체 sha256 까지 확인하므로
// 조용히 작아진 파일이 넘어오는 일이 없습니다.

type Part = { path: string; size: number }

type PartManifest = {
  filename: string
  version?: string
  size: number
  sha256: string
  parts: Part[]
}

export type DownloadProgress = {
  /** 지금까지 받은 바이트 */
  loaded: number
  /** 전체 크기 */
  total: number
  /** 화면에 줄 문구 */
  label: string
}

const PART_ATTEMPTS = 3

async function fetchPart(url: string, expected: number, signal?: AbortSignal): Promise<Uint8Array> {
  let lastError: unknown = new Error('조각을 받지 못했습니다')
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength !== expected) throw new Error(`길이 불일치 (${bytes.byteLength}/${expected})`)
      return bytes
    } catch (err) {
      if (signal?.aborted) throw err
      lastError = err
    }
  }
  throw lastError
}

function toHex(buffer: ArrayBuffer) {
  const view = new Uint8Array(buffer)
  let out = ''
  for (const byte of view) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * `/download/<key>` 파일을 내려받아 저장합니다.
 * `onProgress` 로 진행 상황을 받아 화면에 띄울 수 있습니다.
 * 끝까지 정상이면 파일명을 돌려주고, 도중에 문제가 생기면 예외를 던집니다.
 */
export async function downloadArtifact(
  key: string,
  options: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const { onProgress, signal } = options
  const base = `/download/${key}`

  const manifestRes = await fetch(`${base}/manifest.json`, { cache: 'no-store', signal })
  if (!manifestRes.ok) throw new Error('설치 파일 정보를 받지 못했습니다')
  const manifest = (await manifestRes.json()) as PartManifest
  if (!manifest?.parts?.length || !manifest.size) throw new Error('아직 준비 중입니다')

  const chunks: Uint8Array[] = []
  let loaded = 0

  for (let i = 0; i < manifest.parts.length; i++) {
    const part = manifest.parts[i]
    const bytes = await fetchPart(`${base}/${part.path}`, part.size, signal)
    chunks.push(bytes)
    loaded += byteLength(chunks)
    onProgress?.({
      loaded,
      total: manifest.size,
      label: manifest.parts.length > 1 ? `조각 ${i + 1}/${manifest.parts.length} 받는 중` : '받는 중',
    })
  }

  // 조각을 하나의 버퍼로 붙이고 원본은 해제합니다.
  const combined = new Uint8Array(manifest.size)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  chunks.length = 0

  onProgress?.({ loaded: manifest.size, total: manifest.size, label: '무결성 확인 중' })

  const digest = toHex(await crypto.subtle.digest('SHA-256', combined.buffer))
  if (digest !== manifest.sha256) throw new Error('파일 검증에 실패했습니다')

  const blob = new Blob([combined], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = manifest.filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 저장이 끝나기 전에 주소를 없애면 파일이 비어 있습니다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)

  return manifest.filename
}

function byteLength(chunks: Uint8Array[]) {
  let total = 0
  for (const chunk of chunks) total += chunk.byteLength
  return total
}
