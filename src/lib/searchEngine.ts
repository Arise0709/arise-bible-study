/**
 * Scripture search engine over the prebuilt word index (see scripts/build_search.mjs).
 *
 * Results are identical to the original scan-every-verse search: every query term is still the same
 * regular expression, tested against the same lower-cased verse text. The index only decides which
 * verses could possibly match:
 *   - A term made only of word characters (letters, digits, _, apostrophe, * wildcard) can only match
 *     inside a single word, so the word list answers it exactly, without reading any verse text.
 *   - Anything else (phrases, punctuation) narrows to verses containing every word fragment, then the
 *     original expression is checked against those verses' text.
 * Only the word files for the letters a search needs are fetched ("grace" needs the "g" file), and verse
 * text is fetched in small pages, only for verses to display or to check.
 */

export interface SearchQuery {
  query: string
  mode: 'all' | 'phrase' | 'any'
  scope: 'all' | 'OT' | 'NT' | string
  wholeWord: boolean
  limit: number
  /** Also match related word forms (believe, believed, believeth). Off unless the user asks. */
  forms?: boolean
}

export interface SearchOutput {
  hits: { key: string; text: string }[]
  total: number
  terms: string[]
  /** Word forms added when `forms` is on, per term. */
  formsUsed: string[][]
  /** A corrected query to offer when nothing was found. */
  suggestion?: string
}

export interface SearchLoader {
  /** Words starting with one character: "word deltas" lines. */
  shard(key: string): Promise<string>
  /** Every word with its verse count, for spelling suggestions. */
  vocab(): Promise<string>
  /** One page of verse text, one entry per slot (null where the translation has no such verse). */
  page(n: number): Promise<(string | null)[]>
}

/** Called once the matching verses are known, before their text is loaded. */
export type OnCount = (partial: { keys: string[]; total: number; terms: string[]; formsUsed: string[][] }) => void

export interface BookMeta {
  id: string
  testament: string
}

export const lowerForSearch = (t: string) => t.toLowerCase().replace(/[’']/g, "'")
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const WORDISH = /^[a-z0-9_'*]+$/

/** The original search expression for one term. */
export function termRegex(term: string, wholeWord: boolean): RegExp {
  const body = escapeRe(term).replace(/\\\*/g, '\\w*')
  return new RegExp(wholeWord ? `(?<![\\w'])${body}(?![\\w'])` : body, 'i')
}

/** Split a query into terms exactly as the original search did. */
export function splitTerms(query: string, mode: SearchQuery['mode']): { terms: string[]; phrase: boolean } {
  const q = lowerForSearch(query.trim())
  const quoted = /^"(.+)"$/.exec(q)
  if (quoted) return { terms: [quoted[1]], phrase: true }
  if (mode === 'phrase') return { terms: [q], phrase: true }
  return { terms: q.split(/\s+/).filter(Boolean), phrase: false }
}

/* ---------- light stemmer for the optional word-forms search ---------- */

const SUFFIXES = ['edst', 'eth', 'est', 'ing', 'ers', 'ed', 'es', 'er', "'s", "s'", 's'].sort((a, b) => b.length - a.length)
export function stem(w: string): string {
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) {
      w = w.slice(0, -s.length)
      break
    }
  }
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1)
  return w
}

/* ---------- spelling suggestions ---------- */

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let prev2: number[] = []
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1) // swapped letters
      cur.push(d)
      if (d < best) best = d
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/* ---------- the index ---------- */

export const shardOf = (w: string) => (/[a-z0-9]/.test(w[0]) ? w[0] : '_')

interface Shard {
  words: string[]
  lines: string[]
  decoded: Map<number, Int32Array>
}

export class SearchIndex {
  readonly slots: number
  readonly pageSize: number
  readonly shardKeys: string[]
  readonly books: { id: string; start: number; size: number; chapters: number[] }[] = []
  private shards = new Map<string, Shard>()
  private vocab: { words: string[]; counts: number[]; set: Set<string> } | null = null

  constructor(header: string) {
    const lines = header.split('\n')
    const head = /^#carter-search 2 \S+ (\d+) (\d+)$/.exec(lines[0])
    const shards = /^#shards (.*)$/.exec(lines[1] ?? '')
    if (!head || !shards) throw new Error('The search index file is not in the expected format.')
    this.slots = parseInt(head[1], 10)
    this.pageSize = parseInt(head[2], 10)
    this.shardKeys = shards[1].split(',').filter(Boolean)
    let slot = 0
    for (const line of lines.slice(2)) {
      if (!line.startsWith('@')) continue
      const [id, counts] = line.slice(1).split(' ')
      const chapters = counts.split(',').map(Number)
      const size = chapters.reduce((a, c) => a + c, 0)
      this.books.push({ id, start: slot, size, chapters })
      slot += size
    }
  }

