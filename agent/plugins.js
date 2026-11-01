// 플러그인·모드 관리 — Modrinth 에서 받아 폴더에 넣고, 목록을 돌려줍니다.
// 페이퍼 계열은 plugins 폴더를, 팩토리·포지 계열은 mods 폴더를 씁니다.

const fs = require('node:fs/promises')
const path = require('node:path')

const MAX_JAR = 200 * 1024 * 1024
// 파일명으로 쓸 수 있는 문자만 허용합니다. (폴더 탈출 방지)
const FILE_RE = /^[A-Za-z0-9._+\- ]+\.jar$/

// 모드 서버인지 — 이들은 플러그인 대신 mods 폴더를 씁니다.
const MOD_TYPES = new Set(['fabric', 'forge', 'neoforge', 'quilt'])

function isModServer(type) {
  return MOD_TYPES.has(String(type || '').toLowerCase())
}

function jarsDir(root, type) {
  return path.join(path.resolve(root || '.'), isModServer(type) ? 'mods' : 'plugins')
}

async function list(root, type) {
  const dir = jarsDir(root, type)
  const names = await fs.readdir(dir).catch(() => [])
  const entries = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.jar')) continue
    const info = await fs.stat(path.join(dir, name)).catch(() => null)
    if (!info || !info.isFile()) continue
    entries.push({ name, size: info.size, mtime: info.mtimeMs })
  }
  entries.sort((a, b) => b.mtime - a.mtime)
  return { entries }
}

async function remove(root, filename, type) {
  const name = String(filename ?? '')
  if (!FILE_RE.test(name)) throw new Error('올바르지 않은 파일명입니다.')
  const target = path.join(jarsDir(root, type), name)
  await fs.unlink(target).catch(() => {
    throw new Error('파일을 찾을 수 없습니다.')
  })
  return { name }
}

// Modrinth 버전 하나를 받아 jar 를 해당 폴더(plugins · mods)에 내려받습니다.
async function install(root, versionId, type) {
  const id = String(versionId ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('버전 정보가 올바르지 않습니다.')

  const versionRes = await fetch(`https://api.modrinth.com/v2/version/${id}`, {
    headers: { 'User-Agent': 'lubit-engine (https://lubit.kr)' },
  })
  if (!versionRes.ok) throw new Error('Modrinth에서 버전을 받아오지 못했습니다.')
  const version = await versionRes.json().catch(() => null)
  const files = Array.isArray(version && version.files) ? version.files : []
  const file = files.find((item) => item.primary) ?? files[0]
  if (!file) throw new Error('이 버전에는 내려받을 파일이 없습니다.')
  if (!FILE_RE.test(file.filename)) throw new Error('파일명이 안전하지 않아 받지 않았습니다.')
  if (file.size > MAX_JAR) throw new Error('파일이 너무 커서 받지 않았습니다.')

  const download = await fetch(file.url, { headers: { 'User-Agent': 'lubit-engine (https://lubit.kr)' } })
  if (!download.ok || !download.body) throw new Error('파일 내려받기에 실패했습니다.')

  const dir = jarsDir(root, type)
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, file.filename)

  const chunks = []
  let total = 0
  const reader = download.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_JAR) {
      await reader.cancel()
      await fs.unlink(target).catch(() => undefined)
      throw new Error('파일이 너무 커서 받지 않았습니다.')
    }
    chunks.push(Buffer.from(value))
  }
  await fs.writeFile(target, Buffer.concat(chunks))
  return { name: file.filename, size: total }
}

module.exports = { list, remove, install }
