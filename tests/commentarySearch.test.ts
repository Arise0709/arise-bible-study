import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { plain, queryTerms, searchCommentaries, tokens, makeSnippet, type CommentaryQuery } from '../src/lib/commentarySearch'
// @ts-expect-error plain JavaScript build script
import { plain as buildPlain, tokens as buildTokens } from '../scripts/build_commentary_search.mjs'

const DATA = path.join(__dirname, '..', 'public', 'data')
const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'commentary', 'search', 'meta.json'), 'utf8'))
const OT = new Set((JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'books.json'), 'utf8')) as { id: string; testament: string }[]).filter((b) => b.testament === 'OT').map((b) => b.id))

beforeAll(() => {
  // serve /data/... from the files on disk, as the deployed site does
  globalThis.fetch = (async (url: string) => {
    const p = path.join(DATA, String(url).replace(/^\/data\//, ''))
    if (!fs.existsSync(p)) return new Response('not found', { status: 404 })
    return new Response(fs.readFileSync(p), { status: 200, headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'text/plain' } })
  }) as typeof fetch
})

/** Every note in index order, read straight from the chapter files (the brute-force reference). */
const notes = (() => {
  let cached: { doc: number; work: string; book: string; chapter: number; v1: number; text: string }[] | null = null
  return () => {
    if (cached) return cached
    cached = []
    let doc = 0
    for (const [wi, bi, c] of meta.groups as [number, number, number, number][]) {
      const ch = JSON.parse(fs.readFileSync(path.join(DATA, 'commentary', meta.works[wi], meta.books[bi], `${c}.json`), 'utf8'))
      for (const e of ch.e) cached.push({ doc: doc++, work: meta.works[wi], book: meta.books[bi], chapter: c, v1: e[0], text: plain(e[2]) })
    }
    return cached
  }
})()

function brute(q: CommentaryQuery): number[] {
  const terms = queryTerms(q.query)
  const m = (w: string, t: string) => (t.endsWith('*') ? w.startsWith(t.slice(0, -1)) : w === t)
  return notes()
    .filter((n) => (!q.works.length || q.works.includes(n.work)) && (q.scope === 'all' || (q.scope === 'OT' ? OT.has(n.book) : q.scope === 'NT' ? !OT.has(n.book) : n.book === q.scope)))
    .filter((n) => {
      const t = tokens(n.text)
      if (q.mode === 'any') return terms.some((x) => t.some((w) => m(w, x)))
      if (q.mode === 'phrase' && terms.length > 1) {
        for (let i = 0; i + terms.length <= t.length; i++) if (terms.every((x, j) => m(t[i + j], x))) return true
        return false
      }
      return terms.every((x) => t.some((w) => m(w, x)))
    })
    .map((n) => n.doc)
}

async function all(q: CommentaryQuery) {
  let r = await searchCommentaries(q, 50)
  while (!r.done) r = await r.more(500)
  return r
}

describe('commentary search: same words as the index builder', () => {
  it('splits text exactly like the builder', () => {
    const samples = ['Jesus wept.', 'Nicodemus’ question: “How can a man be born when he is old?”', 'ἀγαπάω, ἠγάπησεν; בְּרֵאשִׁית', 'Ver. 3. &amp; the &quot;Word&quot; <i>was</i> God', "the Lord's day, 1 Cor. 16:2"]
    for (const s of samples) expect(tokens(plain(s))).toEqual(buildTokens(buildPlain(s)))
    expect(tokens('ἠγάπησεν')).toEqual(['ηγαπησεν'])
  })
})

describe('commentary search: results match a full scan of every note', () => {
  const cases: CommentaryQuery[] = [
    { query: 'Nicodemus', mode: 'all', works: [], scope: 'all' },
    { query: 'born again', mode: 'phrase', works: [], scope: 'all' },
    { query: 'Melchizedek Melchisedec', mode: 'any', works: [], scope: 'all' },
    { query: 'justif*', mode: 'all', works: ['Clarke'], scope: 'NT' },
    { query: 'the love of God', mode: 'phrase', works: ['MHCC'], scope: 'John' },
    { query: 'covenant grace', mode: 'all', works: ['JFB', 'KD'], scope: 'OT' },
    // frequent-word phrases use the word-pair entries; word beginnings must never pick up pair entries
    { query: 'the kingdom of heaven', mode: 'phrase', works: ['Scofield', 'MHCC'], scope: 'Matt' },
    { query: 'love*', mode: 'all', works: ['Scofield'], scope: 'NT' },
  ]
  for (const q of cases) {
    it(`${q.mode} "${q.query}" in ${q.works.join(', ') || 'all commentaries'}, ${q.scope}`, async () => {
      const r = await all(q)
      const want = brute(q)
      expect(r.total).toBe(want.length)
      expect([...r.hits.map((h) => h.doc)].sort((a, b) => a - b)).toEqual(want)
      expect(new Set(r.hits.map((h) => h.doc)).size, 'no duplicate results').toBe(r.hits.length)
      for (const h of r.hits.slice(0, 30)) {
        expect(q.works.length ? q.works.includes(h.work) : true).toBe(true)
        expect(h.marks.length, `${h.work} ${h.book} ${h.chapter}:${h.v1} has a highlighted match`).toBeGreaterThan(0)
      }
      // repeatable: the same search gives the same list in the same order
      const again = await all(q)
      expect(again.hits.map((h) => h.doc)).toEqual(r.hits.map((h) => h.doc))
    }, 120000)
  }
  it('results are in Bible order, then commentary order', async () => {
    const r = await all({ query: 'Nicodemus', mode: 'all', works: [], scope: 'all' })
    const books = (JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')) as { id: string }[]).map((b) => b.id)
    const key = (h: { book: string; chapter: number; work: string }) => [books.indexOf(h.book), h.chapter, meta.works.indexOf(h.work)]
    for (let i = 1; i < r.hits.length; i++) {
      const [a, b] = [key(r.hits[i - 1]), key(r.hits[i])]
      expect(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])))).toBe(true)
    }
    expect(r.hits.some((h) => h.book === 'John' && h.chapter === 3)).toBe(true)
  }, 120000)
  it('a word in no note finds nothing; an empty query finds nothing', async () => {
    expect((await all({ query: 'xylophonequark', mode: 'all', works: [], scope: 'all' })).total).toBe(0)
    expect((await all({ query: '  ', mode: 'all', works: [], scope: 'all' })).total).toBe(0)
  })
})

describe('snippets', () => {
  it('marks the matched words in the original wording', () => {
    const s = makeSnippet('He said, “Ye must be born again.” Then Nicodemus answered.', ['born', 'again'], true)
    expect(s.marks.map(([a, b]) => s.snippet.slice(a, b))).toEqual(['born again'])
    const t = makeSnippet('Justification by faith; justified freely.', ['justif*'], false)
    expect(t.marks.map(([a, b]) => t.snippet.slice(a, b))).toEqual(['Justification', 'justified'])
  })
})
