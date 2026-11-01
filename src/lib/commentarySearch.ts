/**
 * Search across every installed commentary (index built by scripts/build_commentary_search.mjs).
 *
 * The index says which notes contain each word. Only the index pieces (shards) holding the query's words
 * are downloaded. Results and exact-phrase checks read the same chapter files the commentary panel shows,
 * so wording and citations always come from the source files. Results are in Bible order, then commentary
 * order, so the same search always gives the same list.
 */
import { BOOKS } from './refs'
import { loadCommentaryChapter } from './data'

interface Meta {
  format: string
  version: number
  docs: number
  works: string[]
  books: string[]
  groups: [number, number, number, number][] // work index, book index, chapter, number of notes
  shards: string[] // first word of each shard
  common: string[]
  /** "a_b" pair entries exist for every pair of these words (each in more than pairDf notes) */
  pairDf: number
  frequent: string[]
}

/** Same splitting as the index builder (tests keep the two identical). */
export function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
}
const fold = (t: string) => t.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[’‘]/g, "'")
export function tokens(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
}

let metaP: Promise<Meta> | null = null
let starts: number[] = []
function meta(): Promise<Meta> {
  if (!metaP) {
    metaP = fetch('/data/commentary/search/meta.json')
      .then((r) => {
        if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) throw new Error('The commentary search index is missing from this deployment.')
        return r.json() as Promise<Meta>
      })
      .then((m) => {
        if (m.format !== 'carter-commentary-search' || m.version !== 1) throw new Error('The commentary search index is in an unknown format.')
        let s = 0
        starts = m.groups.map((g) => ((s += g[3]), s - g[3]))
        return m
      })
      .catch((e) => {
        metaP = null
        throw e instanceof TypeError ? new Error('Could not load the commentary search index. Check your connection and try again.') : e
      })
  }
  return metaP
}

const shardCache = new Map<number, Promise<Map<string, string>>>()
function shard(n: number): Promise<Map<string, string>> {
  if (!shardCache.has(n)) {
    shardCache.set(
      n,
      fetch(`/data/commentary/search/w/${n}.txt`)
        .then((r) => {
          if (!r.ok) throw new Error('Part of the commentary search index could not be loaded.')
          return r.text()
        })
        .then((t) => {
          const m = new Map<string, string>()
          for (const line of t.split('\n')) {
            const i = line.indexOf(' ')
            if (i > 0) m.set(line.slice(0, i), line.slice(i + 1))
          }
          return m
        })
        .catch((e) => {
          shardCache.delete(n)
          throw e instanceof TypeError ? new Error('Could not load the commentary search index. Check your connection and try again.') : e
        }),
    )
  }
  return shardCache.get(n)!
}

/** The shard whose word range holds `w` (shards are in plain string order, as the builder sorts them). */
function shardOf(m: Meta, w: string): number {
  let lo = 0
  let hi = m.shards.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (m.shards[mid] <= w) lo = mid
    else hi = mid - 1
  }
  return lo
}

const decode = (s: string): number[] => {
  const out: number[] = []
  let prev = -1
  for (const part of s.split(',')) out.push((prev = prev + 1 + parseInt(part, 36)))
  return out
}

/** Notes containing a word, or any word starting with it when it ends in *. */
async function postings(m: Meta, term: string): Promise<number[]> {
  if (term.endsWith('*')) {
    const p = term.slice(0, -1)
    const first = shardOf(m, p)
    let last = first
    while (last + 1 < m.shards.length && m.shards[last + 1].startsWith(p)) last++
    const set = new Set<number>()
    for (let n = first; n <= last; n++) for (const [w, ids] of await shard(n)) if (w.startsWith(p) && !w.includes('_')) for (const id of decode(ids)) set.add(id)
    return [...set].sort((a, b) => a - b)
  }
  const ids = (await shard(shardOf(m, term))).get(term)
  return ids ? decode(ids) : []
}

function intersect(a: number[], b: number[]): number[] {
  const out: number[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) (out.push(a[i]), i++, j++)
    else if (a[i] < b[j]) i++
    else j++
  }
  return out
}