  hasShard(k: string) {
    return this.shards.has(k)
  }
  addShard(k: string, text: string) {
    const words: string[] = []
    const lines: string[] = []
    for (const line of text.split('\n')) {
      if (!line) continue
      const sp = line.indexOf(' ')
      words.push(line.slice(0, sp))
      lines.push(line.slice(sp + 1))
    }
    this.shards.set(k, { words, lines, decoded: new Map() })
  }
  hasVocab() {
    return !!this.vocab
  }
  setVocab(text: string) {
    const words: string[] = []
    const counts: number[] = []
    for (const line of text.split('\n')) {
      if (!line) continue
      const sp = line.indexOf(' ')
      words.push(line.slice(0, sp))
      counts.push(parseInt(line.slice(sp + 1), 10))
    }
    this.vocab = { words, counts, set: new Set(words) }
  }

  /** Verse slots for every word in the given (loaded) shards that the expression matches. */
  matching(re: RegExp, keys: string[], extra?: (w: string) => boolean, used?: string[]): Int32Array[] {
    const out: Int32Array[] = []
    for (const k of keys) {
      const sh = this.shards.get(k)
      if (!sh) continue
      for (let i = 0; i < sh.words.length; i++) {
        const w = sh.words[i]
        const hit = re.test(w)
        if (hit || extra?.(w)) {
          out.push(this.postings(sh, i))
          if (!hit) used?.push(w)
        }
      }
    }
    return out
  }

  private postings(sh: Shard, wi: number): Int32Array {
    let p = sh.decoded.get(wi)
    if (!p) {
      const parts = sh.lines[wi].split(',')
      p = new Int32Array(parts.length)
      let prev = -1
      for (let k = 0; k < parts.length; k++) p[k] = prev += parseInt(parts[k], 36)
      sh.decoded.set(wi, p)
    }
    return p
  }

  bookOf(slot: number) {
    let lo = 0
    let hi = this.books.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.books[mid].start <= slot) lo = mid
      else hi = mid - 1
    }
    return this.books[lo]
  }

  keyOf(slot: number): string {
    const b = this.bookOf(slot)
    let s = slot - b.start
    for (let c = 0; c < b.chapters.length; c++) {
      if (s < b.chapters[c]) return `${b.id}.${c + 1}.${s + 1}`
      s -= b.chapters[c]
    }
    throw new Error('slot out of range')
  }

  knows(word: string) {
    return this.vocab?.set.has(word) ?? true
  }

  suggest(word: string): string | undefined {
    if (!this.vocab) return undefined
    const max = word.length <= 4 ? 1 : 2
    let best: { w: string; d: number; f: number } | undefined
    const { words, counts } = this.vocab
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      if (Math.abs(w.length - word.length) > max) continue
      const d = editDistance(word, w, max)
      if (d > max) continue
      if (!best || d < best.d || (d === best.d && counts[i] > best.f)) best = { w, d, f: counts[i] }
    }
    return best?.w
  }
}

/* ---------- the search ---------- */

type Bits = Uint8Array

