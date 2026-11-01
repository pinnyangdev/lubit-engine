import { useEffect, useState } from 'react'

import { server } from '../content'

export type ServerStatus = {
  host: string
  online: boolean
  resolved: boolean
  playersOnline: number | null
  playersMax: number | null
  version: string | null
  motd: string | null
  retrievedAt: number | null
  checkedAt: number | null
}

export type ServerStatusState = {
  status: ServerStatus | null
  error: boolean
  configured: boolean
}

// Reads the site's own server status from the Worker, then refreshes it so
// the numbers on screen are never a stored sample.
export function useServerStatus(intervalMs = 30000): ServerStatusState {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!server.host) return
    let alive = true

    const load = async () => {
      try {
        const response = await fetch(`/api/server-status?host=${encodeURIComponent(server.host)}`, {
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(String(response.status))
        const data = (await response.json()) as ServerStatus
        if (!alive) return
        setStatus(data)
        setError(false)
      } catch {
        if (alive) setError(true)
      }
    }

    void load()
    const id = window.setInterval(load, intervalMs)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [intervalMs])

  return { status, error, configured: Boolean(server.host) }
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
