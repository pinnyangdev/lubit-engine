// 중계 서버 연결 — 집 PC에서 밖으로만 연결을 띄워, 포트포워딩 없이도
// 바깥 플레이어가 우리 서버에 들어올 수 있게 합니다.
//
//   플레이어 → 중계 서버 → (여기) → 127.0.0.1:<서버포트>

const net = require('node:net')

const { KIND_OPEN, KIND_DATA, KIND_CLOSE, KIND_READY, KIND_BIND, frame, openPayload, Decoder } = require('./protocol')

const RETRY_MIN = 5_000
const RETRY_MAX = 60_000

class RelayClient {
  constructor({ host, port, token, servers, log = () => {} }) {
    this.host = host
    this.port = Number(port) || 7777
    this.token = token
    this.servers = servers // [{ id, localPort }]
    this.log = log
    this.socket = null
    this.decoder = null
    this.handshake = Buffer.alloc(0)
    this.authed = false
    this.stopped = false
    this.retry = RETRY_MIN
    this.timer = null
    this.conns = new Map() // connId → 로컬 소켓
  }

  start() {
    this.stopped = false
    this.connect()
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const socket of this.conns.values()) socket.destroy()
    this.conns.clear()
    if (this.socket) this.socket.destroy()
    this.socket = null
  }

  send(payload) {
    if (!this.socket || this.socket.destroyed) return
    try {
      this.socket.write(payload)
    } catch {
      this.socket.destroy()
    }
  }

  connect() {
    if (this.stopped) return
    const socket = net.connect(this.port, this.host)
    socket.setNoDelay(true)
    this.socket = socket
    this.authed = false
    this.handshake = Buffer.alloc(0)
    this.decoder = new Decoder((kind, payload) => this.onFrame(kind, payload))

    socket.on('connect', () => {
      socket.write(`AUTH ${this.token}\n`)
    })

    socket.on('data', (chunk) => {
      if (this.authed) {
        try {
          this.decoder.push(chunk)
        } catch (error) {
          this.log(`중계 응답 오류: ${error.message}`)
          socket.destroy()
        }
        return
      }
      this.handshake = Buffer.concat([this.handshake, chunk])
      const newline = this.handshake.indexOf(0x0a)
      if (newline < 0) return
      const line = this.handshake.subarray(0, newline).toString('utf8').trim()
      const rest = this.handshake.subarray(newline + 1)
      this.handshake = Buffer.alloc(0)

      if (line.startsWith('ERR')) {
        this.log(`중계 서버 거부: ${line.slice(4).trim() || '인증 실패'}`)
        socket.destroy()
        return
      }
      if (!line.startsWith('OK')) {
        this.log(`중계 서버 응답이 이상합니다: ${line.slice(0, 60)}`)
        socket.destroy()
        return
      }

      this.authed = true
      this.retry = RETRY_MIN
      this.log(`중계 서버에 연결됨 — 포트 ${this.servers.map((server) => server.localPort).join(', ')}`)
      for (const server of this.servers) {
        this.send(
          frame(KIND_BIND, Buffer.from(JSON.stringify({ serverId: server.id, localPort: server.localPort }))),
        )
      }
      if (rest.length) {
        try {
          this.decoder.push(rest)
        } catch {
          /* 남은 조각은 무시하고 다음 연결에서 다시 받습니다 */
        }
      }
    })

    socket.on('error', (error) => {
      if (!this.authed) this.log(`중계 서버 연결 실패: ${error.message}`)
    })

    socket.on('close', () => {
      for (const socketOfConn of this.conns.values()) socketOfConn.destroy()
      this.conns.clear()
      this.authed = false
      if (this.stopped) return
      this.timer = setTimeout(() => this.connect(), this.retry)
      this.retry = Math.min(RETRY_MAX, this.retry * 2)
    })
  }

  onFrame(kind, payload) {
    if (kind === KIND_OPEN) {
      if (payload.length < 8) return
      const connId = payload.readUInt32BE(0)
      const serverId = payload.readUInt32BE(4)
      const target = this.servers.find((server) => server.id === serverId)
      if (!target) {
        this.sendClose(connId)
        return
      }

      const local = net.connect(target.localPort, '127.0.0.1')
      local.setNoDelay(true)
      this.conns.set(connId, local)

      local.on('connect', () => this.send(frame(KIND_READY, payload.subarray(0, 4))))
      local.on('data', (chunk) => {
        const header = Buffer.alloc(4)
        header.writeUInt32BE(connId >>> 0, 0)
        this.send(frame(KIND_DATA, Buffer.concat([header, chunk])))
      })
      const done = () => {
        if (!this.conns.delete(connId)) return
        local.destroy()
        this.sendClose(connId)
      }
      local.on('error', done)
      local.on('close', done)
      return
    }

    if (kind === KIND_DATA) {
      if (payload.length < 4) return
      const connId = payload.readUInt32BE(0)
      const local = this.conns.get(connId)
      if (local && !local.destroyed) local.write(payload.subarray(4))
      return
    }

    if (kind === KIND_CLOSE) {
      if (payload.length < 4) return
      const connId = payload.readUInt32BE(0)
      const local = this.conns.get(connId)
      if (local) {
        this.conns.delete(connId)
        local.destroy()
      }
    }
  }

  sendClose(connId) {
    const payload = Buffer.alloc(4)
    payload.writeUInt32BE(connId >>> 0, 0)
    this.send(frame(KIND_CLOSE, payload))
  }
}

module.exports = { RelayClient }
