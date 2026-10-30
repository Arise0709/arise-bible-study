import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyWorksheet } from '../src/db/db'
import { BackupError, applyBackup, exportBackup, parseBackup } from '../src/db/backup'

const note = (id: string, text: string, updatedAt: number) => ({ id, ref: 'John.3.16', book: 'John', startKey: 42003016, endKey: 42003016, text, tags: ['t'], createdAt: 1, updatedAt })
const study = (id: string, title: string, updatedAt: number) => ({ id, title, passage: 'John.3.16', sections: emptyWorksheet(), tags: [], createdAt: 1, updatedAt })
const file = (data: Record<string, unknown[]>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: 'arise-bible-study-backup', version: 1, exportedAt: '2026-10-01T10:00:00.000Z', data, ...extra })

async function clearAll() {
  for (const t of ['highlights', 'bookmarks', 'notes', 'dict', 'studies', 'sermons', 'folders', 'settings', 'sessions']) await db.table(t).clear()
}

describe('backup validation', () => {
  it('rejects files that are not backups', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError)
    expect(() => parseBackup('{"format":"something-else","data":{}}')).toThrow(/not an Arise Bible Study backup/)
    expect(() => parseBackup(file({}, { version: 99 }))).toThrow(/newer version/)
  })
  it('skips damaged items and reports them, keeps good ones', () => {
    const p = parseBackup(file({ notes: [note('n1', 'good', 1), { id: 'n2' }, null, 'junk'], highlights: [{ id: 'h1', key: 'John.3.16', book: 'John', color: 'yellow' }, { id: 'h2', key: 'bad key', book: 'John', color: 'x' }] }))
    expect(p.rows.notes.map((r) => r.id)).toEqual(['n1'])
    expect(p.tables.find((t) => t.table === 'notes')).toMatchObject({ valid: 1, skipped: 3 })
    expect(p.rows.highlights.map((r) => r.id)).toEqual(['h1'])
    expect(p.skippedTotal).toBe(4)
    expect(p.warnings.join(' ')).toMatch(/4 damaged or incomplete items will be skipped/)
  })
  it('never restores device-only settings (last backup date)', () => {
    const p = parseBackup(file({ settings: [{ key: 'settings', value: { theme: 'dark' } }, { key: 'lastBackupAt', value: 1 }] }))
    expect(p.rows.settings.map((r) => r.key)).toEqual(['settings'])
    expect(p.skippedTotal).toBe(0)
  })
})

describe('backup restore', () => {
  beforeEach(clearAll)

  it('round-trips everything the current app exports (backward-compatible format)', async () => {
    await db.notes.put(note('n1', 'my note', 5))
    await db.studies.put(study('s1', 'Romans study', 5))
    await db.highlights.put({ id: 'h1', key: 'Rom.8.28', book: 'Rom', color: 'green', createdAt: 1 })
    await db.bookmarks.put({ id: 'b1', key: 'Ps.23.1', book: 'Ps', label: 'Psalms 23:1', createdAt: 1 })
    await db.settings.put({ key: 'settings', value: { theme: 'dark' } })
    const text = await (await exportBackup()).text()
    const json = JSON.parse(text)
    expect(json.format).toBe('arise-bible-study-backup')
    expect(json.version).toBe(1)
    await clearAll()
    const r = await applyBackup(parseBackup(text), 'merge')
    expect(r.added).toBe(5)
    expect((await db.notes.get('n1'))?.text).toBe('my note')
    expect((await db.studies.get('s1'))?.title).toBe('Romans study')
    expect((await db.highlights.get('h1'))?.color).toBe('green')
    expect((await db.settings.get('settings'))?.value).toEqual({ theme: 'dark' })
  })

  it('merge keeps the newer copy and never deletes', async () => {
    await db.notes.put(note('n1', 'edited on this device', 200))
    await db.notes.put(note('n2', 'only on this device', 1))
    await db.studies.put(study('s1', 'old title', 10))
    const p = parseBackup(file({ notes: [note('n1', 'older backup copy', 100), note('n3', 'only in backup', 1)], studies: [study('s1', 'newer title from backup', 50)] }))
    const r = await applyBackup(p, 'merge')
    expect((await db.notes.get('n1'))?.text).toBe('edited on this device')
    expect((await db.notes.get('n2'))?.text).toBe('only on this device')
    expect((await db.notes.get('n3'))?.text).toBe('only in backup')
    expect((await db.studies.get('s1'))?.title).toBe('newer title from backup')
    expect(r).toMatchObject({ added: 1, updated: 1, kept: 1, removed: 0 })
  })

  it('merge does not crash when a verse already has a highlight (one highlight per verse)', async () => {
    await db.highlights.put({ id: 'here', key: 'John.3.16', book: 'John', color: 'yellow', createdAt: 1 })
    const p = parseBackup(file({ highlights: [{ id: 'from-backup', key: 'John.3.16', book: 'John', color: 'blue', createdAt: 1 }, { id: 'h2', key: 'John.3.17', book: 'John', color: 'pink', createdAt: 1 }] }))
    const r = await applyBackup(p, 'merge')
    expect((await db.highlights.get('here'))?.color).toBe('yellow')
    expect(await db.highlights.get('from-backup')).toBeUndefined()
    expect((await db.highlights.get('h2'))?.color).toBe('pink')
    expect(r.kept).toBe(1)
  })

  it('replace swaps in the backup but keeps device-only settings', async () => {
    await db.notes.put(note('n-current', 'current', 1))
    await db.settings.put({ key: 'lastBackupAt', value: 123 })
    await db.settings.put({ key: 'settings', value: { theme: 'light' } })
    const p = parseBackup(file({ notes: [note('n-backup', 'from backup', 1)], settings: [{ key: 'settings', value: { theme: 'dark' } }] }))
    const r = await applyBackup(p, 'replace')
    expect(await db.notes.get('n-current')).toBeUndefined()
    expect((await db.notes.get('n-backup'))?.text).toBe('from backup')
    expect((await db.settings.get('settings'))?.value).toEqual({ theme: 'dark' })
    expect((await db.settings.get('lastBackupAt'))?.value).toBe(123)
    expect(r.removed).toBeGreaterThan(0)
  })

  it('is all-or-nothing: a failure leaves current data untouched', async () => {
    await db.notes.put(note('keep', 'precious', 1))
    const p = parseBackup(file({ notes: [note('n2', 'x', 1)] }))
    // sabotage one row after validation so the write fails mid-transaction
    p.rows.studies = [{ id: undefined } as unknown as Record<string, unknown>]
    await expect(applyBackup(p, 'replace')).rejects.toBeTruthy()
    expect((await db.notes.get('keep'))?.text).toBe('precious')
    expect(await db.notes.get('n2')).toBeUndefined()
  })
})
