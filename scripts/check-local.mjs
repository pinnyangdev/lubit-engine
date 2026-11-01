// 로컬에서 Vite dev 서버(또는 지정한 포트)가 실제로 응답하는지 확인합니다.
// 사용 예:
//   node scripts/check-local.mjs
//   PORT=3000 node scripts/check-local.mjs

import { createServer } from 'node:net'
import { request } from 'node:http'

const targetPort = Number(process.env.PORT) || 5173
const targetHost = 'localhost'

function portOpen(port, host) {
  return new Promise((resolve) => {
    const s = createServer()
    s.listen(port, host, () => {
      s.close()
      resolve(true)
    })
    s.on('error', () => resolve(false))
  })
}

async function checkHttp(port, host) {
  return new Promise((resolve) => {
    const req = request({ hostname: host, port, path: '/', method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: body.slice(0, 500) })
      })
    })
    req.on('error', (err) => resolve({ error: err.message }))
    req.setTimeout(5000, () => {
      req.destroy()
      resolve({ error: 'timeout' })
    })
    req.end()
  })
}

const start = Date.now()
console.log(`확인 대상: http://${targetHost}:${targetPort}`)

const opened = await portOpen(targetPort, targetHost)
console.log(`포트 ${targetPort} 리스닝: ${opened ? '열림' : '안 열림'}`)

if (opened) {
  const r = await checkHttp(targetPort, targetHost)
  if (r.error) {
    console.log(`HTTP 응답: 실패 — ${r.error}`)
  } else {
    console.log(`HTTP 응답: ${r.status}`)
    console.log(`응답 헤더 content-type: ${r.headers['content-type'] || '(없음)'}`)
    console.log(`응답 미리보기:\n${r.body}`)
  }
} else {
  console.log('포트가 열려 있지 않아서 HTTP 요청은 보내지 않았습니다.')
}

console.log(`소요: ${Date.now() - start}ms`)
