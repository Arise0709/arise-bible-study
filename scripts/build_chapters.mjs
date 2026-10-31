/**
 * Split each KJV book file into one file per chapter, so the reader downloads only the chapter it shows
 * (John 3 is about 7 KB compressed; the whole of John is 146 KB).
 *
 * Output: public/data/kjv/{Book}/{chapter}.json, each exactly the chapter object from kjv/{Book}.json
 * (text, word tags, margin notes, Psalm titles). The book files stay for features that need a whole book.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const KJV = path.join(ROOT, 'public', 'data', 'kjv')
const BOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'books.json'), 'utf8'))

let files = 0
for (const b of BOOKS) {
  const book = JSON.parse(fs.readFileSync(path.join(KJV, `${b.id}.json`), 'utf8'))
  const dir = path.join(KJV, b.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir)
  book.chapters.forEach((ch, i) => {
    if (ch.c !== i + 1) throw new Error(`${b.id}: chapter ${ch.c} is out of order`)
    fs.writeFileSync(path.join(dir, `${ch.c}.json`), JSON.stringify(ch))
    files++
  })
}
console.log(`${files} chapter files written`)
