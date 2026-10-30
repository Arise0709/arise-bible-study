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
    const book = await loadBook(ref.book)
    for (const k of expandRef(ref)) {
      const v = book.chapters[k.chapter - 1]?.verses.find((x) => x.v === k.verse)
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
