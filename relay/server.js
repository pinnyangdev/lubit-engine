#!/usr/bin/env node
// 루빗 중계 서버 (relay)
//
// 집에서 돌리는 마크 서버에 포트포워딩 없이 접속하게 해주는 중계입니다.
// 방향은 항상 밖으로만 뜁니다.
//
//   플레이어 → 중계 서버:25565 ──HTTPX 소켓──→ 에이전트 → 127.0.0.1:25565
//
// VPS 에서 이렇게 켭니다.
//   LUBIT_BASE=https://lubit.kr CONTROL_PORT=7777 node relay/server.js
//
// 방화벽에서 CONTROL_PORT(에이전트용)와 서버마다 배정된 포트(플레이어용)를
// 열어 주세요. 배정된 포트 목록은 lubit.kr API 에서 받아옵니다.

const net = require('node:net')

const {
  KIND_OPEN,
  KIND_DATA,
  KIND_CLOSE,
  KIND_BIND,
  frame,
  openPayload,
  idPayload,
  Decoder,
} = require('../agent/protocol')

const CONTROL_PORT = Number(process.env.CONTROL_PORT || 7777)
// 목록 갱신 주기 — 차단이 반영되기까지 걸리는 최대 시간입니다.
// 접속 막는 게 목적이라 기본 1분으로 잡고, 환경변수로 바꿀 수 있습니다.
const REFRESH_MS = Number(process.env.RELAY_REFRESH_MS || 60000)
const BASE = (process.env.LUBIT_BASE || 'https://lubit.kr').replace(/\/+$/, '')

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args)
}

// 기기 토큰으로 이 기기가 맡을 서버와 공인 포트를 받습니다.
async function fetchServers(token) {
  const res = await fetch(`${BASE}/api/engine/agent/relay`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`인증에 실패했습니다 (${res.status})`)
  const data = await res.json().catch(() => ({}))
  if (data.enabled === false) return [] // 이 서버에는 중계가 켜져 있지 않습니다.
  if (!Array.isArray(data.servers)) throw new Error('서버 목록을 받지 못했습니다.')
  return data.servers.filter((server) => Number(server.port) > 0)
}

