/**
 * Offline research packs manifest (Kaizen Cycle 5): public/data/packs.json
 *
 * Each pack lists its files, their total size, and a fingerprint of their contents, so the app can show
 * download sizes, store exactly these files for offline use, and notice when an update changes a pack.
 * Nothing is downloaded unless the reader asks.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'public', 'data')
const books = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')).map((b) => b.id)
const names = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'books.json'), 'utf8')).map((b) => [b.id, b]))

const list = (dir, filter = () => true) =>
  fs.existsSync(path.join(DATA, dir))
    ? fs
        .readdirSync(path.join(DATA, dir), { recursive: true })
        .map(String)
        .filter((f) => fs.statSync(path.join(DATA, dir, f)).isFile() && filter(f))
        .map((f) => `${dir}/${f.split(path.sep).join('/')}`)
        .sort()
    : []
const exists = (f) => fs.existsSync(path.join(DATA, f))

function pack(id, kind, label, description, files) {
  files = [...new Set(files)].filter(exists).sort()
  const h = crypto.createHash('sha256')
  let bytes = 0
  for (const f of files) {
    const buf = fs.readFileSync(path.join(DATA, f))
    bytes += buf.length
    h.update(f).update('\0').update(crypto.createHash('sha256').update(buf).digest())
  }
  return { id, kind, label, description, bytes, hash: h.digest('hex').slice(0, 16), files }
}

const works = JSON.parse(fs.readFileSync(path.join(DATA, 'commentary', 'index.json'), 'utf8')).works.map((w) => w.id)
const packs = []
for (const b of books) {
  const name = names[b].name
  packs.push(
    pack(`comm:${b}`, 'commentary', `Commentaries on ${name}`, `All ${works.length} commentaries' notes on ${name}, with their introductions.`, [
      'commentary/index.json',
      `commentary/coverage/${b}.json`,
      `commentary/intro/${b}.json`,
      ...works.flatMap((w) => list(`commentary/${w}/${b}`)),
    ]),
  )
  const ot = names[b].testament === 'OT'
  packs.push(pack(`orig:${b}`, 'original', `${ot ? 'Hebrew' : 'Greek'} text of ${name}`, `Every word of ${name} in ${ot ? 'Hebrew' : 'Greek'} with grammar, for word study and the interlinear.`, [`orig/morph-${ot ? 'H' : 'G'}.json`, ...list(`orig/${b}`)]))
}
packs.push(
  pack('lex:H', 'lexicon', 'Hebrew lexicon', "Strong's Hebrew dictionary and concordance, Brown-Driver-Briggs, and the forms each Hebrew word takes.", [
    ...list('strongs', (f) => f.startsWith('H')),
    ...list('concordance', (f) => f.startsWith('H')),
    ...list('bdb'),
    ...list('orig/forms', (f) => f.startsWith('H')),
  ]),
  pack('lex:G', 'lexicon', 'Greek lexicon', "Strong's Greek dictionary and concordance, and the forms each Greek word takes.", [
    ...list('strongs', (f) => f.startsWith('G')),
    ...list('concordance', (f) => f.startsWith('G')),
    ...list('orig/forms', (f) => f.startsWith('G')),
  ]),
  pack('ref', 'reference', 'Dictionary, encyclopedia, and cross-references', 'ISBE, Hitchcock, Webster 1913, the thesaurus, and every cross-reference.', [...list('dict'), ...list('thesaurus'), ...list('xrefs')]),
  pack('search:comm', 'search', 'Commentary search', 'Search all commentaries without a connection (the notes themselves come from the commentary packs).', list('commentary/search')),
)
const out = { format: 'carter-packs', version: 1, packs }
fs.writeFileSync(path.join(DATA, 'packs.json'), JSON.stringify(out))
const total = packs.reduce((a, p) => a + p.bytes, 0)
console.log(`packs: ${packs.length} packs, ${(total / 1e6).toFixed(0)} MB in all, manifest ${(fs.statSync(path.join(DATA, 'packs.json')).size / 1e3).toFixed(0)} KB`)