/* ---------------- query ---------------- */

export interface CommentaryQuery {
  query: string
  mode: 'all' | 'phrase' | 'any'
  works: string[] // empty = every commentary
  scope: 'all' | 'OT' | 'NT' | string // or a book id
}

export interface CommentaryHit {
  doc: number
  work: string
  book: string
  chapter: number
  v1: number
  v2: number
  /** plain text around the first match, with the matched words marked as [start, end) ranges */
  snippet: string
  marks: [number, number][]
}

export interface CommentaryResults {
  terms: string[]
  /** notes that contain every word (all / any: these are the results; phrase: these are checked one by one) */
  candidates: number
  /** exact total when known; for phrases, known once every candidate has been checked */
  total: number | null
  hits: CommentaryHit[]
  done: boolean
  /** load more results (checks more candidates for phrases) */
  more: (n: number, onHits?: OnHits) => Promise<CommentaryResults>
}

/** Split a query into index words, keeping a trailing * for word beginnings. */
export function queryTerms(q: string): string[] {
  const out: string[] = []
  for (const piece of q.replace(/["“”]/g, ' ').split(/\s+/)) {
    const star = /\*$/.test(piece)
    const t = tokens(piece)
    t.forEach((x, i) => out.push(star && i === t.length - 1 ? x + '*' : x))
  }
  return out
}

const OT = new Set(BOOKS.filter((b) => b.testament === 'OT').map((b) => b.id))

function groupOf(doc: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= doc) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Where the phrase's words occur in order in the text; empty when they don't. */
function phraseAt(text: string, phrase: string[]): boolean {
  const t = tokens(text)
  outer: for (let i = 0; i + phrase.length <= t.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      const p = phrase[j]
      if (p.endsWith('*') ? !t[i + j].startsWith(p.slice(0, -1)) : t[i + j] !== p) continue outer
    }
    return true
  }
  return false
}

/** Plain-text snippet around the first match, with ranges for highlighting. */
export function makeSnippet(text: string, terms: string[], phrase: boolean): { snippet: string; marks: [number, number][] } {
  // map each folded character back to the original text
  const map: number[] = []
  let folded = ''
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i])
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
  }
  const words = [...folded.matchAll(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)].map((m) => ({ w: m[0], s: m.index!, e: m.index! + m[0].length }))
  const match = (w: string, t: string) => (t.endsWith('*') ? w.startsWith(t.slice(0, -1)) : w === t)
  const hitWords: { s: number; e: number }[] = []
  if (phrase) {
    for (let i = 0; i + terms.length <= words.length; i++)
      if (terms.every((t, j) => match(words[i + j].w, t))) {
        hitWords.push({ s: words[i].s, e: words[i + terms.length - 1].e })
        break
      }
  } else for (const w of words) if (terms.some((t) => match(w.w, t))) hitWords.push(w)
  const orig = (fi: number) => (fi >= map.length ? text.length : map[fi])
  const first = hitWords[0] ? orig(hitWords[0].s) : 0
  const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, first - 90)) + 1)
  const to = Math.min(text.length, from + 260)
  const raw = text.slice(from, to)
  const lead = from > 0 ? '… ' : ''
  const snippet = (lead + raw + (to < text.length ? ' …' : '')).replace(/\s+/g, ' ')
  // recompute marks on the collapsed snippet by searching for each matched original word
  const marks: [number, number][] = []
  let cursor = 0
  for (const h of hitWords) {
    const word = text.slice(orig(h.s), orig(h.e - 1) + 1).replace(/\s+/g, ' ')
    const at = snippet.indexOf(word, cursor)
    if (at >= 0) {
      marks.push([at, at + word.length])
      cursor = at + word.length
    }
  }
  return { snippet, marks }
}

async function noteText(m: Meta, doc: number): Promise<{ g: [number, number, number, number]; e: [number, number, string] } | null> {
  const gi = groupOf(doc)
  const g = m.groups[gi]
  const ch = await loadCommentaryChapter(m.works[g[0]], m.books[g[1]], g[2])
  const e = ch.e[doc - starts[gi]]
  return e ? { g, e } : null
}

