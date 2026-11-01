// 서버 폴더 안의 파일을 읽고 씁니다. 웹 콘솔의 "파일" 탭이 씁니다.
// 반드시 서버 폴더 안에서만 움직이게 해야 하므로 경로를 한 번 더 검사합니다.

const fs = require('node:fs/promises')
const path = require('node:path')

// 웹 에디터 한도. 명령 하나에 실려 가므로 여유를 두고 줄입니다.
const MAX_READ = 1024 * 1024
const MAX_LIST = 500

// 상대 경로를 서버 폴더 기준 절대 경로로 바꾸면서 밖으로 나가지 않는지 확인합니다.
function resolveSafe(root, relative) {
  const base = path.resolve(root || '.')
  const raw = String(relative ?? '.').replace(/^[\\/]+/, '')
  const target = path.resolve(base, raw)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('서버 폴더 밖으로는 접근할 수 없습니다.')
  }
  return target
}

function toRelative(base, target) {
  const rel = path.relative(base, target)
  return rel === '' ? '.' : rel.split(path.sep).join('/')
}

async function list(root, relative) {
  const base = path.resolve(root || '.')
  const target = resolveSafe(root, relative)
  const info = await fs.stat(target).catch(() => null)
  if (!info) throw new Error('폴더나 파일을 찾을 수 없습니다.')

  if (info.isFile()) {
    return { path: toRelative(base, target), type: 'file', entries: [] }
  }

  const names = await fs.readdir(target)
  const entries = []
  for (const name of names.slice(0, MAX_LIST)) {
    const item = await fs.stat(path.join(target, name)).catch(() => null)
    if (!item) continue
    entries.push({
      name,
      type: item.isDirectory() ? 'dir' : 'file',
      size: item.size,
      mtime: item.mtimeMs,
    })
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ko') : a.type === 'dir' ? -1 : 1))
  return { path: toRelative(base, target), entries, truncated: names.length > MAX_LIST }
}

async function read(root, relative) {
  const base = path.resolve(root || '.')
  const target = resolveSafe(root, relative)
  const info = await fs.stat(target).catch(() => null)
  if (!info) throw new Error('파일을 찾을 수 없습니다.')
  if (!info.isFile()) throw new Error('폴더는 열 수 없습니다.')
  if (info.size > MAX_READ) throw new Error('1MB가 넘는 파일은 웹에서 열 수 없습니다.')

  const buffer = await fs.readFile(target)
  // 널 문자가 섞여 있으면 텍스트가 아닙니다.
  if (buffer.includes(0)) throw new Error('텍스트가 아닌 파일이라 편집할 수 없습니다.')

  const content = buffer.toString('utf8')
  return { path: toRelative(base, target), content, size: info.size, mtime: info.mtimeMs }
}

async function write(root, relative, content) {
  const base = path.resolve(root || '.')
  const target = resolveSafe(root, relative)
  const data = String(content ?? '')
  if (Buffer.byteLength(data, 'utf8') > MAX_READ) throw new Error('1MB가 넘는 파일은 저장할 수 없습니다.')

  const info = await fs.stat(target).catch(() => null)
  if (info && info.isDirectory()) throw new Error('폴더에는 쓸 수 없습니다.')

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, data, 'utf8')
  return { path: toRelative(base, target), size: Buffer.byteLength(data, 'utf8') }
}

// server.properties 에 적힌 서버 포트를 봅니다. 중계 서버가 쓰는 로컬 포트입니다.
async function serverPort(root) {
  try {
    const text = await fs.readFile(path.join(path.resolve(root || '.'), 'server.properties'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index <= 0) continue
      if (line.slice(0, index).trim() !== 'server-port') continue
      const value = Number(line.slice(index + 1).trim())
      if (Number.isInteger(value) && value > 0 && value < 65536) return value
    }
  } catch {
    /* 파일이 없으면 기본값으로 갑니다 */
  }
  return 25565
}

module.exports = { list, read, write, resolveSafe, serverPort }
