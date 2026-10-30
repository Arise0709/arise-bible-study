/// <reference lib="webworker" />
/* Full-text search over the KJV. Loads every book once, then answers word and phrase queries. */
import books from './books.json'

interface Row {
  key: string
  book: string
  text: string
  lower: string
}

let rows: Row[] | null = null
let loading: Promise<Row[]> | null = null

function segText(s: [string, number?, number?]) {
  return (s[1] ?? 0) & 4 ? s[0].toUpperCase() : s[0]
}

async function load(): Promise<Row[]> {
  if (rows) return rows
  if (!loading) {
    loading = (async () => {
      const out: Row[] = []
      let done = 0
      const results = await Promise.all(
        (books as { id: string }[]).map(async (b) => {
          const r = await fetch(`/data/kjv/${b.id}.json`)
          if (!r.ok) throw new Error(`Could not load ${b.id} for searching (status ${r.status}).`)
          const j = await r.json()
          done++
          ;(self as unknown as Worker).postMessage({ type: 'progress', done, total: books.length })
          return j
        }),
      )
      for (const book of results) {
        for (const ch of book.chapters) {
          for (const v of ch.verses) {
            const text = v.s.map(segText).join('')
            out.push({ key: `${book.id}.${ch.c}.${v.v}`, book: book.id, text, lower: text.toLowerCase().replace(/[’']/g, "'") })
          }
        }
      }
      rows = out
      return out
    })()
  }
  return loading
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface SearchRequest {
  id: number
  query: string
  mode: 'all' | 'phrase' | 'any'
  scope: 'all' | 'OT' | 'NT' | string
  wholeWord: boolean
  limit: number
}

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const { id, query, mode, scope, wholeWord, limit } = e.data
  try {
    const data = await load()
    const q = query.trim().toLowerCase().replace(/[’']/g, "'")
    let phrase = mode === 'phrase'
    let terms: string[]
    const quoted = /^"(.+)"$/.exec(q)
    if (quoted) {
      phrase = true
      terms = [quoted[1]]
    } else {
      terms = phrase ? [q] : q.split(/\s+/).filter(Boolean)
    }
    const res = terms.map((t) => {
      const body = escapeRe(t).replace(/\\\*/g, '\\w*') // allow trailing * as wildcard
      return new RegExp(wholeWord ? `(?<![\\w'])${body}(?![\\w'])` : body, 'i')
    })
    const ot = new Set((books as { id: string; testament: string }[]).filter((b) => b.testament === 'OT').map((b) => b.id))
    const hits: { key: string; text: string }[] = []
    let total = 0
    for (const r of data) {
      if (scope === 'OT' && !ot.has(r.book)) continue
      if (scope === 'NT' && ot.has(r.book)) continue
      if (scope !== 'all' && scope !== 'OT' && scope !== 'NT' && r.book !== scope) continue
      const ok = mode === 'any' && !phrase ? res.some((re) => re.test(r.lower)) : res.every((re) => re.test(r.lower))
      if (ok) {
        total++
        if (hits.length < limit) hits.push({ key: r.key, text: r.text })
      }
    }
    ;(self as unknown as Worker).postMessage({ type: 'result', id, hits, total, terms })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ type: 'error', id, message: (err as Error).message })
  }
}
