/* 루빗 서버 구동기 PWA 서비스 워커
   - 내비게이션(페이지): 네트워크 우선, 끊기면 캐시된 셸
   - 해시가 붙은 정적 자산: 캐시 우선
   - /api/* 는 절대 캐시하지 않습니다 (실시간 로그·명령이므로) */

const VERSION = 'lubit-shell-v2'
const SHELL = ['/', '/console', '/manifest.json', '/favicon.svg', '/logo-mark.png', '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(VERSION).then((cache) => cache.put('/console', copy))
          return response
        })
        .catch(async () => (await caches.match('/console')) ?? Response.error()),
    )
    return
  }

  // 해시가 붙은 번들(/assets/)만 캐시 우선으로 씁니다. 캐시 이름이 붙지 않은
  // 파일 — /download/manifest.json 과 설치 파일 조각, 로고 — 은 항상 새 것으로
  // 받아야 업데이트가 반영됩니다. 여기에 넣으면 옛 목록이 영구히 남습니다.
  if (!url.pathname.startsWith('/assets/')) return

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(VERSION).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
