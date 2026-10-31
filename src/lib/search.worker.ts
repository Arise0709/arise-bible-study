/// <reference lib="webworker" />
/* Scripture search in a background thread. Fetches only the parts of a translation's word index that a
   search needs, then the small pages of verse text for the results. Everything loaded stays in memory. */
import books from './books.json'
import { SearchIndex, runSearch, type SearchLoader, type SearchQuery } from './searchEngine'

export interface SearchRequest extends SearchQuery {
  id: number
  /** 'KJV' or a translation id from translations/index.json */
  translation?: string
}

const post = (m: unknown) => (self as unknown as Worker).postMessage(m)

async function get(url: string, what: string): Promise<Response> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not load ${what} for searching (status ${r.status}).`)
  return r
}

const indexes = new Map<string, Promise<SearchIndex>>()
function loadIndex(t: string): Promise<SearchIndex> {
  let p = indexes.get(t)
  if (!p) {
    p = get(`/data/search/${t}/index.txt`, `the ${t} search index`)
      .then((r) => r.text())
      .then((text) => new SearchIndex(text))
    p.catch(() => indexes.delete(t))
    indexes.set(t, p)
  }
  return p
}

// Files are cached here for the session and by the browser's HTTP cache across visits.
const files = new Map<string, Promise<string>>()
function text(url: string, what: string): Promise<string> {
  let p = files.get(url)
  if (!p) {
    p = get(url, what).then((r) => r.text())
    p.catch(() => files.delete(url))
    files.set(url, p)
  }
  return p
}

function loader(t: string): SearchLoader {
  const base = `/data/search/${t}`
  return {
    shard: (k) => text(`${base}/w/${k}.txt`, 'the search index'),
    vocab: () => text(`${base}/vocab.txt`, 'the word list'),
    page: async (n) => (await text(`${base}/p/${n}.txt`, 'verse text')).replace(/\n$/, '').split('\n').map((l) => l || null),
  }
}

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const { id, translation = 'KJV', ...q } = e.data
  try {
    const t = /^[A-Za-z0-9]+$/.test(translation) ? translation : 'KJV'
    post({ type: 'progress', done: 0, total: 1 })
    const idx = await loadIndex(t)
    const out = await runSearch(idx, loader(t), books as { id: string; testament: string }[], q, (partial) => {
      post({ type: 'progress', done: 1, total: 1 })
      post({ type: 'partial', id, ...partial })
    })
    post({ type: 'result', id, ...out })
  } catch (err) {
    post({ type: 'error', id, message: (err as Error).message })
  }
}
