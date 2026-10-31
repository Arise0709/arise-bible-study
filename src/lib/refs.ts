import booksJson from './books.json'

export interface BookInfo {
  id: string
  name: string
  abbr: string[]
  testament: 'OT' | 'NT'
}

export const BOOKS: BookInfo[] = booksJson as BookInfo[]
export const BOOK_BY_ID: Record<string, BookInfo> = Object.fromEntries(BOOKS.map((b) => [b.id, b]))
export const BOOK_INDEX: Record<string, number> = Object.fromEntries(BOOKS.map((b, i) => [b.id, i]))

/** A verse or a range. Missing verse means the whole chapter. */
export interface Ref {
  book: string
  chapter: number
  verse?: number
  endChapter?: number
  endVerse?: number
}

const ALIASES: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const b of BOOKS) {
    m.set(norm(b.id), b.id)
    m.set(norm(b.name), b.id)
    for (const a of b.abbr) m.set(norm(a), b.id)
  }
  // a few spoken forms
  m.set('psalm', 'Ps')
  m.set('songofsongs', 'Song')
  m.set('revelations', 'Rev')
  return m
})()

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(iii|3rd|third)\s*/, '3')
    .replace(/^(ii|2nd|second)\s*/, '2')
    .replace(/^(i|1st|first)\s+/, '1')
    .replace(/[^a-z0-9]/g, '')
}

export function resolveBook(name: string): string | undefined {
  const n = norm(name)
  if (ALIASES.has(n)) return ALIASES.get(n)
  // unique prefix match on full names, e.g. "Deuter", "Phile"
  if (n.length >= 3) {
    const hits = BOOKS.filter((b) => norm(b.name).startsWith(n))
    if (hits.length === 1) return hits[0].id
  }
  return undefined
}

