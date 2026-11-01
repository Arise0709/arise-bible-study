import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromStrongsPron, respellGreek, respellHebrew } from '../src/lib/pronounce'

const DATA = path.join(__dirname, '..', 'public', 'data')
const json = (p: string) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'))
const OK = /^[a-zA-Z]+(-[a-zA-Z]+)*( [a-zA-Z]+(-[a-zA-Z]+)*)*$/

describe('pronunciation guide (classroom style)', () => {
  it('respells familiar words with the stressed syllable in capitals', () => {
    expect(respellGreek('agapáō')?.display).toBe('ah-gah-PAH-oh')
    expect(respellGreek('lógos')?.display).toBe('LOH-gohs')
    expect(respellGreek('pneûma')?.display).toBe('PNYOO-mah')
    expect(respellGreek('Christós')?.display).toBe('khrees-TOHS')
    expect(respellHebrew("ba.Ra'")?.display).toBe('bah-RAH')
    expect(respellHebrew('be./re.Shit')?.display).toBe('beh-reh-SHEET')
    expect(respellHebrew('ha.Sha.Ma.yim')?.display).toBe('hah-shah-MAH-yeem')
    expect(fromStrongsPron("ray-sheeth'")?.display).toBe('ray-SHEETH')
  })
  it('the spoken form is lower case, so voices never spell it out letter by letter', () => {
    expect(respellGreek('agapáō')?.speak).toBe('ah-gah-pah-oh')
    expect(fromStrongsPron("ray-sheeth'")?.speak).toBe('ray-sheeth')
  })
  it("every Strong's entry has a pronunciation (Strong's own for Hebrew, from the transliteration for Greek)", () => {
    let n = 0
    const missing: string[] = []
    for (const f of fs.readdirSync(path.join(DATA, 'strongs'))) {
      for (const [id, e] of Object.entries(json(`strongs/${f}`)) as [string, { pron: string; xlit: string; lang: string }][]) {
        const r = e.pron ? fromStrongsPron(e.pron) : e.lang === 'Greek' && e.xlit ? respellGreek(e.xlit) : null
        if (!r) missing.push(id)
        else {
          expect(r.speak, `${id} ${e.pron || e.xlit}`).toMatch(/^[a-z' -]+$/)
          n++
        }
      }
    }
    expect(n).toBeGreaterThan(14000)
    expect(missing.length, missing.slice(0, 10).join(' ')).toBeLessThan(50)
  })
  it('every word of the Hebrew and Greek text gets a speakable respelling', () => {
    const bad: string[] = []
    let n = 0
    for (const book of fs.readdirSync(path.join(DATA, 'orig'))) {
      if (!fs.statSync(path.join(DATA, 'orig', book)).isDirectory() || book === 'forms') continue
      for (const f of fs.readdirSync(path.join(DATA, 'orig', book))) {
        const ch = json(`orig/${book}/${f}`)
        for (const ws of Object.values(ch.v) as string[][][])
          for (const w of ws) {
            const r = ch.l === 'H' ? respellHebrew(w[1]) : respellGreek(w[1])
            n++
            if (!r || !OK.test(r.speak)) bad.push(`${book} ${f} ${w[1]} -> ${r?.speak}`)
          }
      }
    }
    expect(n).toBeGreaterThan(440000)
    expect(bad.length, bad.slice(0, 10).join(' | ')).toBe(0)
  }, 120000)
})
