import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import books from '../src/lib/books.json'
import { SearchIndex, runSearch, stem, type SearchQuery } from '../src/lib/searchEngine'

const DATA = path.join(__dirname, '..', 'public', 'data')
const BOOKS = books as { id: string; testament: string }[]

/* ---------- reference: the original search, copied unchanged from the version before Cycle 2 ---------- */

interface Row { key: string; book: string; text: string; lower: string }
const segText = (s: [string, number?, number?]) => ((s[1] ?? 0) & 4 ? s[0].toUpperCase() : s[0])
function kjvRows(): Row[] {
  const out: Row[] = []
  for (const b of BOOKS) {
    const book = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', `${b.id}.json`), 'utf8'))
    for (const ch of book.chapters)
      for (const v of ch.verses) {
        const text = v.s.map(segText).join('')
        out.push({ key: `${book.id}.${ch.c}.${v.v}`, book: book.id, text, lower: text.toLowerCase().replace(/[’']/g, "'") })
      }
  }
  return out
}
function translationRows(t: string): Row[] {
  const out: Row[] = []
  for (const b of BOOKS) {
    const c: (string | null)[][] = JSON.parse(fs.readFileSync(path.join(DATA, 'translations', t, `${b.id}.json`), 'utf8')).c
    c.forEach((vs, ci) => vs.forEach((text, vi) => !!text && out.push({ key: `${b.id}.${ci + 1}.${vi + 1}`, book: b.id, text, lower: text.toLowerCase().replace(/[’']/g, "'") })))
  }
  return out
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function referenceSearch(data: Row[], { query, mode, scope, wholeWord, limit }: SearchQuery) {
  const q = query.trim().toLowerCase().replace(/[’']/g, "'")
  let phrase = mode === 'phrase'
  let terms: string[]
  const quoted = /^"(.+)"$/.exec(q)
  if (quoted) {
    phrase = true
    terms = [quoted[1]]
  } else {
    terms = phrase ? [q] : q.split(/\s+/).filter(Boolean)
  }
  const res = terms.map((t) => {
    const body = escapeRe(t).replace(/\\\*/g, '\\w*')
    return new RegExp(wholeWord ? `(?<![\\w'])${body}(?![\\w'])` : body, 'i')
  })
  const ot = new Set(BOOKS.filter((b) => b.testament === 'OT').map((b) => b.id))
  const hits: { key: string; text: string }[] = []
  let total = 0
  for (const r of data) {
    if (scope === 'OT' && !ot.has(r.book)) continue
    if (scope === 'NT' && ot.has(r.book)) continue
    if (scope !== 'all' && scope !== 'OT' && scope !== 'NT' && r.book !== scope) continue
    const ok = mode === 'any' && !phrase ? res.some((re) => re.test(r.lower)) : res.every((re) => re.test(r.lower))
    if (ok) {
      total++
      if (hits.length < limit) hits.push({ key: r.key, text: r.text })
    }
  }
  return { hits, total, terms }
}

/* ---------- the new engine, reading the shipped search files ---------- */

function engine(t: string) {
  const dir = path.join(DATA, 'search', t)
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8')
  const loader = {
    shard: async (k: string) => read(`w/${k}.txt`),
    vocab: async () => read('vocab.txt'),
    page: async (n: number) => read(`p/${n}.txt`).replace(/\n$/, '').split('\n').map((l) => l || null),
  }
  // a fresh index each time, so every query also proves it fetches the letter files it needs
  return (q: SearchQuery) => runSearch(new SearchIndex(read('index.txt')), loader, BOOKS, q)
}

const Q = (query: string, extra: Partial<SearchQuery> = {}): SearchQuery => ({ query, mode: 'all', scope: 'all', wholeWord: true, limit: 100000, ...extra })

// The audit baselines plus a broad spread of operators, filters, punctuation, and edge cases.
const QUERIES: SearchQuery[] = [
  Q('grace'), Q('"living water"'), Q('jesus wept', { mode: 'phrase' }), Q("father's"), Q('lord'), Q('charity', { scope: 'NT' }), Q('believ*'),
  Q('beleive'), Q('god so loved'), Q('LORD'), Q('the lord'), Q('love one another'), Q('love one another', { mode: 'phrase' }),
  Q('faith hope charity', { mode: 'any' }), Q('faith hope charity'), Q('in the beginning', { mode: 'phrase' }), Q('"in the beginning"'),
  Q('beginning', { scope: 'Gen' }), Q('selah', { scope: 'OT' }), Q('selah', { scope: 'NT' }), Q('amen', { scope: 'Rev' }),
  Q('lov*'), Q('*eth'), Q('*'), Q('un*'), Q('bless*', { wholeWord: false }), Q('ove', { wholeWord: false }), Q('love', { wholeWord: false }),
  Q('lord god', { wholeWord: false }), Q("god's"), Q('gods'), Q('isaac’s'), Q("israel's"), Q("children's children"),
  Q('verily, verily', { mode: 'phrase' }), Q('"verily, verily"'), Q('a-b'), Q('i am that i am', { mode: 'phrase' }), Q('alpha omega'),
  Q('666'), Q('12'), Q('three score', { mode: 'phrase' }), Q('jesus christ', { mode: 'any' }), Q('jesus christ', { mode: 'any', scope: 'OT' }),
  Q('"the LORD is my shepherd"'), Q('shepherd', { scope: 'Ps' }), Q('xyzzy'), Q('and'), Q('the', { limit: 100 }), Q('lord', { limit: 100 }),
  Q('ye shall', { mode: 'phrase', wholeWord: false }), Q('he that', { mode: 'any' }), Q('word was god', { mode: 'phrase' }), Q('(selah)'),
  Q('lord.'), Q('lord:'), Q('heaven and earth', { mode: 'phrase', scope: 'NT' }), Q('   grace   '), Q('Grace Peace'), Q('a'), Q('o'),
]

describe('search results are identical to the original search (KJV)', () => {
  const rows = kjvRows()
  const run = engine('KJV')
  for (const q of QUERIES) {
    it(`${JSON.stringify(q.query)} ${q.mode} ${q.scope} whole=${q.wholeWord} limit=${q.limit}`, async () => {
      const want = referenceSearch(rows, q)
      const got = await run(q)
      expect(got.total).toBe(want.total)
      expect(got.terms).toEqual(want.terms)
      expect(got.hits).toEqual(want.hits)
    })
  }
  it('the audit baseline counts are unchanged', async () => {
    const counts = await Promise.all(
      [Q('grace'), Q('"living water"'), Q('jesus wept', { mode: 'phrase' }), Q("father's"), Q('lord'), Q('charity', { scope: 'NT' }), Q('believ*'), Q('god so loved')].map(async (q) => (await run(q)).total),
    )
    expect(counts).toEqual(
      [Q('grace'), Q('"living water"'), Q('jesus wept', { mode: 'phrase' }), Q("father's"), Q('lord'), Q('charity', { scope: 'NT' }), Q('believ*'), Q('god so loved')].map((q) => referenceSearch(rows, q).total),
    )
  })
})

describe('search in other translations', () => {
  for (const t of ['BSB', 'ASV', 'YLT', 'NHEB', 'WBS', 'BBE', 'GNV']) {
    it(`${t}: results match a full scan of the ${t} text`, async () => {
      const rows = translationRows(t)
      const run = engine(t)
      for (const q of [Q('grace'), Q('"in the beginning"'), Q('lov*'), Q('son', { scope: 'NT' }), Q('faith hope', { mode: 'any' }), Q('jehovah'), Q('*')]) {
        const want = referenceSearch(rows, q)
        const got = await run(q)
        expect(got.total, `${t} ${q.query}`).toBe(want.total)
        expect(got.hits, `${t} ${q.query}`).toEqual(want.hits)
      }
    })
  }
  it('BSB: "one and only Son" finds John 3:16', async () => {
    const got = await engine('BSB')(Q('one and only Son', { mode: 'phrase' }))
    expect(got.hits.map((h) => h.key)).toContain('John.3.16')
    expect(got.hits.find((h) => h.key === 'John.3.16')?.text).toMatch(/one and only Son/)
  })
})

describe('spelling suggestions and word forms', () => {
  const run = engine('KJV')
  it('suggests a correction when nothing is found', async () => {
    expect((await run(Q('beleive'))).suggestion).toBe('believe')
    expect((await run(Q('rightousness'))).suggestion).toBe('righteousness')
    expect((await run(Q('grace'))).suggestion).toBeUndefined()
  })
  it('word forms are off unless asked for, and listed when used', async () => {
    const plain = await run(Q('believe'))
    const forms = await run(Q('believe', { forms: true }))
    expect(plain.formsUsed).toEqual([[]])
    expect(forms.formsUsed[0]).toEqual(expect.arrayContaining(['believed', 'believeth', 'believing']))
    expect(forms.total).toBeGreaterThan(plain.total)
  })
  it('exact phrases are never broadened', async () => {
    const a = await run(Q('"believe on"'))
    const b = await run(Q('"believe on"', { forms: true }))
    expect(b.total).toBe(a.total)
    expect(b.formsUsed).toEqual([[]])
  })
  it('stemmer groups common KJV endings', () => {
    for (const w of ['believe', 'believed', 'believeth', 'believing', 'believest']) expect(stem(w)).toBe('believ')
    for (const w of ['pray', 'prayed', 'prayeth', 'praying', 'prayer']) expect(stem(w)).toBe('pray')
  })
})
