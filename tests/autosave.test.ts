import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

// minimal localStorage for the Node test environment
const store = new Map<string, string>()
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: new Proxy(ls, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (_t, k) => (store.has(String(k)) ? { enumerable: true, configurable: true, value: store.get(String(k)) } : undefined) }), configurable: true })

const { db, emptyWorksheet } = await import('../src/db/db')
const { recoverPendingEdits } = await import('../src/lib/autosave')

const study = (id: string, title: string, updatedAt: number) => ({ id, title, passage: 'John.3.16', sections: emptyWorksheet(), tags: [], createdAt: 1, updatedAt })

describe('autosave recovery (safety copies)', () => {
  beforeEach(async () => {
    store.clear()
    await db.studies.clear()
    await db.sermons.clear()
  })
  it('restores an edit that never reached the database', async () => {
    await db.studies.put(study('s1', 'Old title', 1000))
    localStorage.setItem('abs-pending:studies:s1', JSON.stringify({ at: 2000, value: study('s1', 'Typed before closing', 1000) }))
    expect(await recoverPendingEdits()).toBe(1)
    expect((await db.studies.get('s1'))?.title).toBe('Typed before closing')
    expect(localStorage.getItem('abs-pending:studies:s1')).toBeNull()
  })
  it('never overwrites a newer saved record with an older copy', async () => {
    await db.studies.put(study('s2', 'Saved later', 5000))
    localStorage.setItem('abs-pending:studies:s2', JSON.stringify({ at: 3000, value: study('s2', 'Stale copy', 1) }))
    expect(await recoverPendingEdits()).toBe(0)
    expect((await db.studies.get('s2'))?.title).toBe('Saved later')
  })
  it('ignores unrelated keys and broken entries', async () => {
    localStorage.setItem('abs-settings', '{"theme":"dark"}')
    localStorage.setItem('abs-pending:notes:x', '{}')
    localStorage.setItem('abs-pending:studies:s3', 'not json')
    expect(await recoverPendingEdits()).toBe(0)
    expect(localStorage.getItem('abs-settings')).toBe('{"theme":"dark"}')
  })
})

const { guardedPut, ConflictError } = await import('../src/lib/autosave')

describe('edits in two tabs never overwrite each other (M1)', () => {
  beforeEach(async () => {
    store.clear()
    await db.studies.clear()
  })
  it('saves normally when nothing else changed the record', async () => {
    await db.studies.put(study('s1', 'Start', 1000))
    const base = { current: 1000 }
    await guardedPut('studies', study('s1', 'Edited here', 1000), base)
    expect((await db.studies.get('s1'))?.title).toBe('Edited here')
    expect(base.current).toBeGreaterThan(1000)
    await guardedPut('studies', study('s1', 'Edited again', 1000), base)
    expect((await db.studies.get('s1'))?.title).toBe('Edited again')
  })
  it('refuses to overwrite a newer version from another tab, and writes nothing', async () => {
    await db.studies.put(study('s1', 'Start', 1000))
    const tabA = { current: 1000 }
    const tabB = { current: 1000 }
    await guardedPut('studies', study('s1', 'Tab B wrote this', 1000), tabB)
    const err = await guardedPut('studies', study('s1', 'Tab A wrote this', 1000), tabA).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.theirs.title).toBe('Tab B wrote this')
    expect((await db.studies.get('s1'))?.title).toBe('Tab B wrote this')
  })
  it('treats a record deleted in another tab as a conflict, not a silent re-create', async () => {
    const err = await guardedPut('studies', study('gone', 'x', 1), { current: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.theirs).toBeNull()
    expect(await db.studies.get('gone')).toBeUndefined()
  })
  it('a leftover safety copy never overwrites a change made in another tab; it becomes a separate copy', async () => {
    await db.studies.put(study('s1', 'Other tab saved this later', 3000))
    store.set('abs-pending:studies:s1', JSON.stringify({ at: 2500, base: 1000, value: study('s1', 'My edit', 1000) }))
    expect(await recoverPendingEdits()).toBe(1)
    expect((await db.studies.get('s1'))?.title).toBe('Other tab saved this later')
    const all = await db.studies.toArray()
    expect(all.map((s) => s.title).sort()).toEqual(['My edit (recovered copy)', 'Other tab saved this later'])
  })
  it('old safety copies (from before this change) still restore as before', async () => {
    await db.studies.put(study('s1', 'Old', 1000))
    store.set('abs-pending:studies:s1', JSON.stringify({ at: 2000, value: study('s1', 'Newer edit', 1000) }))
    expect(await recoverPendingEdits()).toBe(1)
    expect((await db.studies.get('s1'))?.title).toBe('Newer edit')
  })
})
