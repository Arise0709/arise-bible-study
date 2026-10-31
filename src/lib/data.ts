/**
 * Loaders for the static datasets in /public/data. Every loader caches its result and throws a
 * DataError with a readable message when a file is missing, so the UI can say exactly what failed.
 */
import { BOOKS, setChapterCounts, type Ref, expandRef, formatRef } from './refs'

export class DataError extends Error {
  resource: string
  constructor(resource: string, detail: string) {
    super(`Could not load ${resource}. ${detail}`)
    this.resource = resource
  }
}

const cache = new Map<string, Promise<unknown>>()

async function getJson<T>(path: string, label: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`/data/${path}`)
      .then(async (r) => {
        if (!r.ok) throw new DataError(label, `The server answered ${r.status}.`)
        const type = r.headers.get('content-type') ?? ''
        if (type.includes('text/html')) throw new DataError(label, 'The data file is missing from this deployment.')
        return r.json()
      })
      .catch((e) => {
        cache.delete(path)
        if (e instanceof DataError) throw e
        throw new DataError(label, 'Check your connection and try again.')
      })
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

/* ---------------- KJV ---------------- */

/** [text, flags?, wordIndex?] flags: 1 added, 2 words of Jesus, 4 divine name, 8 inscription */
export type Segment = [string, number?, number?]
export interface Verse {
  v: number
  p?: 1
  h?: string
  s: Segment[]
  w?: string[]
  n?: [string, string][]
}
export interface Chapter {
  c: number
  title?: Segment[]
  tw?: string[]
  verses: Verse[]
}
export interface Book {
  id: string
  name: string
  chapters: Chapter[]
}

export const FLAG_ADDED = 1
export const FLAG_RED = 2
export const FLAG_DIVINE = 4

export interface BookIndexEntry {
  id: string
  name: string
  testament: string
  chapters: number[]
}

export async function loadBookIndex(): Promise<BookIndexEntry[]> {
  const idx = await getJson<BookIndexEntry[]>('kjv/index.json', 'the list of Bible books')
  setChapterCounts(Object.fromEntries(idx.map((b) => [b.id, b.chapters])))
  return idx
}

export function loadBook(id: string): Promise<Book> {
  const name = BOOKS.find((b) => b.id === id)?.name ?? id
  return getJson<Book>(`kjv/${id}.json`, `the KJV text of ${name}`)
}

/**
 * One KJV chapter (text, word tags, notes), from its own small file. If the whole book is already loaded
 * (by a feature that needs it), the chapter comes from there instead, so nothing is downloaded twice.
 */
export function loadChapter(id: string, chapter: number): Promise<Chapter> {
  const whole = cache.get(`kjv/${id}.json`) as Promise<Book> | undefined
  if (whole) return whole.then((b) => b.chapters[chapter - 1] ?? Promise.reject(new DataError(`chapter ${chapter}`, 'It is not in this book.')))
  const name = BOOKS.find((b) => b.id === id)?.name ?? id
  return getJson<Chapter>(`kjv/${id}/${chapter}.json`, `the KJV text of ${name} ${chapter}`)
}

/** Text as printed: divine-name markup is rendered in capitals (LORD, GOD). */
export function segText(s: Segment): string {
  return (s[1] ?? 0) & FLAG_DIVINE ? s[0].toUpperCase() : s[0]
}

export function verseText(v: Verse): string {
  return v.s.map(segText).join('')
}

export interface WordInfo {
  strongs: string[]
  morph: string[]
  split: string
  tr: string
}

export function parseWord(w: string): WordInfo {
  const [s = '', m = '', split = '', tr = ''] = w.split('|')
  return { strongs: s ? s.split(' ') : [], morph: m ? m.split(' ') : [], split, tr }
}

export interface PassageVerse {
  book: string
  chapter: number
  verse: number
  text: string
}

