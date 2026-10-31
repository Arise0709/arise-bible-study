/**
 * Offline reading: service worker registration, safe updates, and downloading Bibles to this device.
 * Downloaded files go into the same storage the service worker reads from (cache "csb-data-v1").
 * Nothing here touches notes, studies, sermons, or backups (they live in the browser database).
 */
import books from './books.json'

const DATA_CACHE = 'csb-data-v1'
const MARK = 'abs-offline:'

/* ---------------- service worker and updates ---------------- */

type Listener = () => void
const listeners = new Set<Listener>()
let updateReady = false
let updatedElsewhere = false
let reg: ServiceWorkerRegistration | undefined
let reloading = false

export const offlineSupported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof caches !== 'undefined'

export function onUpdateState(fn: Listener) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
export const updateState = () => ({ updateReady, updatedElsewhere })
const notify = () => listeners.forEach((f) => f())

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !offlineSupported()) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return location.reload()
    // a new version took over from another tab; this page is still the old one
    if (hadController) {
      updatedElsewhere = true
      notify()
    }
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((r) => {
        reg = r
        const watch = (w: ServiceWorker | null) =>
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              updateReady = true
              notify()
            }
          })
        if (r.waiting && navigator.serviceWorker.controller) {
          updateReady = true
          notify()
        }
        watch(r.installing)
        r.addEventListener('updatefound', () => watch(r.installing))
        // look for a new version now and then while the app stays open
        setInterval(() => r.update().catch(() => {}), 60 * 60 * 1000)
      })
      .catch(() => {})
  })
}

/** Switch to the new version: the page reloads once it has taken over. Unsaved edits are saved first (autosave). */
export function applyUpdate() {
  reloading = true
  if (reg?.waiting) reg.waiting.postMessage('SKIP_WAITING')
  else location.reload()
}

/* ---------------- downloading Bibles ---------------- */

export interface OfflineBible {
  id: string
  label: string
  approxMB: number
}

async function kjvUrls(): Promise<string[]> {
  const idx = (await (await fetch('/data/kjv/index.json')).json()) as { id: string; chapters: number[] }[]
  return ['/data/kjv/index.json', ...idx.flatMap((b) => b.chapters.map((_, i) => `/data/kjv/${b.id}/${i + 1}.json`))]
}
const translationUrls = (id: string) => ['/data/translations/index.json', ...(books as { id: string }[]).map((b) => `/data/translations/${id}/${b.id}.json`)]

export function isDownloaded(id: string): number | null {
  try {
    const v = localStorage.getItem(MARK + id)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

/** Confirms a downloaded Bible is still stored (browsers can clear storage). */
export async function verifyDownloaded(id: string): Promise<boolean> {
  if (!isDownloaded(id) || !offlineSupported()) return false
  const probe = id === 'KJV' ? '/data/kjv/Rev/22.json' : `/data/translations/${id}/Rev.json`
  const ok = !!(await caches.match(probe, { cacheName: DATA_CACHE, ignoreVary: true }))
  if (!ok) localStorage.removeItem(MARK + id)
  return ok
}

/**
 * Stores every chapter of a Bible on this device. The KJV is always included, because the reader uses it
 * for verse layout and Hebrew/Greek word links in every translation.
 */
export async function downloadBible(id: string, onProgress: (done: number, total: number) => void): Promise<void> {
  const urls = [...(await kjvUrls()), ...(id === 'KJV' ? [] : translationUrls(id))]
  const cache = await caches.open(DATA_CACHE)
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]
      if (!(await cache.match(url, { ignoreVary: true }))) {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Could not download ${url} (status ${res.status}).`)
        await cache.put(url, res)
      }
      onProgress(++done, urls.length)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  localStorage.setItem(MARK + 'KJV', String(Date.now()))
  if (id !== 'KJV') localStorage.setItem(MARK + id, String(Date.now()))
}

/** Removes a downloaded translation (the KJV stays while any other translation is downloaded). */
export async function removeBible(id: string): Promise<void> {
  const cache = await caches.open(DATA_CACHE)
  const urls = id === 'KJV' ? await kjvUrls() : translationUrls(id).slice(1)
  await Promise.all(urls.map((u) => cache.delete(u)))
  localStorage.removeItem(MARK + id)
}