const REF_RE =
  /^\s*((?:[1-3]|i{1,3}|1st|2nd|3rd|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d+)(?:\s*[:.]\s*(\d+)|\s+(\d+))?(?:\s*[-–—]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?\s*$/i

/** Books with a single chapter. In these, "Jude 3" means verse 3 (chapter 1), as in printed Bibles. */
export const SINGLE_CHAPTER_BOOKS = new Set(['Obad', 'Phlm', '2John', '3John', 'Jude'])

/**
 * Parse "John 3:16", "Jn 3:16-18", "1 Cor 13", "Gen 1:1-2:3", "Ps 23", "Phil 4 13", "Jude 3".
 * Returns undefined if not a reference.
 */
export function parseRef(input: string): Ref | undefined {
  const m = REF_RE.exec(input)
  if (!m) return undefined
  const book = resolveBook(m[1])
  if (!book) return undefined
  const first = parseInt(m[2], 10)
  const verse = m[3] ?? m[4]
  const ref: Ref = { book, chapter: first }
  if (verse) ref.verse = parseInt(verse, 10)
  else if (SINGLE_CHAPTER_BOOKS.has(book) && (first !== 1 || m[5])) {
    // "Jude 3", "Jude 3-5", "Jude 1-4": the numbers are verses in chapter 1. A bare "Jude 1" is the whole book.
    if (m[6]) return undefined // "Jude 3-1:4" is not meaningful
    ref.chapter = 1
    ref.verse = first
    if (m[5]) ref.endVerse = parseInt(m[5], 10)
    return ref
  }
  if (m[5]) {
    if (m[6]) {
      ref.endChapter = parseInt(m[5], 10)
      ref.endVerse = parseInt(m[6], 10)
    } else if (ref.verse !== undefined) {
      ref.endVerse = parseInt(m[5], 10)
    } else {
      ref.endChapter = parseInt(m[5], 10)
    }
  }
  return ref
}

/**
 * Parse a list such as "John 3:16,18", "Rom 8:28-30, 38-39", "Gen 1:1; 2:7", "John 3:16; Rom 5:8".
 * Later parts without a book continue from the previous book and chapter.
 * Returns undefined unless every part is a reference.
 */
export function parseRefList(input: string): Ref[] | undefined {
  const parts = input.split(/[,;]/).map((p) => p.trim())
  if (parts.length < 2 || parts.some((p) => !p)) return undefined
  const first = parseRef(parts[0])
  if (!first) return undefined
  const out: Ref[] = [first]
  let prev = first
  for (const p of parts.slice(1)) {
    let r = parseRef(p)
    if (!r) {
      const cv = /^(\d+)\s*[:.]\s*(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(p)
      const v = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(p)
      if (cv) r = { book: prev.book, chapter: +cv[1], verse: +cv[2], ...(cv[3] ? { endVerse: +cv[3] } : {}) }
      else if (v && prev.verse !== undefined) {
        const c = prev.endChapter ?? prev.chapter
        r = { book: prev.book, chapter: c, verse: +v[1], ...(v[2] ? { endVerse: +v[2] } : {}) }
      } else if (v) r = { book: prev.book, chapter: +v[1], ...(v[2] ? { endChapter: +v[2] } : {}) }
      else return undefined
    }
    out.push(r)
    prev = r
  }
  return out
}

/** Closest book name for a misspelled one ("Jhon" -> John), for "Did you mean" hints. */
export function suggestBook(name: string): string | undefined {
  const n = norm(name)
  if (n.length < 3) return undefined
  let best: { id: string; d: number } | undefined
  for (const b of BOOKS) {
    for (const cand of [b.name, ...b.abbr.filter((a) => a.length >= 3)]) {
      const c = norm(cand)
      const raw = lev(n, c)
      if (raw > (c.length <= 4 ? 1 : 2)) continue
      const d = raw + (cand === b.name ? 0 : 0.5) // on a tie, a full book name beats an abbreviation
      if (!best || d < best.d) best = { id: b.id, d }
    }
  }
  return best?.id
}

/** Edit distance where swapping two neighboring letters ("Jhon") counts as one typo. */
function lev(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** If `input` looks like a reference with a misspelled book, return the corrected text. */
export function suggestRefText(input: string): string | undefined {
  const m = /^\s*((?:[1-3]\s*)?[a-z][a-z .]*?)\.?\s*(\d.*)$/i.exec(input)
  if (!m || resolveBook(m[1])) return undefined
  const id = suggestBook(m[1])
  if (!id) return undefined
  const fixed = `${BOOK_BY_ID[id].name} ${m[2].trim()}`
  return parseRef(fixed) || parseRefList(fixed) ? fixed : undefined
}

/** Parse an OSIS-style id: "John.3.16", "John.3.16-John.3.18", "Prov.8.22-Prov.8.30", "John.3". */
export function parseOsis(osis: string): Ref | undefined {
  const [a, b] = osis.split('-')
  const pa = a.split('.')
  if (!BOOK_BY_ID[pa[0]]) return undefined
  const ref: Ref = { book: pa[0], chapter: parseInt(pa[1], 10) }
  if (pa[2]) ref.verse = parseInt(pa[2], 10)
  if (b) {
    const pb = b.split('.')
    if (pb.length === 3) {
      if (parseInt(pb[1], 10) !== ref.chapter) ref.endChapter = parseInt(pb[1], 10)
      ref.endVerse = parseInt(pb[2], 10)
    } else if (pb.length === 1) {
      ref.endVerse = parseInt(pb[0], 10)
    }
  }
  if (Number.isNaN(ref.chapter)) return undefined
  return ref
}

export function toOsis(r: Ref): string {
  const start = `${r.book}.${r.chapter}${r.verse !== undefined ? '.' + r.verse : ''}`
  if (r.endVerse === undefined && r.endChapter === undefined) return start
  const ec = r.endChapter ?? r.chapter
  return `${start}-${r.book}.${ec}${r.endVerse !== undefined ? '.' + r.endVerse : ''}`
}

export function formatRef(r: Ref): string {
  const name = BOOK_BY_ID[r.book]?.name ?? r.book
  let s = `${name} ${r.chapter}`
  if (r.verse !== undefined) s += `:${r.verse}`
  if (r.endChapter !== undefined && r.endChapter !== r.chapter) {
    s += `-${r.endChapter}${r.endVerse !== undefined ? ':' + r.endVerse : ''}`
  } else if (r.endVerse !== undefined && r.endVerse !== r.verse) {
    s += `-${r.endVerse}`
  }
  return s
}

export function refPath(r: Ref): string {
  let v = ''
  if (r.verse !== undefined) {
    v = '/' + r.verse
    if (r.endVerse !== undefined && r.endVerse > r.verse && (r.endChapter === undefined || r.endChapter === r.chapter)) v += '-' + r.endVerse
    else if (r.endChapter !== undefined && r.endChapter > r.chapter && r.endVerse !== undefined) v += `-${r.endChapter}:${r.endVerse}` // "Gen 1:1-2:3" -> /bible/Gen/1/1-2:3
  }
  return `/bible/${r.book}/${r.chapter}${v}`
}

/** Path for a list of references in one chapter ("John 3:16,18" -> /bible/John/3/16,18). Falls back to the first. */
export function refListPath(refs: Ref[]): string {
  const [a] = refs
  const same = refs.every((r) => r.book === a.book && r.chapter === a.chapter && r.verse !== undefined && (r.endChapter ?? r.chapter) === r.chapter)
  if (!same) return refPath(a)
  const spec = refs.map((r) => (r.endVerse !== undefined && r.endVerse > r.verse! ? `${r.verse}-${r.endVerse}` : `${r.verse}`)).join(',')
  return `/bible/${a.book}/${a.chapter}/${spec}`
}

/** A range that runs into a later chapter: "1-2:3" (from verse 1 to chapter 2 verse 3). */
export function parseCrossSpec(spec: string | undefined): { from: number; toChapter: number; toVerse: number } | undefined {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*:\s*(\d+)\s*$/.exec(spec ?? '')
  return m ? { from: +m[1], toChapter: +m[2], toVerse: +m[3] } : undefined
}

/** Read the verse part of a reader URL: "16", "28-39", "16,18,20-22". Returns verse numbers in order. */
export function parseVerseSpec(spec: string | undefined): number[] {
  if (!spec) return []
  const out: number[] = []
  for (const part of spec.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = m[2] ? Math.min(parseInt(m[2], 10), a + 200) : a
    for (let v = a; v <= Math.max(a, b); v++) if (!out.includes(v)) out.push(v)
  }
  return out
}

export const verseKey = (book: string, chapter: number, verse: number) => `${book}.${chapter}.${verse}`

/** Numeric key used by the concordance data: bookIndex*1e6 + chapter*1e3 + verse. */
export function decodeNumericKey(n: number): { book: string; chapter: number; verse: number } {
  const bi = Math.floor(n / 1_000_000)
  const chapter = Math.floor((n % 1_000_000) / 1000)
  return { book: BOOKS[bi].id, chapter, verse: n % 1000 }
}

/** Find references inside free text. Returns ranges so callers can render links. */
export interface FoundRef {
  start: number
  end: number
  text: string
  ref: Ref
}

const BOOK_ALT = (() => {
  const names = new Set<string>()
  for (const b of BOOKS) {
    names.add(b.name)
    for (const a of b.abbr) if (a.length >= 2) names.add(a)
  }
  names.add('Psalm')
  const list = [...names].sort((a, b) => b.length - a.length).map((n) => n.replace(/^([1-3])/, '$1\\s?').replace(/ /g, '\\s'))
  return list.join('|')
})()

const FIND_RE = new RegExp(
  `\\b((?:${BOOK_ALT})\\.?)\\s?(\\d{1,3})(?::(\\d{1,3})(?:\\s?[-–]\\s?(\\d{1,3})(?::(\\d{1,3}))?)?|\\s?[-–]\\s?(\\d{1,3}))?(?![\\w:])`,
  'gi',
)

export function findRefs(text: string): FoundRef[] {
  const out: FoundRef[] = []
  FIND_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FIND_RE.exec(text))) {
    // avoid matching ordinary words like "is 5" unless written with a verse or capitalised book
    const bookText = m[1]
    if (!m[3] && !/^[1-3]?\s?[A-Z]/.test(bookText)) continue
    if (!/^[1-3]?\s?[A-Z]/.test(bookText)) continue
    const parsed = parseRef(m[0])
    if (!parsed || !isValidRef(parsed)) continue
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0], ref: parsed })
  }
  return out
}