/** Exact text for a reference, verse by verse, in the KJV or another translation. */
export async function getPassage(ref: Ref, tr = 'KJV'): Promise<PassageVerse[]> {
  await loadBookIndex()
  const out: PassageVerse[] = []
  if (tr && tr !== 'KJV') {
    const chapters = await loadTranslationBook(tr, ref.book)
    for (const k of expandRef(ref)) {
      const t = chapters[k.chapter - 1]?.[k.verse - 1]
      if (t) out.push({ ...k, text: t })
    }
  } else {
    const keys = expandRef(ref)
    const chapters = new Map<number, Chapter | undefined>()
    await Promise.all([...new Set(keys.map((k) => k.chapter))].map(async (c) => chapters.set(c, await loadChapter(ref.book, c).catch(() => undefined))))
    for (const k of keys) {
      const v = chapters.get(k.chapter)?.verses.find((x) => x.v === k.verse)
      if (v) out.push({ ...k, text: verseText(v) })
    }
  }
  if (!out.length) throw new DataError(formatRef(ref), `That passage does not exist in the ${tr || 'KJV'}.`)
  return out
}

export function passageToText(vs: PassageVerse[]): string {
  if (vs.length === 1) return vs[0].text
  return vs.map((v) => `${v.verse} ${v.text}`).join(' ')
}

/* ---------------- Strong's ---------------- */

export interface StrongsEntry {
  id: string
  lang: 'Hebrew' | 'Aramaic' | 'Greek'
  lemma: string
  xlit: string
  pron: string
  deriv: string
  def: string
  kjv: string
  gloss: string
  pos: string
  posCode: string
  senses?: string
  rel: string[]
  count: number
}

export interface ConcordanceEntry {
  refs: number[]
  kjv: [string, number][]
  combined: number
  untranslated: number
}

function shardOf(id: string): string {
  const m = /^([HG])(\d+)/.exec(id)
  if (!m) throw new DataError(id, 'This is not a valid Strong\'s number.')
  return `${m[1]}${Math.floor(parseInt(m[2], 10) / 1000)}`
}

export async function loadStrongs(id: string): Promise<StrongsEntry | undefined> {
  const shard = await getJson<Record<string, StrongsEntry>>(`strongs/${shardOf(id)}.json`, `Strong's entries near ${id}`)
  return shard[id]
}

export async function loadConcordance(id: string): Promise<ConcordanceEntry | undefined> {
  const shard = await getJson<Record<string, ConcordanceEntry>>(`concordance/${shardOf(id)}.json`, `concordance data near ${id}`)
  return shard[id]
}

/* ---------------- Cross references ---------------- */

export async function loadXrefs(book: string, chapter: number, verse: number): Promise<[string, number][]> {
  const d = await getJson<Record<string, [string, number][]>>(`xrefs/${book}.json`, `cross-references for ${book}`).catch((e) => {
    // Some books have no outgoing cross references at all; treat a 404 there as empty.
    if (e instanceof DataError && /404/.test(e.message)) return {} as Record<string, [string, number][]>
    throw e
  })
  return d[`${chapter}.${verse}`] ?? []
}

/* ---------------- Dictionaries ---------------- */

export type DictSource = 'isbe' | 'hitchcock' | 'webster' | 'archaic'

export const SOURCE_LABEL: Record<DictSource | 'wordnet' | 'personal', string> = {
  isbe: 'ISBE (1915)',
  hitchcock: "Hitchcock's Bible Names",
  webster: 'Webster 1913',
  archaic: 'App editorial',
  wordnet: 'WordNet 3.1',
  personal: 'My dictionary',
}

export function loadDictIndex(): Promise<[string, DictSource][]> {
  return getJson<[string, DictSource][]>('dict/index.json', 'the dictionary index')
}

function letterOf(word: string): string {
  const c = word.charAt(0).toLowerCase()
  return c >= 'a' && c <= 'z' ? c : 'other'
}

