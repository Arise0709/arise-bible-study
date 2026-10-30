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
  /^\s*((?:[1-3]|i{1,3}|1st|2nd|3rd|first|second|third)?\s*[a-z][a-z .]*?)\.?\s*(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*[-–]\s*(\d+)(?:\s*[:.]\s*(\d+))?)?\s*$/i

/** Parse "John 3:16", "Jn 3:16-18", "1 Cor 13", "Gen 1:1-2:3", "Ps 23". Returns undefined if not a reference. */
export function parseRef(input: string): Ref | undefined {
  const m = REF_RE.exec(input)
  if (!m) return undefined
  const book = resolveBook(m[1])
  if (!book) return undefined
  const chapter = parseInt(m[2], 10)
  const ref: Ref = { book, chapter }
  if (m[3]) ref.verse = parseInt(m[3], 10)
  if (m[4]) {
    if (m[5]) {
      ref.endChapter = parseInt(m[4], 10)
      ref.endVerse = parseInt(m[5], 10)
    } else if (ref.verse !== undefined) {
      ref.endVerse = parseInt(m[4], 10)
    } else {
      ref.endChapter = parseInt(m[4], 10)
    }
  }
  return ref
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
  return `/bible/${r.book}/${r.chapter}${r.verse !== undefined ? '/' + r.verse : ''}`
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
