// 중계(relay) 통신 규약입니다. 에이전트와 중계 서버가 함께 씁니다.
//
//   플레이어 → 중계 서버:25565 ── 이 소켓 ──→ 에이전트 → 127.0.0.1:25565
//
// 소켓 위에서 한 방향으로 흐르는 길이는 접두어 + 종류 + 내용으로 이루어집니다.
//   [4바이트 길이][1바이트 종류][내용]   길이 = 1 + 내용 크기

const KIND_OPEN = 1 // 중계 → 에이전트: 새 플레이어 접속
const KIND_DATA = 2 // 양방향: 실제 바이트
const KIND_CLOSE = 3 // 양방향: 접속 끊김
const KIND_READY = 4 // 에이전트 → 중계: 로컬 서버에 연결 완료
const KIND_BIND = 5 // 에이전트 → 중계: 이 서버의 로컬 포트

const MAX_FRAME = 512 * 1024

function frame(kind, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const out = Buffer.alloc(5 + body.length)
  out.writeUInt32BE(body.length + 1, 0)
  out.writeUInt8(kind, 4)
  body.copy(out, 5)
  return out
}

function openPayload(connId, serverId) {
  const payload = Buffer.alloc(8)
  payload.writeUInt32BE(connId >>> 0, 0)
  payload.writeUInt32BE(serverId >>> 0, 4)
  return payload
}

function idPayload(connId) {
  const payload = Buffer.alloc(4)
  payload.writeUInt32BE(connId >>> 0, 0)
  return payload
}

// 끊어진 청크가 와도 프레임을 모아 하나씩 돌려줍니다.
class Decoder {
  constructor(onFrame) {
    this.buffer = Buffer.alloc(0)
    this.onFrame = onFrame
  }

  push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 4) return
      const length = this.buffer.readUInt32BE(0)
      if (length < 1 || length > MAX_FRAME) throw new Error(`프레임 크기가 이상합니다 (${length})`)
      if (this.buffer.length < 4 + length) return
      const kind = this.buffer[4]
      const payload = this.buffer.subarray(5, 4 + length)
      this.buffer = this.buffer.subarray(4 + length)
      this.onFrame(kind, payload)
    }
  }
}

module.exports = { KIND_OPEN, KIND_DATA, KIND_CLOSE, KIND_READY, KIND_BIND, frame, openPayload, idPayload, Decoder }
