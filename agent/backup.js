// 서버 폴더 백업 · 복원 담당입니다.
//
//   폴더 구조: <루트>/_lubit-backups/<서버폴더>/20261031-153000.zip
//
// 서버 폴더 바깥(루트 안)에 두는 이유는 둘입니다 — 백업이 자기 자신을 다시 담지
// 않고, 서버 삭제 시 `folderToDelete()` 는 서버 폴더만 지우므로 백업은 남습니다.
// (서버를 삭제하면 함께 지우는 것은 deleteAll 이 담당합니다.)

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { zipFolder, unzip } = require('./zip')

function backupRoot(root) {
  return path.join(path.resolve(root), '_lubit_backups')
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

// 서버 폴더 이름 — 백업은 여기 아래로 모입니다.
function folderNameOf(serverDir) {
  return path.basename(path.resolve(serverDir))
}

// 백업이 놓일 폴더 이름 — 루트 직속 서버는 폴더 이름이 고유하므로 그대로,
// 밖에서 가져온 서버는 같은 이름이 섞이지 않도록 경로 해시를 붙입니다.
function roomKey(serverRoot, dir) {
  const base = folderNameOf(dir) || 'server'
  if (path.dirname(dir) === serverRoot) return base
  const hash = crypto.createHash('sha1').update(dir).digest('hex').slice(0, 6)
  return `${base}-${hash}`
}

function roomFor(root, serverDir) {
  const serverRoot = path.resolve(root)
  const dir = path.resolve(serverDir)
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('서버 폴더를 찾을 수 없습니다.')
  }
  if (dir === backupRoot(serverRoot)) {
    throw new Error('백업 폴더 자체는 서버로 쓸 수 없습니다.')
  }
  // 루트 밖에서 가져온 서버도 백업할 수 있습니다 — 저장 위치는 늘 루트 안입니다.
  return path.join(backupRoot(serverRoot), roomKey(serverRoot, dir))
}

async function create(serverDir, root, onProgress = () => {}) {
  const room = roomFor(root, serverDir)
  await fs.promises.mkdir(room, { recursive: true })

  let name = `${stamp()}.zip`
  let target = path.join(room, name)
  let suffix = 1
  while (fs.existsSync(target)) {
    name = `${stamp()}-${suffix++}.zip`
    target = path.join(room, name)
  }

  onProgress('zip 을 만드는 중…')
  const result = await zipFolder(serverDir, target, {
    onProgress: ({ processed, total, file }) => {
      if (!total) return
      const percent = Math.floor((processed / total) * 100)
      onProgress(`${percent}% — ${file || '마무리 중'} (${mb(processed)} / ${mb(total)})`)
    },
  })
  onProgress(`${name} 완료 (${mb(result.size)})`)
  return {
    file: name,
    size: result.size,
    files: result.files,
    createdAt: Date.now(),
  }
}

async function list(serverDir, root) {
  const room = roomFor(root, serverDir)
  let entries = []
  try {
    entries = await fs.promises.readdir(room, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.zip')) continue
    const full = path.join(room, entry.name)
    try {
      const stat = await fs.promises.stat(full)
      out.push({ file: entry.name, size: stat.size, createdAt: stat.mtimeMs })
    } catch {
      /* 읽지 못하면 목록에서 제외 */
    }
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

// 복원 — 압축을 임시 폴더에 먼저 풀고, 다 되면 폴더를 통째로 갈아 끼웁니다.
// 풀다가 실패해도 원래 서버는 그대로 남습니다.
async function restore(serverDir, root, fileName, onProgress = () => {}) {
  const room = roomFor(root, serverDir)
  const zipPath = path.join(room, path.basename(String(fileName || '')))
  if (!zipPath.startsWith(room + path.sep) || !fs.existsSync(zipPath)) {
    throw new Error('백업 파일을 찾을 수 없습니다.')
  }

  const parent = path.dirname(path.resolve(serverDir))
  const staging = path.join(parent, `.lubit-restore-${Date.now()}`)
  await fs.promises.mkdir(staging, { recursive: true })

  try {
    onProgress('압축을 푸는 중…')
    const result = await unzip(zipPath, staging, {
      onProgress: ({ files, file }) => onProgress(`${files}개 풀었음 — ${file || '완료'}`),
    })

    // 서버가 실행 중이면 파일이 잡혀 있어 교체에 실패합니다 — 미리 막습니다.
    onProgress('폴더를 갈아 끼우는 중…')
    const retired = `${serverDir}.old-${Date.now()}`
    await fs.promises.rename(serverDir, retired)
    try {
      await fs.promises.rename(staging, serverDir)
    } catch (error) {
      // 되돌립니다 — 옛 폴더를 제자리로.
      await fs.promises.rename(retired, serverDir).catch(() => undefined)
      throw error
    }
    await fs.promises.rm(retired, { recursive: true, force: true }).catch(() => undefined)
    onProgress(`복원 완료 (${result.files}개 파일)`)
    return { files: result.files, bytes: result.bytes }
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function remove(serverDir, root, fileName) {
  const room = roomFor(root, serverDir)
  const target = path.join(room, path.basename(String(fileName || '')))
  if (!target.startsWith(room + path.sep)) throw new Error('잘못된 백업 파일입니다.')
  await fs.promises.rm(target, { force: true })
}

// 서버를 삭제할 때 백업 폴더도 함께 지웁니다.
async function deleteAll(serverDir, root) {
  try {
    const room = roomFor(root, serverDir)
    await fs.promises.rm(room, { recursive: true, force: true })
  } catch {
    /* 백업이 없으면 넘어갑니다 */
  }
}

function mb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(1)}MB`
}

module.exports = { create, list, restore, remove, deleteAll, backupRoot }
