import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { passageFiles, customPack } from '../src/lib/packs'

const DATA = path.join(__dirname, '..', 'public', 'data')
const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'packs.json'), 'utf8')) as { packs: { id: string; bytes: number; files: string[]; hash: string }[] }

describe('offline packs manifest', () => {
  it('every listed file exists and the sizes are exact', () => {
    for (const p of manifest.packs) {
      let bytes = 0
      for (const f of p.files) {
        expect(fs.existsSync(path.join(DATA, f)), `${p.id}: ${f}`).toBe(true)
        bytes += fs.statSync(path.join(DATA, f)).size
      }
      expect(bytes, p.id).toBe(p.bytes)
      expect(new Set(p.files).size, `${p.id} has no repeated files`).toBe(p.files.length)
    }
  })
  it('a pack for every book (commentaries and Hebrew/Greek text), plus the library packs', () => {
    const ids = new Set(manifest.packs.map((p) => p.id))
    expect(ids.size).toBe(66 * 2 + 4)
    for (const id of ['comm:Gen', 'orig:Gen', 'comm:Rev', 'orig:Rev', 'lex:H', 'lex:G', 'ref', 'search:comm']) expect(ids.has(id), id).toBe(true)
  })
  it('every commentary note file and every Hebrew/Greek chapter is in a pack', () => {
    const inPacks = new Set(manifest.packs.flatMap((p) => p.files))
    const walk = (dir: string): string[] => fs.readdirSync(path.join(DATA, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]))
    const missing = [...walk('commentary'), ...walk('orig')].filter((f) => !inPacks.has(f) && !/search-report|build-report/.test(f))
    expect(missing).toEqual([])
  })
})

describe('plan and course passages for offline', () => {
  it('lists the KJV chapter files a set of passages needs', () => {
    expect(passageFiles(['Gen.1-Gen.3', 'John.3.16', 'Mark.8.27-Mark.9.13'])).toEqual(['kjv/Gen/1.json', 'kjv/Gen/2.json', 'kjv/Gen/3.json', 'kjv/John/3.json', 'kjv/Mark/8.json', 'kjv/Mark/9.json', 'kjv/index.json'])
    expect(passageFiles(['Ps.23'], 'BSB')).toContain('translations/BSB/Ps.json')
  })
  it('a change in the passages changes the fingerprint (so an update is offered)', () => {
    expect(customPack('x', 'x', ['a']).hash).not.toBe(customPack('x', 'x', ['a', 'b']).hash)
    expect(customPack('x', 'x', ['a']).hash).toBe(customPack('x', 'x', ['a']).hash)
  })
})
