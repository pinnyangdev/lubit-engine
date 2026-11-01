// 최소한의 NBT 판독기입니다. 월드 지도를 그릴 때 청크 높이값만 읽으면 되므로
// 필요한 태그(숫자·문자열·배열·컴파운드·리스트)만 지원합니다.
//
// 문서: https://minecraft.wiki/w/NBT_format

const TAG_END = 0
const TAG_BYTE = 1
const TAG_SHORT = 2
const TAG_INT = 3
const TAG_LONG = 4
const TAG_FLOAT = 5
const TAG_DOUBLE = 6
const TAG_BYTE_ARRAY = 7
const TAG_STRING = 8
const TAG_LIST = 9
const TAG_COMPOUND = 10
const TAG_INT_ARRAY = 11
const TAG_LONG_ARRAY = 12

class Reader {
  constructor(buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  need(count) {
    if (this.offset + count > this.buffer.length) throw new Error('NBT 데이터가 끊겼습니다.')
  }

  byte() {
    this.need(1)
    const value = this.buffer.readInt8(this.offset)
    this.offset += 1
    return value
  }

  unsignedByte() {
    this.need(1)
    const value = this.buffer.readUInt8(this.offset)
    this.offset += 1
    return value
  }

  short() {
    this.need(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  int() {
    this.need(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  long() {
    this.need(8)
    const value = this.buffer.readBigInt64BE(this.offset)
    this.offset += 8
    return value
  }

  float() {
    this.need(4)
    const value = this.buffer.readFloatBE(this.offset)
    this.offset += 4
    return value
  }

  double() {
    this.need(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  string() {
    const length = this.short()
    if (length < 0) throw new Error('잘못된 문자열 길이입니다.')
    this.need(length)
    const value = this.buffer.toString('utf8', this.offset, this.offset + length)
    this.offset += length
    return value
  }
}

function readPayload(reader, type) {
  switch (type) {
    case TAG_BYTE:
      return reader.byte()
    case TAG_SHORT:
      return reader.short()
    case TAG_INT:
      return reader.int()
    case TAG_LONG:
      return reader.long()
    case TAG_FLOAT:
      return reader.float()
    case TAG_DOUBLE:
      return reader.double()
    case TAG_BYTE_ARRAY: {
      const length = reader.int()
      if (length < 0) return []
      reader.need(length)
      const slice = reader.buffer.subarray(reader.offset, reader.offset + length)
      reader.offset += length
      return Array.from(slice)
    }
    case TAG_STRING:
      return reader.string()
    case TAG_LIST: {
      const childType = reader.unsignedByte()
      const length = reader.int()
      const out = []
      for (let i = 0; i < length; i++) out.push(childType === TAG_END ? null : readPayload(reader, childType))
      return out
    }
    case TAG_COMPOUND: {
      const out = {}
      for (;;) {
        const childType = reader.unsignedByte()
        if (childType === TAG_END) return out
        const name = reader.string()
        out[name] = readPayload(reader, childType)
      }
    }
    case TAG_INT_ARRAY: {
      const length = reader.int()
      const out = new Array(length)
      for (let i = 0; i < length; i++) out[i] = reader.int()
      return out
    }
    case TAG_LONG_ARRAY: {
      const length = reader.int()
      const out = new Array(length)
      for (let i = 0; i < length; i++) out[i] = reader.long()
      return out
    }
    default:
      throw new Error(`알 수 없는 NBT 태그: ${type}`)
  }
}

// 루트 컴파운드 하나를 읽습니다.
function parse(buffer) {
  const reader = new Reader(buffer)
  const type = reader.unsignedByte()
  if (type !== TAG_COMPOUND) throw new Error('NBT 루트가 컴파운드가 아닙니다.')
  reader.string() // 루트 이름
  return readPayload(reader, TAG_COMPOUND)
}

module.exports = { parse, TAG_END, TAG_COMPOUND }
