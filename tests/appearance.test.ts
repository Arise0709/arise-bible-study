import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ACCENTS } from '../src/lib/appearance'

const lum = (hex: string) => {
  const c = hex.replace('#', '').match(/../g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

describe('color themes are readable (WCAG AA, 4.5:1 for text)', () => {
  for (const a of ACCENTS) {
    it(`${a.label}: links and buttons readable on every page color, light and dark`, () => {
      for (const bg of ['#ffffff', '#f7f5f0', '#f4ecd8', '#fbf6ea']) expect(contrast(a.light, bg)).toBeGreaterThanOrEqual(4.5)
      for (const bg of ['#15181c', '#1d2126']) expect(contrast(a.dark, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(a.light, '#ffffff')).toBeGreaterThanOrEqual(4.5) // white text on accent buttons
    })
  }
})

describe('translations', () => {
  const DATA = path.join(__dirname, '..', 'public', 'data')
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', 'index.json'), 'utf8')) as { id: string; license: string; verses: number }[]
  const kjv = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')) as { id: string; chapters: number[] }[]
  it('ships the expected public-domain translations with licenses', () => {
    expect(idx.map((t) => t.id)).toEqual(['BSB', 'NHEB', 'ASV', 'YLT', 'WBS', 'BBE', 'GNV'])
    for (const t of idx) expect(t.license).toMatch(/public domain|CC0/i)
  })
  it('every translation has all 66 books with the same chapter counts as the KJV', () => {
    for (const t of idx) {
      for (const b of kjv) {
        const d = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', t.id, `${b.id}.json`), 'utf8'))
        expect(d.c.length, `${t.id} ${b.id}`).toBe(b.chapters.length)
      }
      expect(t.verses).toBeGreaterThanOrEqual(31102)
    }
  })
  it('spot checks exact text', () => {
    const bsb = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', 'BSB', 'John.json'), 'utf8'))
    expect(bsb.c[2][15]).toBe('For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.')
  })
})
