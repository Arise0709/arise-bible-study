import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import books from '../src/lib/books.json'

const KJV = path.join(__dirname, '..', 'public', 'data', 'kjv')

describe('KJV chapter files', () => {
  it('every chapter file is exactly the chapter from its book file (text, word tags, notes, titles)', () => {
    let n = 0
    for (const b of books as { id: string }[]) {
      const book = JSON.parse(fs.readFileSync(path.join(KJV, `${b.id}.json`), 'utf8'))
      const files = fs.readdirSync(path.join(KJV, b.id))
      expect(files.length, b.id).toBe(book.chapters.length)
      for (const ch of book.chapters) {
        expect(JSON.parse(fs.readFileSync(path.join(KJV, b.id, `${ch.c}.json`), 'utf8')), `${b.id} ${ch.c}`).toEqual(ch)
        n++
      }
    }
    expect(n).toBe(1189)
  })
})