let chapterCounts: Record<string, number[]> | null = null
export function setChapterCounts(c: Record<string, number[]>) {
  chapterCounts = c
}
export function chapterCount(book: string): number {
  return chapterCounts?.[book]?.length ?? 0
}
export function verseCount(book: string, chapter: number): number {
  return chapterCounts?.[book]?.[chapter - 1] ?? 0
}

export function isValidRef(r: Ref): boolean {
  if (!BOOK_BY_ID[r.book] || r.chapter < 1) return false
  if (!chapterCounts) return true
  const n = chapterCounts[r.book]?.length ?? 0
  if (r.chapter > n) return false
  if (r.verse !== undefined && (r.verse < 1 || r.verse > verseCount(r.book, r.chapter))) return false
  return true
}

/** Expand a ref into concrete verse keys (requires chapter counts). */
export function expandRef(r: Ref): { book: string; chapter: number; verse: number }[] {
  const out: { book: string; chapter: number; verse: number }[] = []
  const endC = r.endChapter ?? r.chapter
  for (let c = r.chapter; c <= endC; c++) {
    const vc = verseCount(r.book, c)
    const from = c === r.chapter ? (r.verse ?? 1) : 1
    let to = vc
    if (c === endC) {
      if (r.endVerse !== undefined) to = r.endVerse
      else if (r.endChapter === undefined && r.verse !== undefined) to = r.verse
    }
    for (let v = from; v <= Math.min(to, vc || to); v++) out.push({ book: r.book, chapter: c, verse: v })
  }
  return out
}
