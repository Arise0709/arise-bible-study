/**
 * Offline research packs: commentaries, Hebrew and Greek text, lexicons, the reference library, and the
 * commentary search index, downloaded only when the reader asks (see scripts/build_packs.mjs).
 *
 * Files go into the same storage the service worker reads from, so the app finds them with no connection.
 * Your notes, studies, sermons, plans, and courses are in the browser database and are never touched here.
 * A download that stops part way keeps what it saved; trying again picks up where it left off.
 */
import { offlineSupported } from './offline'
import { parseOsis } from './refs'

const DATA_CACHE = 'csb-data-v1'
const MARK = 'abs-pack:'

export interface Pack {
  id: string
  kind: 'commentary' | 'original' | 'lexicon' | 'reference' | 'search' | 'custom'
  label: string
  description: string
  bytes: number
  hash: string
  files: string[]
}

export type PackState = { state: 'none' } | { state: 'partial'; at: number } | { state: 'ready'; at: number } | { state: 'update'; at: number }

interface Mark {
  hash: string
  at: number
  complete: boolean
  files?: string[] // for packs made on this device (plan or course passages)
}

let manifest: Promise<Pack[]> | null = null
export function loadPacks(): Promise<Pack[]> {
  if (!manifest)
    manifest = fetch('/data/packs.json')
      .then((r) => {
        if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error('The list of offline packs is missing from this deployment.')
        return r.json()
      })
      .then((j: { format: string; packs: Pack[] }) => j.packs)
      .catch((e) => {
        manifest = null
        throw e instanceof TypeError ? new Error('Could not load the list of offline packs. Check your connection.') : e
      })
  return manifest
}

function readMark(id: string): Mark | null {
  try {
    return JSON.parse(localStorage.getItem(MARK + id) ?? 'null')
  } catch {
    return null
  }
}
function writeMark(id: string, m: Mark | null) {
  try {
    if (m) localStorage.setItem(MARK + id, JSON.stringify(m))
    else localStorage.removeItem(MARK + id)
  } catch {
    /* storage blocked: the files are still stored */
  }
}

export function downloadedPackIds(): string[] {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(MARK))
      .map((k) => k.slice(MARK.length))
  } catch {
    return []
  }
}

/** Current state of a pack on this device (checks one file is really still stored; browsers can clear storage). */
export async function packState(p: Pack): Promise<PackState> {
  const m = readMark(p.id)
  if (!m) return { state: 'none' }
  if (!m.complete) return { state: 'partial', at: m.at }
  if (offlineSupported() && p.files.length) {
    const probe = `/data/${p.files[p.files.length - 1]}`
    if (!(await caches.match(probe, { cacheName: DATA_CACHE, ignoreVary: true }))) {
      writeMark(p.id, { ...m, complete: false })
      return { state: 'partial', at: m.at }
    }
  }
  return m.hash === p.hash ? { state: 'ready', at: m.at } : { state: 'update', at: m.at }
}

export class StorageFullError extends Error {}

export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e && e.quota ? { usage: e.usage ?? 0, quota: e.quota } : null
  } catch {
    return null
  }
}

export const formatBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.max(0.1, n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/**
 * Store a pack's files. Files already stored are skipped (so a stopped download resumes); for an update,
 * every file is fetched fresh. Checks the free space first and stops cleanly if storage runs out.
 */
export async function downloadPack(p: Pack, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  if (!offlineSupported()) throw new Error('This browser cannot store files for offline use.')
  const prev = readMark(p.id)
  const update = !!prev && prev.complete && prev.hash !== p.hash
  const info = await storageInfo()
  if (info && info.quota - info.usage < p.bytes * 1.1) {
    throw new StorageFullError(`There is not enough storage for this pack (it needs about ${formatBytes(p.bytes)}; about ${formatBytes(Math.max(0, info.quota - info.usage))} is free). Remove other downloads, or free space on this device, then try again.`)
  }
  writeMark(p.id, { hash: p.hash, at: Date.now(), complete: false, files: p.kind === 'custom' ? p.files : undefined })
  const cache = await caches.open(DATA_CACHE)
  const urls = p.files.map((f) => `/data/${f}`)
  let done = 0
  let next = 0
  let failure: unknown = null
  const worker = async () => {
    while (next < urls.length && !failure) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
      const url = urls[next++]
      try {
        if (update || !(await cache.match(url, { ignoreVary: true }))) {
          const res = await fetch(url, { cache: update ? 'reload' : 'default', signal })
          if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) throw new Error(`A file in this pack is missing from the server (${url}).`)
          await cache.put(url, res)
        }
      } catch (e) {
        failure = e
        throw e
      }
      onProgress(++done, urls.length)
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(6, urls.length || 1) }, worker))
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new StorageFullError('Storage ran out during the download. What was saved is kept. Remove other downloads, then try again.')
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    if (e instanceof TypeError) throw new Error('The download stopped (the connection dropped). What was saved is kept; try again to continue.')
    throw e
  }
  writeMark(p.id, { hash: p.hash, at: Date.now(), complete: true, files: p.kind === 'custom' ? p.files : undefined })
}

/** Remove a pack's files, keeping any file another downloaded pack still needs. */
export async function removePack(p: Pack, all: Pack[]) {
  const others = new Set<string>()
  for (const id of downloadedPackIds()) {
    if (id === p.id) continue
    const o = all.find((x) => x.id === id) ?? (readMark(id)?.files ? { files: readMark(id)!.files! } : null)
    o?.files.forEach((f) => others.add(f))
  }
  if (offlineSupported()) {
    const cache = await caches.open(DATA_CACHE)
    await Promise.all(p.files.filter((f) => !others.has(f)).map((f) => cache.delete(`/data/${f}`)))
  }
  writeMark(p.id, null)
}

/* ---------------- packs made on this device: the passages a plan or course uses ---------------- */

/** The Bible chapter files for a set of passages (KJV, plus a translation when chosen). */
export function passageFiles(osisRefs: string[], translation?: string): string[] {
  const files = new Set<string>(['kjv/index.json'])
  for (const o of osisRefs) {
    const r = parseOsis(o)
    if (!r) continue
    for (let c = r.chapter; c <= (r.endChapter ?? r.chapter); c++) files.add(`kjv/${r.book}/${c}.json`)
    if (translation && translation !== 'KJV') {
      files.add('translations/index.json')
      files.add(`translations/${translation}/${r.book}.json`)
    }
  }
  return [...files].sort()
}

export function customPack(id: string, label: string, files: string[]): Pack {
  // the fingerprint is the file list: when a plan or course changes its passages, an update is offered
  let h = 2166136261
  for (const ch of files.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return { id, kind: 'custom', label, description: '', bytes: files.length * 25_000, hash: (h >>> 0).toString(16), files }
}

/** Content that always needs a connection, listed so nobody is surprised offline. */
export const NEEDS_INTERNET = ['The AI study assistant', 'Video lessons (they open on the video site)', 'Adding a course from a file shared by link', 'Checking for app updates']
