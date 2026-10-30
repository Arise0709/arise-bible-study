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