export async function loadIsbe(name: string): Promise<string | undefined> {
  const d = await getJson<Record<string, string>>(`dict/isbe-${letterOf(name)}.json`, 'the ISBE encyclopedia')
  return d[name] ?? Object.entries(d).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

export async function loadHitchcock(name: string): Promise<string | undefined> {
  const d = await getJson<Record<string, string>>('dict/hitchcock.json', "Hitchcock's Bible Names")
  return d[name] ?? Object.entries(d).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
}

export interface WebsterSense {
  d: string
  spec?: string
  q?: string[]
  refs?: string[]
}
export interface WebsterEntry {
  pos: string
  senses: WebsterSense[]
  syn?: string
  etym?: string
}

export async function loadWebster(word: string): Promise<WebsterEntry[] | undefined> {
  const d = await getJson<Record<string, WebsterEntry[]>>(`dict/webster-${letterOf(word)}.json`, 'Webster 1913')
  const key = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return d[key]
}

export interface ArchaicEntry {
  word: string
  modern: string
  sense: string
  refs: string[]
}

export function loadArchaic(): Promise<ArchaicEntry[]> {
  return getJson<ArchaicEntry[]>('dict/archaic-editorial.json', 'the archaic word list')
}

export interface WordnetSense {
  pos: string
  gloss: string
  syn: string[]
  ant?: string[]
  ex?: string
}

export async function loadWordnet(lemma: string): Promise<WordnetSense[] | undefined> {
  const d = await getJson<Record<string, WordnetSense[]>>(`thesaurus/wn-${letterOf(lemma)}.json`, 'the WordNet thesaurus')
  return d[lemma.toLowerCase()]
}

/* ---------------- Sources ---------------- */

export interface SourceInfo {
  id: string
  kind: string
  name: string
  provider: string
  url: string
  version: string
  license: string
  attribution: string
  notes: string
  sha256: Record<string, string>
}
export interface SourcesFile {
  sources: SourceInfo[]
  integrity: { missingFromLexicon: string[]; usedIds: number; lexiconEntries: number }
  notAvailable: { name: string; reason: string }[]
}

export function loadSources(): Promise<SourcesFile> {
  return getJson<SourcesFile>('sources.json', 'source information')
}

/** Lemma candidates for KJV word forms, matching scripts/build_reference.py. */
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/'s$/, '')
  const c = new Set<string>([w])
  const rules: [string, string[]][] = [
    ['eth', ['', 'e']], ['est', ['', 'e']], ['edst', ['', 'e']], ['ed', ['', 'e']], ['ing', ['', 'e']], ['ies', ['y']],
    ['es', ['', 'e']], ['s', ['']], ['th', ['']], ['st', ['']], ['ly', ['']], ['er', ['', 'e']], ['ness', ['']],
  ]
  for (const [suf, reps] of rules) {
    if (w.endsWith(suf) && w.length - suf.length >= 2) {
      const stem = w.slice(0, -suf.length)
      for (const r of reps) c.add(stem + r)
      if (stem.length > 2 && stem.at(-1) === stem.at(-2)) c.add(stem.slice(0, -1))
      if (stem.endsWith('i')) c.add(stem.slice(0, -1) + 'y')
    }
  }
  return [...c]
}

/* ---------------- Other translations (plain text) ---------------- */

export interface TranslationInfo {
  id: string
  name: string
  year: string
  license: string
  note: string
  verses: number
}

export function loadTranslationIndex(): Promise<TranslationInfo[]> {
  return getJson<TranslationInfo[]>('translations/index.json', 'the list of translations')
}

export async function loadTranslationBook(id: string, book: string): Promise<(string | null)[][]> {
  const name = BOOKS.find((b) => b.id === book)?.name ?? book
  const d = await getJson<{ c: (string | null)[][] }>(`translations/${id}/${book}.json`, `${name} in ${id}`)
  return d.c
}

/* ---------------- Commentaries (public domain; see public/data/commentary/index.json) ---------------- */

