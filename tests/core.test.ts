import { describe, expect, it, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { findRefs, formatRef, parseOsis, parseRef, setChapterCounts, toOsis, expandRef } from '../src/lib/refs'
import { decodeRobinson } from '../src/lib/morph'
import { parseWord, verseText, type Book } from '../src/lib/data'
import { sermonToDoc, toMarkdown } from '../src/export/doc'
import { newSermon } from '../src/pages/sermonTemplates'

const DATA = path.join(__dirname, '..', 'public', 'data')
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'))
const book = (id: string): Book => json(`kjv/${id}.json`)

beforeAll(() => {
  const idx = json('kjv/index.json') as { id: string; chapters: number[] }[]
  setChapterCounts(Object.fromEntries(idx.map((b) => [b.id, b.chapters])))
})

describe('reference parser', () => {
  it('parses common forms', () => {
    expect(parseRef('John 3:16')).toEqual({ book: 'John', chapter: 3, verse: 16 })
    expect(parseRef('Jn 3:16-18')).toEqual({ book: 'John', chapter: 3, verse: 16, endVerse: 18 })
    expect(parseRef('1 Cor 13')).toEqual({ book: '1Cor', chapter: 13 })
    expect(parseRef('Gen 1:1-2:3')).toEqual({ book: 'Gen', chapter: 1, verse: 1, endChapter: 2, endVerse: 3 })
    expect(parseRef('Psalm 23')?.book).toBe('Ps')
    expect(parseRef('II Kings 2:11')?.book).toBe('2Kgs')
    expect(parseRef('love one another')).toBeUndefined()
  })
  it('round-trips OSIS and formats', () => {
    const r = parseOsis('John.3.16-John.3.18')!
    expect(formatRef(r)).toBe('John 3:16-18')
    expect(toOsis(r)).toBe('John.3.16-John.3.18')
    expect(formatRef(parseOsis('Prov.8.22-Prov.8.30')!)).toBe('Proverbs 8:22-30')
  })
  it('finds references in free text and rejects impossible ones', () => {
    const found = findRefs('Compare Rom 5:8 and 1 John 4:9-10, not John 99:1.')
    expect(found.map((f) => toOsis(f.ref))).toEqual(['Rom.5.8', '1John.4.9-1John.4.10'])
  })
  it('expands ranges using real verse counts', () => {
    expect(expandRef({ book: 'Ps', chapter: 117 })).toHaveLength(2)
    expect(expandRef({ book: 'John', chapter: 3, verse: 35, endChapter: 4, endVerse: 2 })).toHaveLength(4)
  })
})

describe('Robinson morphology', () => {
  it('decodes verbs, nouns, and simple tags', () => {
    expect(decodeRobinson('V-AAI-3S')).toBe('verb, aorist, active, indicative, 3rd person, singular')
    expect(decodeRobinson('N-NSM')).toBe('noun, nominative, singular, masculine')
    expect(decodeRobinson('V-2AAI-3S')).toContain('second aorist')
    expect(decodeRobinson('CONJ')).toBe('conjunction')
    expect(decodeRobinson('ZZZ')).toBeNull()
  })
})

describe('KJV data integrity', () => {
  it('has 66 books and 31,102 verses', () => {
    const idx = json('kjv/index.json') as { chapters: number[] }[]
    expect(idx).toHaveLength(66)
    expect(idx.reduce((a, b) => a + b.chapters.reduce((x, y) => x + y, 0), 0)).toBe(31102)
  })
  it('preserves exact text at spot checks', () => {
    expect(verseText(book('Gen').chapters[0].verses[0])).toBe('In the beginning God created the heaven and the earth.')
    expect(verseText(book('John').chapters[2].verses[15])).toBe(
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
    )
    expect(verseText(book('Ps').chapters[22].verses[0])).toBe('The LORD is my shepherd; I shall not want.')
    expect(verseText(book('John').chapters[10].verses[34])).toBe('Jesus wept.')
  })
  it('maps tagged words to the right Strong numbers', () => {
    const g = book('Gen').chapters[0].verses[0]
    const seg = g.s.find((s) => s[0] === 'In the beginning')!
    expect(parseWord(g.w![seg[2]!]).strongs).toEqual(['H7225'])
    const j = book('John').chapters[2].verses[15]
    const loved = j.s.find((s) => s[0] === 'loved')!
    expect(parseWord(j.w![loved[2]!]).strongs).toEqual(['G25'])
  })
  it('has a lexicon entry for every Strong number used in the text', () => {
    expect(json('reports/strongs-missing.json').missingFromLexicon).toEqual([])
    expect(json('strongs/H7.json').H7225.lemma.normalize('NFD')).toBe('רֵאשִׁית'.normalize('NFD'))
    expect(json('strongs/G0.json').G25.lemma).toBe('ἀγαπάω')
  })
  it('concordance refs for G25 include John 3:16', () => {
    const refs: number[] = json('concordance/G0.json').G25.refs
    expect(refs).toContain(42 * 1_000_000 + 3 * 1000 + 16)
  })
  it('records sources with licenses', () => {
    const s = json('sources.json')
    for (const src of s.sources) expect(src.license).toBeTruthy()
    expect(s.sources.find((x: { id: string }) => x.id === 'archaic-editorial').kind).toBe('editorial')
  })
})

describe('exports', () => {
  it('markdown keeps headings, quotes, and notes', () => {
    const s = newSermon('blank')
    s.title = 'Test'
    s.passage = 'John.3.16'
    s.sections = [
      { id: '1', type: 'point', title: 'Love gives', level: 1, blocks: [{ id: 'a', kind: 'scripture', ref: 'Rom.5.8', text: 'But God commendeth his love toward us' }, { id: 'b', kind: 'note', text: 'My point' }] },
      { id: '2', type: 'subpoint', title: 'Sub', level: 2, blocks: [] },
    ]
    const md = toMarkdown(sermonToDoc(s, 'For God so loved the world'))
    expect(md).toContain('# Test')
    expect(md).toContain('## Love gives')
    expect(md).toContain('### Sub')
    expect(md).toContain('> But God commendeth his love toward us')
    expect(md).toContain('> Romans 5:8 (KJV)')
    expect(md).toContain('My point')
    expect(md).not.toContain('—')
  })
})
