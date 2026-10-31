import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRefs, isValidRef, parseRef, parseRefList, parseVerseSpec, refListPath, refPath, setChapterCounts, suggestRefText, SINGLE_CHAPTER_BOOKS } from '../src/lib/refs'

const index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'kjv', 'index.json'), 'utf8')) as { id: string; chapters: number[] }[]
setChapterCounts(Object.fromEntries(index.map((b) => [b.id, b.chapters])))

describe('single-chapter books (H1)', () => {
  it('the five single-chapter books are exactly the ones with one chapter in the data', () => {
    expect([...SINGLE_CHAPTER_BOOKS].sort()).toEqual(index.filter((b) => b.chapters.length === 1).map((b) => b.id).sort())
  })
  const cases: [string, string, number][] = [
    ['Obadiah 4', 'Obad', 4], ['Obad 21', 'Obad', 21], ['Philemon 6', 'Phlm', 6], ['Phlm 25', 'Phlm', 25],
    ['2 John 5', '2John', 5], ['II John 12', '2John', 12], ['3 John 4', '3John', 4], ['3 Jn 2', '3John', 2], ['Jude 3', 'Jude', 3], ['Jude 24', 'Jude', 24],
  ]
  for (const [input, book, verse] of cases) {
    it(`${input} -> ${book} 1:${verse}`, () => {
      const r = parseRef(input)
      expect(r).toEqual({ book, chapter: 1, verse })
      expect(isValidRef(r!)).toBe(true)
      expect(refPath(r!)).toBe(`/bible/${book}/1/${verse}`)
    })
  }
  it('explicit chapter:verse still works', () => {
    expect(parseRef('Jude 1:3')).toEqual({ book: 'Jude', chapter: 1, verse: 3 })
    expect(parseRef('Philemon 1:6')).toEqual({ book: 'Phlm', chapter: 1, verse: 6 })
  })
  it('ranges are verse ranges', () => {
    expect(parseRef('Jude 3-5')).toEqual({ book: 'Jude', chapter: 1, verse: 3, endVerse: 5 })
    expect(parseRef('Jude 1-4')).toEqual({ book: 'Jude', chapter: 1, verse: 1, endVerse: 4 })
    expect(parseRef('Obadiah 1:3-4')).toEqual({ book: 'Obad', chapter: 1, verse: 3, endVerse: 4 })
  })
  it('a bare "Jude 1" still opens the book', () => {
    expect(parseRef('Jude 1')).toEqual({ book: 'Jude', chapter: 1 })
  })
  it('references found inside notes follow the same rule', () => {
    expect(findRefs('See Jude 3 and Philemon 1:6.').map((f) => f.ref)).toEqual([
      { book: 'Jude', chapter: 1, verse: 3 },
      { book: 'Phlm', chapter: 1, verse: 6 },
    ])
  })
  it('multi-chapter books are unchanged', () => {
    expect(parseRef('John 3')).toEqual({ book: 'John', chapter: 3 })
    expect(parseRef('1 John 3')).toEqual({ book: '1John', chapter: 3 })
    expect(parseRef('Ps 23')).toEqual({ book: 'Ps', chapter: 23 })
  })
})

describe('flexible reference formats (M8)', () => {
  it('space instead of a colon', () => {
    expect(parseRef('Phil 4 13')).toEqual({ book: 'Phil', chapter: 4, verse: 13 })
    expect(parseRef('1 John 4 8')).toEqual({ book: '1John', chapter: 4, verse: 8 })
    expect(parseRef('John 3 16-18')).toEqual({ book: 'John', chapter: 3, verse: 16, endVerse: 18 })
  })
  it('en and em dashes in ranges', () => {
    expect(parseRef('Romans 8:28–39')).toEqual({ book: 'Rom', chapter: 8, verse: 28, endVerse: 39 })
    expect(parseRef('Romans 8:28—39')).toEqual({ book: 'Rom', chapter: 8, verse: 28, endVerse: 39 })
  })
  it('comma and semicolon lists', () => {
    expect(parseRefList('John 3:16,18')).toEqual([
      { book: 'John', chapter: 3, verse: 16 },
      { book: 'John', chapter: 3, verse: 18 },
    ])
    expect(parseRefList('Rom 8:28-30, 38-39')).toEqual([
      { book: 'Rom', chapter: 8, verse: 28, endVerse: 30 },
      { book: 'Rom', chapter: 8, verse: 38, endVerse: 39 },
    ])
    expect(parseRefList('Gen 1:1; 2:7')?.[1]).toEqual({ book: 'Gen', chapter: 2, verse: 7 })
    expect(parseRefList('John 3:16; Rom 5:8')?.[1]).toEqual({ book: 'Rom', chapter: 5, verse: 8 })
    expect(parseRefList('love, joy, peace')).toBeUndefined()
    expect(parseRefList('John 3:16')).toBeUndefined()
  })
  it('paths carry ranges and lists so every verse can be highlighted', () => {
    expect(refPath(parseRef('Romans 8:28-39')!)).toBe('/bible/Rom/8/28-39')
    expect(refPath(parseRef('Gen 1:1-2:3')!)).toBe('/bible/Gen/1/1-2:3')
    expect(refListPath(parseRefList('John 3:16,18')!)).toBe('/bible/John/3/16,18')
    expect(refListPath(parseRefList('John 3:16; Rom 5:8')!)).toBe('/bible/John/3/16')
    expect(parseVerseSpec('16,18,20-22')).toEqual([16, 18, 20, 21, 22])
    expect(parseVerseSpec('28-39')).toHaveLength(12)
    expect(parseVerseSpec('abc')).toEqual([])
  })
  it('verses that do not exist are recognized', () => {
    expect(isValidRef(parseRef('Gen 50:27')!)).toBe(false)
    expect(isValidRef(parseRef('Gen 51')!)).toBe(false)
    expect(isValidRef(parseRef('Gen 50:26')!)).toBe(true)
  })
  it('suggests a book for a misspelled reference', () => {
    expect(suggestRefText('Jhon 3:16')).toBe('John 3:16')
    expect(suggestRefText('Romens 8:28')).toBe('Romans 8:28')
    expect(suggestRefText('John 3:16')).toBeUndefined()
    expect(suggestRefText('hello')).toBeUndefined()
  })
})
