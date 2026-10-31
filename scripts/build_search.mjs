/**
 * Build compact search files for every translation (run after the Bible data is built).
 *
 * Output, per translation ID, in public/data/search/{ID}/:
 *   index.txt     verse layout (books, chapters, verse counts) and the list of word files
 *   w/{c}.txt     which verses contain each word, one file per first letter, so a search downloads only
 *                 the letters it needs ("grace" needs w/g.txt)
 *   vocab.txt     every word with its verse count, for spelling suggestions
 *   p/{n}.txt     verse text in pages of 64 verses, one line per verse (empty line = verse not in this
 *                 translation), so showing results downloads only the pages that hold them
 *
 * Verses are numbered by "slot": books in canonical order, chapters in order, verse 1..n in each chapter.
 * A translation that lacks a verse keeps an empty slot so numbering always matches its reading files.
 *
 * Words are lower-cased runs of letters, digits, underscores, and apostrophes, exactly the characters the
 * search treats as part of a word, so a whole-word search can be answered from this index alone.
 * The KJV text is produced with the same rule the search has always used (divine name in capitals).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA = path.join(ROOT, 'public', 'data')
const OUT = path.join(DATA, 'search')
const BOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'books.json'), 'utf8'))

/** Same rule the KJV search has always used to turn tagged segments into plain text. */
const segText = (s) => ((s[1] ?? 0) & 4 ? s[0].toUpperCase() : s[0])
export const lowerForSearch = (t) => t.toLowerCase().replace(/[’']/g, "'")

function kjvBooks() {
  return BOOKS.map((b) => {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', `${b.id}.json`), 'utf8'))
    return {
      id: b.id,
      chapters: j.chapters.map((ch, ci) => {
        const out = []
        for (const v of ch.verses) {
          if (v.v !== out.length + 1) throw new Error(`KJV ${b.id} ${ci + 1}: verse ${v.v} out of order`)
          out.push(v.s.map(segText).join(''))
        }
        return out
      }),
    }
  })
}

function translationBooks(id) {
  return BOOKS.map((b) => ({ id: b.id, chapters: JSON.parse(fs.readFileSync(path.join(DATA, 'translations', id, `${b.id}.json`), 'utf8')).c }))
}

const PAGE = 64
const shardOf = (w) => (/[a-z0-9]/.test(w[0]) ? w[0] : '_')

function buildIndex(id, books) {
  const words = new Map()
  const layout = []
  let slot = 0
  for (const b of books) {
    layout.push(`@${b.id} ${b.chapters.map((c) => c.length).join(',')}`)
    for (const ch of b.chapters) {
      for (const text of ch) {
        // an empty verse (e.g. Matt 17:21 in the BSB, which omits it) is treated as not in the translation
        if (text) {
          if (/[\r\n]/.test(text)) throw new Error(`${id} ${b.id}: verse text contains a line break`)
          for (const m of lowerForSearch(text).matchAll(/[\w']+/g)) {
            let list = words.get(m[0])
            if (!list) words.set(m[0], (list = []))
            if (list[list.length - 1] !== slot) list.push(slot)
          }
        }
        slot++
      }
    }
  }
  const dir = path.join(OUT, id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'w'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'p'), { recursive: true })
  const shards = new Map()
  const vocab = []
  for (const w of [...words.keys()].sort()) {
    let prev = -1
    const list = words.get(w)
    const k = shardOf(w)
    if (!shards.has(k)) shards.set(k, [])
    shards.get(k).push(`${w} ${list.map((s) => { const d = s - prev; prev = s; return d.toString(36) }).join(',')}`)
    vocab.push(`${w} ${list.length}`)
  }
  for (const [k, lines] of shards) fs.writeFileSync(path.join(dir, 'w', `${k}.txt`), lines.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'vocab.txt'), vocab.join('\n') + '\n')
  const all = books.flatMap((b) => b.chapters.flat())
  for (let n = 0; n * PAGE < all.length; n++) fs.writeFileSync(path.join(dir, 'p', `${n}.txt`), all.slice(n * PAGE, (n + 1) * PAGE).map((t) => t || '').join('\n') + '\n')
  const head = [`#carter-search 2 ${id} ${slot} ${PAGE}`, `#shards ${[...shards.keys()].sort().join(',')}`, ...layout]
  fs.writeFileSync(path.join(dir, 'index.txt'), head.join('\n') + '\n')
  return { slots: slot, words: words.size, shards: shards.size, pages: Math.ceil(all.length / PAGE) }
}

function main() {
  console.log('KJV', buildIndex('KJV', kjvBooks()))
  for (const t of JSON.parse(fs.readFileSync(path.join(DATA, 'translations', 'index.json'), 'utf8'))) console.log(t.id, buildIndex(t.id, translationBooks(t.id)))
}

main()
