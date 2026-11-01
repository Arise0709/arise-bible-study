import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = path.join(__dirname, '..', 'public', 'data', 'commentary')
const KJV = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'kjv', 'index.json'), 'utf8')) as { id: string; chapters: number[] }[]).map((b) => [b.id, b.chapters]))
const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8'))
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8'))
// coverage and introductions are stored one file per book for all works (commentary/coverage/{Book}.json, commentary/intro/{Book}.json)
const read = (id: string, book: string, f: string) =>
  f === 'coverage.json' ? json(`coverage/${book}.json`)[id] : f === 'intro.json' ? { h: json(`intro/${book}.json`)[id] } : json(`${id}/${book}/${f}`)
const text = (h: string) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const ALLOWED = new Set(['p', 'h4', 'i', 'b', 'sup', 'sub', 'u', 'span', 'a', 'ul', 'li', 'table', 'tr', 'td', 'br', 'small'])

describe('commentary sources and rights', () => {
  it('only approved, public-domain works with full source records are included', () => {
    expect(index.works.map((w: { id: string }) => w.id)).toEqual(['MHCC', 'MHC', 'JFB', 'Clarke', 'KD', 'Scofield'])
    for (const w of index.works) {
      expect(w.status).toBe('approved')
      expect(w.license).toMatch(/^Public domain/)
      for (const k of ['title', 'author', 'era', 'edition', 'source', 'copyright', 'attribution', 'scope', 'version', 'sha256', 'tradition']) expect(w[k], `${w.id} ${k}`).toBeTruthy()
      expect(w.source).toMatch(/commit [0-9a-f]{40}/)
      expect(w.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
  it('works that could not be verified are listed with reasons and not shipped', () => {
    expect(index.notIncluded.map((w: { id: string }) => w.id).sort()).toEqual(['Barnes', 'Gill', 'TDavid', 'Wesley'])
    for (const w of index.notIncluded) {
      expect(w.reason.length).toBeGreaterThan(20)
      expect(fs.existsSync(path.join(DIR, w.id))).toBe(false)
    }
  })
})

describe('commentary mappings are valid and match coverage', () => {
  for (const w of index.works as { id: string }[]) {
    it(`${w.id}: every entry sits on real verses, uses only safe markup, and links only to real passages`, () => {
      let entries = 0
      for (const book of fs.readdirSync(path.join(DIR, w.id))) {
        expect(KJV[book], book).toBeTruthy()
        const cov = read(w.id, book, 'coverage.json')
        for (const [c, info] of Object.entries(cov.chapters) as [string, { overview: boolean; ranges: number[][] }][]) {
          const ch = read(w.id, book, `${c}.json`)
          const max = KJV[book][+c - 1]
          expect(max, `${book} ${c}`).toBeGreaterThan(0)
          expect(ch.e.map((e: unknown[]) => [e[0], e[1]])).toEqual(info.ranges)
          expect(ch.c.length > 0).toBe(info.overview)
          for (const [s, e, h] of ch.e as [number, number, string][]) {
            expect(s >= 1 && s <= e && e <= max, `${w.id} ${book} ${c}:${s}-${e}`).toBe(true)
            expect(text(h).length).toBeGreaterThan(0)
            entries++
          }
          for (const h of [...ch.c, ...ch.e.map((e: unknown[]) => e[2])] as string[]) {
            for (const m of h.matchAll(/<\/?([a-z0-9]+)/g)) expect(ALLOWED.has(m[1]), `${w.id} ${book} ${c} <${m[1]}>`).toBe(true)
            expect(h).not.toMatch(/<[^>]*\son\w+=|javascript:|<script/i)
            for (const m of h.matchAll(/data-ref="([^"]+)"/g)) {
              const [, b, ch2, v] = /^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?/.exec(m[1])!
              expect(KJV[b], m[1]).toBeTruthy()
              expect(+ch2 <= KJV[b].length && (!v || +v <= KJV[b][+ch2 - 1]), m[1]).toBe(true)
            }
          }
        }
      }
      expect(entries).toBeGreaterThan(1000)
    }, 60000)
  }
})

describe('commentary text is the source text, at the right place', () => {
  const entry = (id: string, book: string, c: number, v: number) => (read(id, book, `${c}.json`).e as [number, number, string][]).filter((e) => e[0] === v).map((e) => text(e[2]))
  it('verse notes land on their verses (spot checks, both Testaments)', () => {
    expect(entry('JFB', 'John', 3, 2)[0]).toMatch(/^2\. came to Jesus by night--One of those superficial "believers"/)
    expect(entry('Clarke', 'John', 3, 2)[0]).toMatch(/^Verse 2 Came to Jesus by night - He had matters of the utmost importance/)
    expect(entry('Scofield', 'John', 3, 3)[0]).toMatch(/^born again Regeneration/)
    expect(entry('JFB', 'Gen', 1, 1)[0]).toMatch(/^1\. In the beginning--a period of remote and unknown antiquity/)
    expect(entry('Clarke', 'Gen', 1, 2)[0]).toMatch(/^Verse 2 The earth was without form and void/)
  })
  it('passage notes keep their whole range (not shown as a single-verse note)', () => {
    const mhcc = read('MHCC', 'Gen', '1.json').e as [number, number, string][]
    expect(mhcc[0].slice(0, 2)).toEqual([1, 2])
    expect(text(mhcc[0][2])).toMatch(/^Verses 1-2 The first verse of the Bible gives us a satisfying and useful account/)
    const mhc = (read('MHC', 'John', '3.json').e as [number, number, string][]).find((e) => e[0] === 1)!
    expect(mhc[1]).toBe(21)
    expect(read('KD', 'Gen', '1.json').e.some((e: number[]) => e[0] === 2 && e[1] === 5)).toBe(true)
  })
  it('introductions are separated from verse notes', () => {
    expect(text(read('Clarke', 'Gen', 'intro.json').h)).toMatch(/^Preface to the Book of Genesis Every believer in Divine revelation/)
    expect(entry('Clarke', 'Gen', 1, 1)[0]).toMatch(/^Verse 1/)
    expect(text(read('KD', 'Gen', 'intro.json').h)).toMatch(/^GENERAL INTRODUCTION TO THE FIVE BOOKS OF MOSES/)
    expect(entry('KD', 'Gen', 1, 1)[0]).toMatch(/^Gen 1:1/)
    expect(text(read('Scofield', 'Gen', 'intro.json').h)).toMatch(/^Book Introduction - Genesis/)
    expect(text(read('MHCC', 'Gen', 'intro.json').h)).toMatch(/Genesis is a name taken from the Greek/)
  })
  it('Bible text that a commentary reprints is marked as Bible text', () => {
    const mhc = (read('MHC', 'John', '3.json').e as [number, number, string][]).find((e) => e[0] === 1)![2]
    expect(mhc).toMatch(/<p class="bible-text"><sup>1<\/sup> There was a man of the Pharisees/)
  })
  it('coverage is reported, not invented: Keil & Delitzsch is Old Testament only; Scofield is selective', () => {
    expect(fs.existsSync(path.join(DIR, 'KD', 'John'))).toBe(false)
    const sco = read('Scofield', 'John', 'coverage.json').chapters['3'].ranges as number[][]
    expect(sco.some((r) => r[0] <= 3 && 3 <= r[1])).toBe(true)
    expect(sco.some((r) => r[0] <= 5 && 5 <= r[1])).toBe(false) // no Scofield note on John 3:5
    expect(read('KD', 'Dan', '6.json').c.join(' ')).toMatch(/keyed to verse 29 in a different verse numbering/)
  })
})
