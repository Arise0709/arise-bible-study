import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { grammarText } from '../src/lib/grammar'

const DATA = path.join(__dirname, '..', 'public', 'data')
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'))
const KJV = Object.fromEntries((json('kjv/index.json') as { id: string; testament?: string; chapters: number[] }[]).map((b) => [b.id, b.chapters]))
const ot = new Set((JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'books.json'), 'utf8')) as { id: string; testament: string }[]).filter((b) => b.testament === 'OT').map((b) => b.id))
const verse = (book: string, c: number, v: number) => (json(`orig/${book}/${c}.json`).v[String(v)] as string[][]).map((w) => w.map((x) => x.normalize('NFC')))
const nfc = (x: string[]) => x.map((s) => s.normalize('NFC'))

describe('original-language text: complete, on KJV verses, from the sources', () => {
  it('every chapter of the Bible has its Hebrew or Greek text, keyed to real KJV verses', () => {
    let words = 0
    for (const [book, chapters] of Object.entries(KJV)) {
      chapters.forEach((max, i) => {
        const ch = json(`orig/${book}/${i + 1}.json`)
        expect(ch.l, book).toBe(ot.has(book) ? 'H' : 'G')
        for (const [v, ws] of Object.entries(ch.v) as [string, string[][]][]) {
          expect(+v >= (book === 'Ps' ? 0 : 1) && +v <= max, `${book} ${i + 1}:${v}`).toBe(true)
          words += ws.length
        }
      })
    }
    expect(words).toBeGreaterThan(440_000)
  }, 60000)
  it('Hebrew: actual inflected forms with prefixes, grammar, and Strong numbers (Gen 1:1, Ps 23:1)', () => {
    const g = verse('Gen', 1, 1)
    expect(g[0].slice(0, 5)).toEqual(nfc(['בְּ/רֵאשִׁ֖ית', 'be./re.Shit', 'in/ beginning', 'H9003/{H7225G}', 'HR/HNcfsa']))
    expect(g[1].slice(0, 6)).toEqual(nfc(['בָּרָ֣א', "ba.Ra'", 'he created', '{H1254A}', 'HVqp3ms', 'to create']))
    const shepherd = verse('Ps', 23, 1).find((w) => w[3].includes('H7462'))!
    expect(shepherd[4]).toBe('HVqrmsc/HSp1bs') // participle + "my"
  })
  it('Greek: actual forms, grammar, and which editions contain each word (John 3:16, Mark 16:9)', () => {
    const loved = verse('John', 3, 16).find((w) => w[0] === 'ἠγάπησεν'.normalize('NFC'))!
    expect(loved.slice(3, 8)).toEqual(nfc(['G0025', 'V-AAI-3S', 'ἀγαπάω', 'to love', '']))
    // Mark 16:9-20 is in the Textus Receptus and in critical editions (bracketed), so its words are not flagged
    expect(verse('Mark', 16, 9).length).toBeGreaterThan(5)
    // 1 John 5:7's "three heavenly witnesses" wording is only in the TR
    expect(verse('1John', 5, 7).some((w) => w[7] === 'T')).toBe(true)
  })
  it('Psalm titles are verse 0, matching the KJV title above verse 1', () => {
    expect(verse('Ps', 3, 0)[0][0]).toBe('מִזְמ֥וֹר'.normalize('NFC'))
    expect(json('kjv/Ps/3.json').title).toBeTruthy()
  })
})

describe('grammar explanations come from STEPBible tables, never guessed', () => {
  const H = json('orig/morph-H.json')
  const G = json('orig/morph-G.json')
  it('every grammar code in the text has an expansion', () => {
    for (const [book, chapters] of Object.entries(KJV)) {
      for (let c = 1; c <= chapters.length; c += 7) {
        const ch = json(`orig/${book}/${c}.json`)
        for (const ws of Object.values(ch.v) as string[][][])
          for (const w of ws) {
            const codes = ch.l === 'H' ? w[4].split('/') : w[4].split(' + ').filter((x) => x && !/^G\d/.test(x))
            for (const code of codes) expect((ch.l === 'H' ? H : G)[code], `${book} ${c} ${code}`).toBeTruthy()
          }
      }
    }
  })
  it('readable in beginner and advanced modes', () => {
    expect(grammarText(H.HVqp3ms, 'beginner')).toBe('Verb, Qal (simple, active), Perfect (past/present, indicative), Third, Masculine, Singular')
    expect(grammarText(G['V-AAI-3S'], 'beginner')).toBe('Verb, Aorist, Active, Indicative, 3rd, Singular')
    expect(grammarText(H.HVqp3ms, 'advanced')).toMatch(/^Function: Verb; Stem: Qal \(hence Action=Simple; Voice=Active\)/)
  })
})

describe('BDB and word forms', () => {
  it('BDB entries linked to Strong numbers, with homographs listed separately and status kept', () => {
    const create = json('bdb/H12.json').H1254
    expect(create.length).toBe(2)
    const t = (h: string) => h.replace(/<[^>]+>/g, '')
    expect(t(create[0].h)).toMatch(/shape, create/)
    expect(t(create[1].h)).toMatch(/be fat/)
    for (const e of create) expect(['done', 'base', 'ref', 'made', 'new', 'added']).toContain(e.status)
    const shepherd = json('bdb/H74.json').H7462
    expect(shepherd.some((e: { h: string }) => /pasture, tend, graze/.test(e.h.replace(/<[^>]+>/g, '')))).toBe(true)
  })
  it('BDB text uses only safe markup and real Scripture links', () => {
    for (const f of fs.readdirSync(path.join(DATA, 'bdb'))) {
      for (const recs of Object.values(json(`bdb/${f}`)) as { h: string }[][])
        for (const r of recs) {
          for (const m of r.h.matchAll(/<\/?([a-z]+)/g)) expect(['span', 'b', 'i', 'a'], m[1]).toContain(m[1])
          for (const m of r.h.matchAll(/data-ref="([^".]+)\.(\d+)/g)) expect(KJV[m[1]], m[0]).toBeTruthy()
        }
    }
  })
  it('forms index lists the inflected forms with counts', () => {
    const g25 = Object.fromEntries((json('orig/forms/G0.json').G25 as [string, number][]).map(([f, n]) => [f.normalize('NFC'), n]))
    expect(g25['ἠγάπησεν'.normalize('NFC')]).toBeGreaterThanOrEqual(10)
    const h7225 = json('orig/forms/H72.json').H7225 as [string, number][]
    expect(h7225.length).toBeGreaterThan(0)
  })
})
