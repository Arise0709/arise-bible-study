/**
 * Whole-library commentary search index (Kaizen Cycle 5).
 *
 * Reads the commentary chapter files (public/data/commentary/{ID}/{Book}/{c}.json) and writes:
 *   commentary/search/meta.json   the works, books, and every chapter group in index order (each note's
 *                                 number is its position in this order), the word ranges of each shard,
 *                                 and the most common words
 *   commentary/search/w/{n}.txt   "word id,delta,delta..." lines, sorted by word: which notes contain it.
 *                                 Also "word1_word2" lines: notes where word2 directly follows word1, for every
 *                                 pair of frequent words (both in more than PAIR_DF notes). Exact phrases made of
 *                                 frequent words ("the love of God") would otherwise need thousands of notes read.
 *
 * The note text itself is not copied: results and exact-phrase checks read the same chapter files the
 * commentary panel shows, so wording and citations can never drift from the source files.
 * Words are split exactly as the app splits them (tokens() below is shared with src/lib/commentarySearch.ts
 * and tests check both agree).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public', 'data')
const OUT = path.join(DATA, 'commentary', 'search')
const SHARD_BYTES = 250_000
const PAIR_DF = 1000
const COMMON = 0.3 // words in more than 30% of notes are listed so searches can skip fetching them when other words narrow better

/** Plain text of a note: tags removed, entities decoded. */
export function plain(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
}

/** Lower case, accents and Hebrew/Greek marks removed, curly apostrophes made straight; words of letters and digits. */
export function tokens(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/[’‘]/g, "'")
  return t.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
}

const b36 = (n) => n.toString(36)

function main() {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'commentary', 'index.json'), 'utf8'))
  const books = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')).map((b) => b.id)
  const works = index.works.map((w) => w.id)
  const groups = []
  const post = new Map()
  const seen = new Map()
  const docTokens = [] // per indexed note, for the pair pass
  const duplicates = []
  let doc = 0
  for (const [wi, w] of works.entries()) {
    for (const [bi, b] of books.entries()) {
      const dir = path.join(DATA, 'commentary', w, b)
      if (!fs.existsSync(dir)) continue
      const chapters = fs
        .readdirSync(dir)
        .map((f) => f.replace(/\.json$/, ''))
        .filter((f) => /^\d+$/.test(f))
        .map(Number)
        .sort((a, b) => a - b)
      for (const c of chapters) {
        const ch = JSON.parse(fs.readFileSync(path.join(dir, `${c}.json`), 'utf8'))
        groups.push([wi, bi, c, ch.e.length])
        for (const e of ch.e) {
          const text = plain(e[2])
          // the same note at the same place printed twice is indexed once, so it can't show up as two results.
          // The same wording at different verses (e.g. Scofield's chain notes) is a different passage link and is kept.
          const key = `${w}\u0000${b}.${c}.${e[0]}-${e[1]}\u0000${text.replace(/\s+/g, ' ').trim()}`
          if (seen.has(key)) duplicates.push(`${w} ${b} ${c}:${e[0]}-${e[1]} repeats note #${seen.get(key)} at the same place`)
          else {
            seen.set(key, doc)
            const toks = tokens(text)
            docTokens.push([doc, toks])
            for (const word of new Set(toks)) {
              let list = post.get(word)
              if (!list) post.set(word, (list = []))
              list.push(doc)
            }
          }
          doc++
        }
      }
    }
  }
  // pairs of frequent words
  const df = (w) => post.get(w)?.length ?? 0
  const freq = new Set([...post.keys()].filter((w) => df(w) > PAIR_DF))
  let pairs = 0
  for (const [d, toks] of docTokens) {
    const here = new Set()
    for (let i = 0; i + 1 < toks.length; i++) if (freq.has(toks[i]) && freq.has(toks[i + 1])) here.add(`${toks[i]}_${toks[i + 1]}`)
    for (const k of here) {
      let list = post.get(k)
      if (!list) (post.set(k, (list = [])), pairs++)
      list.push(d)
    }
  }
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT, 'w'), { recursive: true })
  const words = [...post.keys()].sort()
  const shards = []
  let buf = []
  let size = 0
  const flush = () => {
    if (!buf.length) return
    const n = shards.length
    fs.writeFileSync(path.join(OUT, 'w', `${n}.txt`), buf.join('\n') + '\n')
    shards.push(buf[0].slice(0, buf[0].indexOf(' ')))
    buf = []
    size = 0
  }
  for (const word of words) {
    const ids = post.get(word)
    let prev = -1
    const line = `${word} ${ids.map((id) => b36(id - prev - 1, (prev = id))).join(',')}`
    if (size + line.length > SHARD_BYTES && buf.length) flush()
    buf.push(line)
    size += line.length + 1
  }
  flush()
  const common = words.filter((w) => !w.includes('_') && post.get(w).length > COMMON * doc)
  const meta = { format: 'carter-commentary-search', version: 1, docs: doc, works, books, groups, shards, common, pairDf: PAIR_DF, frequent: [...freq].sort() }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta))
  fs.writeFileSync(path.join(DATA, 'commentary', 'search-report.json'), JSON.stringify({ notes: doc, words: words.length - pairs, pairs, shards: shards.length, duplicatesSkipped: duplicates.length, duplicates }, null, 1))
  console.log(`commentary search: ${doc} notes, ${words.length - pairs} words, ${pairs} word pairs, ${shards.length} shards, ${duplicates.length} notes repeated at the same place indexed once`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