/** Called with results as they are found (phrase searches check notes in batches). */
export type OnHits = (r: CommentaryResults) => void

export async function searchCommentaries(q: CommentaryQuery, first = 20, onHits?: OnHits): Promise<CommentaryResults> {
  const m = await meta()
  const terms = queryTerms(q.query)
  const phrase = q.mode === 'phrase' && terms.length > 1
  if (!terms.length) return { terms, candidates: 0, total: 0, hits: [], done: true, more: async (): Promise<CommentaryResults> => searchCommentaries(q, first) }
  // which notes could match
  let ids: number[]
  if (q.mode === 'any') {
    const set = new Set<number>()
    for (const t of terms) for (const id of await postings(m, t)) set.add(id)
    ids = [...set].sort((a, b) => a - b)
  } else {
    // for a phrase, very common words ("the", "of") are skipped while narrowing when rarer words exist; the text check covers them
    const common = new Set(m.common)
    const narrowing = phrase && terms.some((t) => !common.has(t)) ? terms.filter((t) => !common.has(t)) : terms
    const keys = [...new Set(narrowing)]
    if (phrase) {
      // adjacent frequent words: the pair entry lists exactly the notes where one follows the other
      const freq = new Set(m.frequent)
      for (let i = 0; i + 1 < terms.length; i++) if (freq.has(terms[i]) && freq.has(terms[i + 1])) keys.push(`${terms[i]}_${terms[i + 1]}`)
    }
    const lists = await Promise.all(keys.map((t) => postings(m, t)))
    lists.sort((a, b) => a.length - b.length)
    ids = lists.reduce((acc, l) => intersect(acc, l))
  }
  // filters
  const workSet = q.works.length ? new Set(q.works.map((w) => m.works.indexOf(w))) : null
  const inScope = (book: string) => q.scope === 'all' || (q.scope === 'OT' ? OT.has(book) : q.scope === 'NT' ? !OT.has(book) : book === q.scope)
  const bookOrder = new Map(BOOKS.map((b, i) => [b.id, i]))
  const workOrder = (wi: number) => wi
  const cands = ids
    .map((doc) => ({ doc, g: m.groups[groupOf(doc)] }))
    .filter(({ g }) => (!workSet || workSet.has(g[0])) && inScope(m.books[g[1]]))
    .sort((a, b) => (bookOrder.get(m.books[a.g[1]])! - bookOrder.get(m.books[b.g[1]])!) || a.g[2] - b.g[2] || workOrder(a.g[0]) - workOrder(b.g[0]) || a.doc - b.doc)

  const hits: CommentaryHit[] = []
  let checked = 0
  const build = async (doc: number): Promise<CommentaryHit | null> => {
    const n = await noteText(m, doc)
    if (!n) return null
    const text = plain(n.e[2])
    if (phrase && !phraseAt(text, terms)) return null
    const { snippet, marks } = makeSnippet(text, phrase ? terms : terms, phrase)
    return { doc, work: m.works[n.g[0]], book: m.books[n.g[1]], chapter: n.g[2], v1: n.e[0], v2: n.e[1], snippet, marks }
  }
  const fill = async (want: number) => {
    // check candidates in small parallel batches until enough results are found
    while (hits.length < want && checked < cands.length) {
      const batch = cands.slice(checked, checked + 12)
      checked += batch.length
      for (const h of await Promise.all(batch.map((c) => build(c.doc)))) if (h) hits.push(h)
      if (onHits && hits.length < want && checked < cands.length) onHits(snapshot())
    }
  }
  const snapshot = (): CommentaryResults => ({
    terms,
    candidates: cands.length,
    total: !phrase ? cands.length : checked >= cands.length ? hits.length : null,
    hits: hits.slice(),
    done: checked >= cands.length,
    more: async (n: number, cb?: OnHits) => {
      const prev = onHits
      if (cb) onHits = cb
      await fill(hits.length + n)
      onHits = prev
      return snapshot()
    },
  })
  await fill(first)
  return snapshot()
}