export async function runSearch(idx: SearchIndex, load: SearchLoader, books: BookMeta[], q: SearchQuery, onCount?: OnCount): Promise<SearchOutput> {
  const { terms, phrase } = splitTerms(q.query, q.mode)
  const any = q.mode === 'any' && !phrase
  const N = idx.slots

  // scope as a slot filter
  const ot = new Set(books.filter((b) => b.testament === 'OT').map((b) => b.id))
  const inScope = (bookId: string) =>
    q.scope === 'all' ? true : q.scope === 'OT' ? ot.has(bookId) : q.scope === 'NT' ? !ot.has(bookId) : bookId === q.scope
  const scopeBits: Bits = new Uint8Array(N)
  for (const b of idx.books) if (inScope(b.id)) scopeBits.fill(1, b.start, b.start + b.size)

  // Plan each term: exact from the word list, or narrowed by word fragments and then checked against text.
  interface Part { re: RegExp; keys: string[] }
  type Plan = { kind: 'words'; part: Part; forms: string | null } | { kind: 'text'; parts: Part[]; re: RegExp }
  const keysFor = (body: string, anchoredStart: boolean) => (anchoredStart && !body.startsWith('\\w*') ? [shardOf(body.replace(/^\\/, ''))] : idx.shardKeys)
  const plans: Plan[] = terms.map((term) => {
    const body = escapeRe(term).replace(/\\\*/g, '\\w*')
    if (WORDISH.test(term) && !new RegExp(body).test('')) {
      const forms = q.forms && !phrase && !term.includes('*') && term.length >= 4 ? stem(term) : null
      return { kind: 'words', part: { re: new RegExp(q.wholeWord ? `^(?:${body})$` : body), keys: q.wholeWord ? keysFor(body, true) : idx.shardKeys }, forms }
    }
    // Each fragment between separators (spaces, punctuation) must be a word next to a separator. With whole
    // words on, the first and last fragments are whole words too; otherwise they may be word endings/beginnings.
    const frags = term.split(/[^a-z0-9_'*]+/)
    const parts: Part[] = []
    frags.forEach((frag, i) => {
      const fb = escapeRe(frag).replace(/\\\*/g, '\\w*')
      if (!frag || new RegExp(fb).test('')) return
      const start = i > 0 || q.wholeWord
      const end = i < frags.length - 1 || q.wholeWord
      if (!start) return // a word ending could be in any letter file; the text check below covers it
      parts.push({ re: new RegExp(`^(?:${fb})${end ? '$' : ''}`), keys: keysFor(fb, true) })
    })
    return { kind: 'text', parts, re: termRegex(term, q.wholeWord) }
  })

  // fetch the letter files needed
  const needed = new Set<string>()
  for (const p of plans) for (const part of p.kind === 'words' ? [p.part] : p.parts) for (const k of part.keys) if (!idx.hasShard(k)) needed.add(k)
  await Promise.all([...needed].filter((k) => idx.shardKeys.includes(k)).map(async (k) => idx.addShard(k, await load.shard(k))))

  const pages = new Map<number, Promise<(string | null)[]>>()
  const pageOf = (n: number) => {
    let p = pages.get(n)
    if (!p) pages.set(n, (p = load.page(n)))
    return p
  }
  const fill = (lists: Int32Array[]): Bits => {
    const bits: Bits = new Uint8Array(N)
    for (const l of lists) for (const s of l) bits[s] = 1
    return bits
  }

  const formsUsed: string[][] = []
  const termSets: Bits[] = []
  for (const plan of plans) {
    if (plan.kind === 'words') {
      const used: string[] = []
      const st = plan.forms
      const extra = st ? (w: string) => w.startsWith(st.slice(0, 3)) && stem(w) === st : undefined
      const bits = fill(idx.matching(plan.part.re, plan.part.keys, extra, used))
      for (let s = 0; s < N; s++) bits[s] &= scopeBits[s]
      formsUsed.push(used)
      termSets.push(bits)
      continue
    }
    formsUsed.push([])
    const cand: Bits = scopeBits.slice()
    for (const part of plan.parts) {
      const fb = fill(idx.matching(part.re, part.keys))
      for (let s = 0; s < N; s++) cand[s] &= fb[s]
    }
    // check the original expression against the text of the remaining verses, loading pages in parallel
    const want = new Set<number>()
    for (let s = 0; s < N; s++) if (cand[s]) want.add(Math.floor(s / idx.pageSize))
    const loaded = new Map<number, (string | null)[]>()
    await Promise.all([...want].map(async (n) => loaded.set(n, await pageOf(n))))
    const bits: Bits = new Uint8Array(N)
    for (let s = 0; s < N; s++) {
      if (!cand[s]) continue
      const v = loaded.get(Math.floor(s / idx.pageSize))![s % idx.pageSize]
      if (v && plan.re.test(lowerForSearch(v))) bits[s] = 1
    }
    termSets.push(bits)
  }

  // combine terms
  const result: Bits = new Uint8Array(N)
  if (termSets.length) {
    if (any) {
      for (const t of termSets) for (let s = 0; s < N; s++) result[s] |= t[s]
    } else {
      result.set(termSets[0])
      for (const t of termSets.slice(1)) for (let s = 0; s < N; s++) result[s] &= t[s]
    }
  }

  let total = 0
  const shown: number[] = []
  for (let s = 0; s < N; s++) {
    if (!result[s]) continue
    total++
    if (shown.length < q.limit) shown.push(s)
  }

  let suggestion: string | undefined
  if (total === 0) {
    if (!idx.hasVocab()) idx.setVocab(await load.vocab())
    let changed = false
    const fixed = q.query.replace(/[A-Za-z][A-Za-z’']*/g, (w) => {
      const lw = lowerForSearch(w)
      if (idx.knows(lw) || lw.length < 3) return w
      const sug = idx.suggest(lw)
      if (!sug) return w
      changed = true
      return sug
    })
    if (changed) suggestion = fixed
  }

  const keys = shown.map((s) => idx.keyOf(s))
  onCount?.({ keys, total, terms, formsUsed })
  const texts = await Promise.all(shown.map(async (s) => (await pageOf(Math.floor(s / idx.pageSize)))[s % idx.pageSize] ?? ''))
  const hits = shown.map((_, i) => ({ key: keys[i], text: texts[i] }))
  return { hits, total, terms, formsUsed, suggestion }
}
