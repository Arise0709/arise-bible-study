/**
 * Two devices syncing through a real Supabase stack (dev/supabase-local, or a preview project).
 * Skipped unless SUPABASE_URL and SUPABASE_ANON_KEY are set:
 *   set -a; . dev/supabase-local/.env; set +a; SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=$ANON_KEY npx vitest run tests/sync.cloud.test.ts
 */
import 'fake-indexeddb/auto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { StudyDB, emptyWorksheet, uid } from '../src/db/db'
import { SyncEngine } from '../src/lib/cloud/sync'
import { supabaseRemote } from '../src/lib/cloud/remote'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const MAIL = process.env.MAILPIT || 'http://127.0.0.1:54324'
const run = !!(URL_ && ANON)

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } })
  const s = await c.auth.signInWithPassword({ email, password })
  if (s.error) throw s.error
  return c
}

async function newAccount(): Promise<{ email: string; password: string }> {
  const email = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`
  const password = 'correct horse battery staple'
  const c = createClient(URL_!, ANON!, { auth: { persistSession: false } })
  await c.auth.signUp({ email, password, options: { data: { age_confirmed_13: true } } })
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()
    if (s.messages?.length) {
      const m = await (await fetch(`${MAIL}/api/v1/message/${s.messages[0].ID}`)).json()
      const link = (m.Text as string).match(/https?:\/\/\S*type=signup\S*/)![0]
      await fetch(link, { redirect: 'manual' })
      return { email, password }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('no verification email')
}

const sermon = (id: string, title: string, text: string) => ({
  id, title, passage: 'Rom.8.28', mainIdea: '', objective: '', audience: '', length: '', template: 'blank', status: 'draft' as const, tags: [],
  sections: [{ id: 's1', type: 'point', title: 'Point', level: 1 as const, blocks: [{ id: 'b1', kind: 'note' as const, text }] }], sources: '', createdAt: 1, updatedAt: 2,
})

describe.skipIf(!run)('two devices, one account, through the real server', () => {
  let phone: StudyDB, laptop: StudyDB, P: SyncEngine, L: SyncEngine
  beforeAll(async () => {
    const acct = await newAccount()
    phone = new StudyDB('phone-' + uid())
    laptop = new StudyDB('laptop-' + uid())
    P = new SyncEngine(phone, supabaseRemote(await signedIn(acct.email, acct.password)), 'phone')
    L = new SyncEngine(laptop, supabaseRemote(await signedIn(acct.email, acct.password)), 'laptop')
  }, 60000)

  it('a note and a sermon written on the phone appear on the laptop', async () => {
    await phone.notes.put({ id: 'n1', ref: 'John.3.16', book: 'John', startKey: 43003016, endKey: 43003016, text: 'God so loved', tags: [], createdAt: 1, updatedAt: 1 })
    await phone.sermons.put(sermon('s1', 'All Things', 'Opening'))
    await phone.highlights.put({ id: 'h1', key: 'Rom.8.28', book: 'Rom', color: 'yellow', createdAt: 1 })
    const r = await P.syncOnce()
    expect(r.pushed).toBe(3)
    expect(r.pending).toBe(0)
    await L.syncOnce()
    expect((await laptop.notes.get('n1'))?.text).toBe('God so loved')
    expect((await laptop.sermons.get('s1'))?.title).toBe('All Things')
    expect((await laptop.highlights.get('h1'))?.color).toBe('yellow')
  }, 30000)

  it('an edit made on one device, then synced, updates the other', async () => {
    await laptop.sermons.update('s1', { title: 'All Things Work Together' })
    await L.syncOnce()
    await P.syncOnce()
    expect((await phone.sermons.get('s1'))?.title).toBe('All Things Work Together')
  }, 30000)

  it('both devices edit the same sermon offline: neither version is lost', async () => {
    await phone.sermons.update('s1', { sections: sermon('s1', '', 'Phone version of the opening').sections })
    await laptop.sermons.update('s1', { sections: sermon('s1', '', 'Laptop version of the opening').sections })
    await P.syncOnce() // phone reaches the server first
    const r = await L.syncOnce()
    expect(r.conflicts).toBe(1)
    const c = (await laptop.conflicts.toArray())[0]
    expect(JSON.stringify(c.local)).toContain('Laptop version of the opening')
    expect(JSON.stringify(c.server)).toContain('Phone version of the opening')
    // the laptop now shows the account's version, and its own is kept for review
    expect(JSON.stringify(await laptop.sermons.get('s1'))).toContain('Phone version of the opening')
    expect(r.pending).toBe(0)
  }, 30000)

  it('highlights: the newer choice wins without a conflict', async () => {
    await phone.highlights.update('h1', { color: 'green' })
    await laptop.highlights.update('h1', { color: 'blue' })
    await P.syncOnce()
    await L.syncOnce()
    await P.syncOnce()
    expect((await phone.highlights.get('h1'))?.color).toBe('blue')
    expect((await laptop.highlights.get('h1'))?.color).toBe('blue')
  }, 30000)

  it('deleting on one device removes it on the other', async () => {
    await phone.notes.delete('n1')
    await P.syncOnce()
    await L.syncOnce()
    expect(await laptop.notes.get('n1')).toBeUndefined()
  }, 30000)

  it('the same verse highlighted on both devices ends with one highlight', async () => {
    await phone.highlights.put({ id: 'hp', key: 'Ps.23.1', book: 'Ps', color: 'yellow', createdAt: 1 })
    await laptop.highlights.put({ id: 'hl', key: 'Ps.23.1', book: 'Ps', color: 'pink', createdAt: 2 })
    await P.syncOnce()
    await L.syncOnce()
    await P.syncOnce()
    await L.syncOnce()
    expect(await phone.highlights.where('key').equals('Ps.23.1').count()).toBe(1)
    expect(await laptop.highlights.where('key').equals('Ps.23.1').count()).toBe(1)
  }, 30000)

  it('a study worksheet and reading plan progress round-trip', async () => {
    await phone.studies.put({ id: 'st1', title: 'Romans 8', passage: 'Rom.8.28', sections: emptyWorksheet(), tags: [], createdAt: 1, updatedAt: 1 })
    await phone.planProgress.put({ id: 'pp1', planId: 'p1', sessionId: 's1', run: 1, completedAt: 5, updatedAt: 5 })
    await P.syncOnce()
    await L.syncOnce()
    expect((await laptop.studies.get('st1'))?.title).toBe('Romans 8')
    expect((await laptop.planProgress.get('pp1'))?.completedAt).toBe(5)
  }, 30000)

  it('nothing is left unconfirmed after a full round', async () => {
    expect((await P.syncOnce()).pending).toBe(0)
    expect((await L.syncOnce()).pending).toBe(0)
  }, 30000)
})
