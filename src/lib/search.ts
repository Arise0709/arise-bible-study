import type { SearchRequest } from './search.worker'

export interface SearchHit {
  key: string
  text: string
}
export interface SearchResult {
  hits: SearchHit[]
  total: number
  terms: string[]
  formsUsed: string[][]
  suggestion?: string
  /** true while the verse text is still loading (references and count are final) */
  partial?: boolean
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (r: SearchResult) => void; reject: (e: Error) => void; onPartial?: (r: SearchResult) => void }>()
let progressListener: ((done: number, total: number) => void) | null = null

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') progressListener?.(m.done, m.total)
      else if (m.type === 'partial') {
        pending.get(m.id)?.onPartial?.({ hits: m.keys.map((key: string) => ({ key, text: '' })), total: m.total, terms: m.terms, formsUsed: m.formsUsed, partial: true })
      }
      else if (m.type === 'result') {
        pending.get(m.id)?.resolve({ hits: m.hits, total: m.total, terms: m.terms, formsUsed: m.formsUsed ?? [], suggestion: m.suggestion })
        pending.delete(m.id)
      } else if (m.type === 'error') {
        pending.get(m.id)?.reject(new Error(m.message))
        pending.delete(m.id)
      }
    }
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('The search engine stopped unexpectedly. Reload the page to try again.'))
      pending.clear()
      worker = null
    }
  }
  return worker
}

export function onSearchProgress(fn: ((done: number, total: number) => void) | null) {
  progressListener = fn
}

/** Runs a search. `onPartial` gets the count and references first, before the verse text has loaded. */
export function searchBible(opts: Omit<SearchRequest, 'id'>, onPartial?: (r: SearchResult) => void): Promise<SearchResult> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onPartial })
    getWorker().postMessage({ ...opts, id })
  })
}
