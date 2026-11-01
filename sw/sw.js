/* Carter Study Bible service worker: offline reading.
 *
 * - The app itself (this version's files, listed at build time) is stored when the worker installs, in a
 *   cache named for this version. Old versions' caches are removed only when the new version takes over,
 *   so a phone always has one complete, matching set of app files and never mixes versions.
 * - Pages: network first (so you get the newest version online), the stored app when offline.
 * - Bible data (/data/...): served from storage when present and refreshed in the background, so chapters you
 *   have read or downloaded open offline. DATA_VERSION changes only if a data format changes.
 * - The AI assistant and error reports (/api/...) are never stored; they always need a connection.
 * - Notes, studies, sermons, and backups live in the browser database, which this worker never touches.
 */
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const APP = `csb-app-${VERSION}`
const DATA = 'csb-data-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP).then((c) => c.addAll(PRECACHE)))
  // the first install takes over right away; later updates wait until the user chooses to reload
  if (!self.registration.active) self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('csb-app-') && k !== APP) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  if (event.data === 'VERSION') event.source?.postMessage({ type: 'VERSION', version: VERSION })
})

const NAV_TIMEOUT = 4000

async function fromNetwork(request, cacheName) {
  const res = await fetch(request)
  if (res.ok && res.type === 'basic') {
    const copy = res.clone()
    caches.open(cacheName).then((c) => c.put(request, copy))
  }
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // always live

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), NAV_TIMEOUT))])
          if (res.ok) return res
          throw new Error(String(res.status))
        } catch {
          const app = await caches.open(APP)
          return (await app.match('/index.html', { ignoreVary: true })) || (await app.match('/', { ignoreVary: true })) || Response.error()
        }
      })(),
    )
    return
  }

  if (url.pathname.startsWith('/data/')) {
    // The offline packs list, and files a pack update asks for fresh (cache: 'reload'), come from the network
    // first, falling back to the stored copy when offline.
    if (url.pathname === '/data/packs.json' || req.cache === 'reload') {
      event.respondWith(fromNetwork(req, DATA).catch(async () => (await caches.match(req, { cacheName: DATA, ignoreVary: true })) || Response.error()))
      return
    }
    // stored copy first (works offline), refreshed in the background
    event.respondWith(
      (async () => {
        const cached = await caches.match(req, { cacheName: DATA, ignoreVary: true })
        const refresh = fromNetwork(req, DATA).catch(() => undefined)
        if (cached) {
          event.waitUntil(refresh)
          return cached
        }
        return (await refresh) || Response.error()
      })(),
    )
    return
  }

  // app files (hashed names never change) and icons: stored copy first
  event.respondWith(
    (async () => {
      // ignoreVary: a stored copy of our own file is the same whatever headers the request carried
      const cached = await caches.match(req, { ignoreVary: true })
      if (cached) return cached
      return fromNetwork(req, APP)
    })(),
  )
})