export interface CommentaryWork {
  id: string
  title: string
  short: string
  author: string
  era: string
  edition: string
  tradition: string
  level: string
  status: string
  copyright: string
  license: string
  attribution: string
  scope: string
  source: string
  version: string
  books: number
  chapters: number
}
export interface CommentaryIndex {
  works: CommentaryWork[]
  notIncluded: { id: string; title: string; author: string; status: string; reason: string }[]
}
export interface CommentaryCoverage {
  intro: boolean
  chapters: Record<string, { overview: boolean; ranges: [number, number][] }>
}
/** [first verse, last verse, html]: a note on a verse or a passage, exactly as the commentary assigns it */
export type CommentaryEntry = [number, number, string]
export interface CommentaryChapter {
  c: string[] // chapter overview
  e: CommentaryEntry[]
}

export const loadCommentaryIndex = () => getJson<CommentaryIndex>('commentary/index.json', 'the commentary list')
/** Which chapters and verses a commentary covers in a book; null when it has nothing on that book. */
export function loadCommentaryCoverage(id: string, book: string): Promise<CommentaryCoverage | null> {
  return getJson<CommentaryCoverage>(`commentary/${id}/${book}/coverage.json`, `the ${id} coverage of ${book}`).catch((e) => {
    if (e instanceof DataError && /404|missing from this deployment/.test(e.message)) return null
    throw e
  })
}
export const loadCommentaryChapter = (id: string, book: string, chapter: number) =>
  getJson<CommentaryChapter>(`commentary/${id}/${book}/${chapter}.json`, `the ${id} commentary on ${book} ${chapter}`)
export const loadCommentaryIntro = (id: string, book: string) => getJson<{ h: string }>(`commentary/${id}/${book}/intro.json`, `the ${id} introduction to ${book}`)

/* ---------------- Original languages (STEPBible TAHOT/TAGNT, CC BY 4.0; BDB via Open Scriptures) ---------------- */

/** Hebrew: [text, transliteration, gloss, Strong's tags, grammar, sense label, 'Q' if Qere]
 *  Greek:  [text, transliteration, gloss, Strong's, grammar, lemma, lemma gloss, edition flag ('' | 'T' | 'N' | 'O')] */
export type OrigWord = string[]
export interface OrigChapter {
  l: 'H' | 'G'
  v: Record<string, OrigWord[]>
}
export interface BdbEntry {
  id: string
  w: string
  status: string
  h: string
  root: { w: string; def: string } | null
  family: { id: string; w: string; def: string }[]
}
export const loadOrigChapter = (book: string, chapter: number) => getJson<OrigChapter>(`orig/${book}/${chapter}.json`, `the original-language text of ${book} ${chapter}`)
export const loadMorphTable = (lang: 'H' | 'G') => getJson<Record<string, string>>(`orig/morph-${lang}.json`, `the ${lang === 'H' ? 'Hebrew' : 'Greek'} grammar table`)
export async function loadForms(id: string): Promise<[string, number][]> {
  const shard = await getJson<Record<string, [string, number][]>>(`orig/forms/${shard100(id)}.json`, `word forms near ${id}`)
  return shard[id] ?? []
}
export async function loadBdb(id: string): Promise<BdbEntry[]> {
  const shard = await getJson<Record<string, BdbEntry[]>>(`bdb/${shard100(id)}.json`, `BDB entries near ${id}`).catch(() => ({}) as Record<string, BdbEntry[]>)
  return shard[id] ?? []
}
/** BDB and word-form files hold 100 Strong's numbers each. */
function shard100(id: string): string {
  const m = /^([HG])(\d+)/.exec(id)
  if (!m) throw new DataError(id, "This is not a valid Strong's number.")
  return `${m[1]}${Math.floor(parseInt(m[2], 10) / 100)}`
}

/** Strong's number without extension letter or leading zeros: "{H0430G}" -> "H430". */
export function baseStrong(tag: string): string | null {
  const m = /([HG])0*(\d+)/.exec(tag)
  return m ? `${m[1]}${m[2]}` : null
}
/** STEPBible transliteration in plain form: "be./re.Shit" -> "be-reshit". */
export const plainXlit = (x: string) => x.replace(/\./g, '').replace(/\//g, '-').toLowerCase()