function createRelay({ auth = fetchServers, onLog = log } = {}) {
  const listeners = new Map() // 포트 → { server, sessions:Set }
  const sessions = new Set()
  const serverByPort = new Map() // 포트 → 서버 id
  let nextConn = 1
  let refreshTimer = null

  const send = (session, payload) => {
    if (session.socket.destroyed) return
    try {
      session.socket.write(payload)
    } catch {
      session.socket.destroy()
    }
  }

  function dropSession(session) {
    if (!sessions.delete(session)) return
    for (const socket of session.conns.values()) socket.destroy()
    session.conns.clear()
    for (const port of session.ports) {
      const listener = listeners.get(port)
      if (!listener) continue
      listener.sessions.delete(session)
      if (listener.sessions.size === 0) {
        listener.server.close()
        listeners.delete(port)
        onLog(`포트 ${port} 대기 종료`)
      }
    }
    session.ports.clear()
    onLog(`기기 연결 종료 (${session.name})`)
  }

  function handlePlayer(port, socket) {
    socket.on('error', () => socket.destroy())
    const serverId = serverByPort.get(port)
    const session = [...sessions].find((item) => item.serverIds.has(serverId))
    if (!session || !serverId) {
      socket.destroy() // 지금은 이 서버를 맡은 기기가 없습니다.
      return
    }

    const connId = nextConn++
    session.conns.set(connId, socket)
    send(session, frame(KIND_OPEN, openPayload(connId, serverId)))

    socket.on('data', (chunk) => send(session, frame(KIND_DATA, Buffer.concat([idPayload(connId), chunk]))))
    const close = () => {
      if (!session.conns.delete(connId)) return
      send(session, frame(KIND_CLOSE, idPayload(connId)))
    }
    socket.on('close', close)
    socket.on('end', close)
  }

  function listen(session, server) {
    serverByPort.set(server.port, server.id)
    session.ports.add(server.port)
    const existing = listeners.get(server.port)
    if (existing) {
      existing.sessions.add(session)
      return
    }

    const owner = net.createServer((socket) => handlePlayer(server.port, socket))
    owner.on('error', (error) => onLog(`포트 ${server.port} 오류: ${error.message}`))
    owner.listen(server.port, () => onLog(`포트 ${server.port} 대기 시작 (서버 ${server.id})`))
    listeners.set(server.port, { server: owner, sessions: new Set([session]) })
  }

  function closeListener(port, reason) {
    const listener = listeners.get(port)
    if (!listener) return
    listener.server.close()
    listeners.delete(port)
    serverByPort.delete(port)
    onLog('포트 ' + port + ' 대기 종료' + (reason ? ' — ' + reason : ''))
  }

  // 목록을 그대로 반영합니다 — 인증 직후와 갱신 때 똑같이 씁니다.
  function applyServers(session, servers) {
    const wanted = new Map()
    for (const server of servers) {
      if (Number(server.port) > 0) wanted.set(Number(server.port), server)
    }
    session.serverIds = new Set(servers.map((server) => Number(server.id)))

    // 목록에서 빠진 서버의 포트는 즉시 닫습니다.
    // 이 줄이 있어야 "차단됨" 표시만 바뀌고 접속은 계속 되는 일이 없어집니다.
    for (const port of [...session.ports]) {
      if (wanted.has(port)) continue
      session.ports.delete(port)
      const listener = listeners.get(port)
      if (!listener) continue
      listener.sessions.delete(session)
      if (listener.sessions.size === 0) closeListener(port, '목록에서 제거됨')
    }

    for (const server of wanted.values()) listen(session, server)
  }

  function onFrame(session, kind, payload) {
    if (kind === KIND_DATA) {
      if (payload.length < 4) return
      const connId = payload.readUInt32BE(0)
      const socket = session.conns.get(connId)
      if (socket && !socket.destroyed) socket.write(payload.subarray(4))
      return
    }
    if (kind === KIND_CLOSE) {
      if (payload.length < 4) return
      const socket = session.conns.get(payload.readUInt32BE(0))
      if (socket) {
        session.conns.delete(payload.readUInt32BE(0))
        socket.destroy()
      }
      return
    }
    if (kind === KIND_BIND) {
      try {
        const info = JSON.parse(payload.toString('utf8'))
        session.bindings.set(Number(info.serverId), Number(info.localPort))
      } catch {
        /* 잘못된 선언은 무시합니다 */
      }
    }
  }

  const control = net.createServer((socket) => {
    socket.setNoDelay(true)
    let ready = false
    let pendingAuth = false
    let queue = Buffer.alloc(0)
    let decoder = null
    let session = null

    const feed = (chunk) => {
      try {
        decoder.push(chunk)
      } catch (error) {
        onLog(`프레임 오류: ${error.message}`)
        socket.destroy()
      }
    }

    const tryAdvance = () => {
      if (ready || pendingAuth) return
      const newline = queue.indexOf(0x0a)
      if (newline < 0) {
        if (queue.length > 8192) socket.destroy()
        return
      }
      const line = queue.subarray(0, newline).toString('utf8').trim()
      queue = queue.subarray(newline + 1)

      const match = /^AUTH\s+(\S+)$/.exec(line)
      if (!match) {
        socket.write('ERR AUTH <기기토큰> 형태로 연결해 주세요\n')
        socket.destroy()
        return
      }

      pendingAuth = true
      Promise.resolve()
        .then(() => auth(match[1]))
        .then((servers) => {
          pendingAuth = false
          ready = true
          session = {
            socket,
            token: match[1],
            name: match[1].slice(0, 6) + '…',
            serverIds: new Set(servers.map((server) => Number(server.id))),
            ports: new Set(),
            bindings: new Map(),
            conns: new Map(),
          }
          sessions.add(session)
          socket.write('OK ' + servers.length + String.fromCharCode(10))
          applyServers(session, servers)
          decoder = new Decoder((kind, payload) => onFrame(session, kind, payload))
          const rest = queue
          queue = Buffer.alloc(0)
          if (rest.length) feed(rest)
          onLog(`기기 연결 (${servers.length}개 서버)`)
        })
        .catch((error) => {
          pendingAuth = false
          onLog(`인증 실패: ${error.message}`)
          socket.write(`ERR ${error.message}\n`)
          socket.destroy()
        })
    }

    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      if (session) dropSession(session)
    })
    socket.on('data', (chunk) => {
      if (ready && decoder) {
        feed(chunk)
        return
      }
      queue = queue.length === 0 ? chunk : Buffer.concat([queue, chunk])
      tryAdvance()
    })
  })

  // 목록이 바뀌면 포트도 따라 바뀌어야 합니다. 인증 때 한 번만 읽으면
  // 서버를 차단해도 포트가 계속 열려 있어 실제 접속이 그대로입니다.
  refreshTimer = setInterval(() => {
    for (const session of [...sessions]) {
      if (session.socket.destroyed || !session.token) continue
      Promise.resolve()
        .then(() => auth(session.token))
        .then((servers) => applyServers(session, servers))
        .catch((error) => onLog('중계 목록 갱신 실패: ' + error.message))
    }
  }, REFRESH_MS)
  refreshTimer.unref?.()

  return {
    control,
    listenControl(port = CONTROL_PORT) {
      return new Promise((resolve) => control.listen(port, () => resolve(control.address())))
    },
    close() {
      clearInterval(refreshTimer)
      for (const session of [...sessions]) dropSession(session)
      control.close()
    },
    get sessionCount() {
      return sessions.size
    },
  }
}

module.exports = { createRelay, fetchServers }

if (require.main === module) {
  const relay = createRelay()
  relay.listenControl(CONTROL_PORT).then((address) => {
    log(`중계 서버 시작 — 에이전트 주소 ${address.address}:${address.port} · API ${BASE}`)
  })
  process.on('SIGINT', () => {
    relay.close()
    process.exit(0)
  })
}
