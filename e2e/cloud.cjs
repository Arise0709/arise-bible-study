/*
 * Cloud security and sync checks against a Supabase project (the local copy in dev/supabase-local, or a
 * preview project). Uses real accounts, real sign-in tokens, and the real database security rules.
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... MAILPIT=http://127.0.0.1:54324 node e2e/cloud.cjs
 */
const { createClient } = require('@supabase/supabase-js')

const URL_ = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON = process.env.SUPABASE_ANON_KEY
const MAIL = process.env.MAILPIT || 'http://127.0.0.1:54324'
let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log('  ok  ' + name)
  } else {
    failures.push(name)
    console.log('  FAIL ' + name + (detail ? ' :: ' + String(detail).slice(0, 300) : ''))
  }
}
const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const crypto = require('crypto')
/** A 6-digit authenticator code (RFC 6238), as a phone app would show. */
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0')
}

async function mailLink(to, kind) {
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()
    for (const m of s.messages ?? []) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()
      const link = (full.Text || full.HTML || '').match(new RegExp(`https?://[^\\s"<>]*type=${kind}[^\\s"<>]*`))
      if (link) return link[0].replace(/&amp;/g, '&')
    }
    await sleep(250)
  }
  return null
}

async function account(tag) {
  const email = `${tag}-${Date.now()}@example.org`
  const password = 'correct horse battery staple'
  const c = client()
  const { error } = await c.auth.signUp({ email, password, options: { data: { age_confirmed_13: true } } })
  if (error) throw error
  return { c, email, password }
}

;(async () => {
  console.log('1. Accounts')
  const a = await account('alice')
  const early = await a.c.auth.signInWithPassword({ email: a.email, password: a.password })
  check('an unverified email cannot sign in', !!early.error && /confirm/i.test(early.error.message), early.error?.message)
  const link = await mailLink(a.email, 'signup')
  check('a verification email is sent', !!link)
  await fetch(link, { redirect: 'manual' })
  const si = await a.c.auth.signInWithPassword({ email: a.email, password: a.password })
  check('after verifying, sign-in works', !si.error && !!si.data.session, si.error?.message)
  const bad = await client().auth.signInWithPassword({ email: a.email, password: 'wrong password here' })
  const nobody = await client().auth.signInWithPassword({ email: `nobody-${Date.now()}@example.org`, password: 'wrong password here' })
  check('a wrong password and an unknown email get the same answer (no account discovery)', bad.error?.message === nobody.error?.message, `${bad.error?.message} / ${nobody.error?.message}`)
  const dup = await client().auth.signUp({ email: a.email, password: 'another password 123' })
  check('signing up again with a used email does not reveal the account', !dup.error && !dup.data.session && (dup.data.user?.identities?.length ?? 0) === 0, JSON.stringify(dup.error ?? dup.data.user?.identities))
  const prof = await a.c.from('profiles').select('*')
  check('a profile is created, recording the 13+ confirmation', prof.data?.length === 1 && prof.data[0].age_confirmed_13 === true, JSON.stringify(prof))

  const b = await account('bob')
  await fetch(await mailLink(b.email, 'signup'), { redirect: 'manual' })
  await b.c.auth.signInWithPassword({ email: b.email, password: b.password })

  console.log('2. Sync: versions and conflicts')
  const note = { id: 'n1', ref: 'John.3.16', book: 'John', startKey: 43003016, endKey: 43003016, text: 'First draft', tags: [], createdAt: 1, updatedAt: 1 }
  let r = await a.c.rpc('sync_push', { device: 'phone', changes: [{ kind: 'notes', id: 'n1', base: 0, data: note }] })
  check('a new record is saved as version 1', r.data?.[0]?.status === 'ok' && r.data[0].version === 1, JSON.stringify(r))
  r = await a.c.rpc('sync_push', { device: 'phone', changes: [{ kind: 'notes', id: 'n1', base: 1, data: { ...note, text: 'Phone edit' } }] })
  check('an edit based on the latest version is saved as version 2', r.data?.[0]?.status === 'ok' && r.data[0].version === 2)
  r = await a.c.rpc('sync_push', { device: 'laptop', changes: [{ kind: 'notes', id: 'n1', base: 1, data: { ...note, text: 'Laptop edit made offline' } }] })
  check('an edit based on an older version is refused as a conflict, and the newer text is returned', r.data?.[0]?.status === 'conflict' && r.data[0].server.data.text === 'Phone edit', JSON.stringify(r.data))
  const pulled = await a.c.rpc('sync_pull', { since: 0 })
  check('the stored note still has the phone edit (nothing silently overwritten)', pulled.data?.find((x) => x.id === 'n1')?.data.text === 'Phone edit')
  const hist = await a.c.from('user_record_history').select('version, data').eq('id', 'n1')
  check('the earlier version is kept in history', hist.data?.some((h) => h.version === 1 && h.data.text === 'First draft'), JSON.stringify(hist))
  r = await a.c.rpc('sync_push', { device: 'phone', changes: [{ kind: 'notes', id: 'n1', base: 2, deleted: true }] })
  const afterDel = await a.c.rpc('sync_pull', { since: 0 })
  check('a deletion is recorded so other devices remove it too', r.data?.[0]?.status === 'ok' && afterDel.data?.find((x) => x.id === 'n1')?.deleted === true)
  r = await a.c.rpc('sync_push', { device: 'x', changes: [{ kind: 'secrets', id: 'z', base: 0, data: {} }] })
  check('unknown kinds of record are refused', !!r.error)
  r = await a.c.rpc('sync_push', { device: 'x', changes: Array.from({ length: 201 }, (_, i) => ({ kind: 'notes', id: 'b' + i, base: 0, data: note })) })
  check('oversized batches are refused', !!r.error)

  console.log('3. Isolation between people (enforced by the database, not the app)')
  await b.c.rpc('sync_push', { device: 'bob', changes: [{ kind: 'sermons', id: 's-bob', base: 0, data: { id: 's-bob', title: "Bob's private sermon" } }] })
  const bobSees = await b.c.rpc('sync_pull', { since: 0 })
  check("Bob's pull returns only Bob's records", bobSees.data?.every((x) => x.id === 's-bob') && bobSees.data.length === 1, JSON.stringify(bobSees.data?.map((x) => x.id)))
  const peek = await b.c.from('user_records').select('*').eq('id', 'n1')
  check("Bob cannot read Alice's records directly", (peek.data ?? []).length === 0, JSON.stringify(peek))
  const aliceId = si.data.user.id
  const forge = await b.c.from('user_records').insert({ user_id: aliceId, kind: 'notes', id: 'planted', data: { text: 'x' } })
  check("Bob cannot write into Alice's account, even by sending her id", !!forge.error, JSON.stringify(forge))
  const upd = await b.c.from('user_records').update({ data: { text: 'hacked' } }).eq('id', 'n1').select()
  check("Bob cannot change Alice's records", (upd.data ?? []).length === 0)
  const hb = await b.c.from('user_record_history').select('*').eq('id', 'n1')
  check("Bob cannot read Alice's history", (hb.data ?? []).length === 0)
  const pb = await b.c.from('profiles').select('*')
  check('each person sees only their own profile', pb.data?.length === 1 && pb.data[0].id !== aliceId)
  const anon = client()
  const anonRead = await anon.from('user_records').select('*')
  const anonPush = await anon.rpc('sync_push', { device: 'x', changes: [{ kind: 'notes', id: 'q', base: 0, data: note }] })
  check('without signing in, nothing can be read or written', (anonRead.data ?? []).length === 0 && !!anonPush.error, JSON.stringify([anonRead.error, anonPush.error]))
  const forgedJwt = createClient(URL_, ANON, { global: { headers: { Authorization: 'Bearer ' + ANON.split('.').slice(0, 2).join('.') + '.forged' } }, auth: { persistSession: false } })
  const fj = await forgedJwt.from('user_records').select('*')
  check('a forged token is rejected', !!fj.error, JSON.stringify(fj))

  console.log('4. Sessions')
  await b.c.auth.signOut()
  const afterOut = await b.c.rpc('sync_pull', { since: 0 })
  check('after signing out, the client can no longer read data', !!afterOut.error || (afterOut.data ?? []).length === 0, JSON.stringify(afterOut))

  console.log('5. Password recovery')
  await client().auth.resetPasswordForEmail(a.email)
  const rec = await mailLink(a.email, 'recovery')
  check('a recovery email is sent with a one-time link', !!rec)
  const unknown = await client().auth.resetPasswordForEmail(`nobody-${Date.now()}@example.org`)
  check('asking to reset an unknown email gives the same answer (no account discovery)', !unknown.error, unknown.error?.message)

  console.log('6. Multifactor sign-in (authenticator app)')
  const en = await a.c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'phone' })
  check('an authenticator app can be enrolled', !en.error && !!en.data?.totp?.secret, en.error?.message)
  const v = await a.c.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) })
  check('it is confirmed with a code from the app', !v.error, v.error?.message)
  // a new sign-in with only the password
  const a2 = client()
  await a2.auth.signInWithPassword({ email: a.email, password: a.password })
  const half = await a2.rpc('sync_pull', { since: 0 })
  check('with two-step sign-in on, a password alone cannot read the data', (half.data ?? []).length === 0, JSON.stringify(half.data?.length))
  const wrong = await a2.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: '000000' })
  check('a wrong code is refused', !!wrong.error)
  await a2.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) })
  const full = await a2.rpc('sync_pull', { since: 0 })
  check('after the code, the data is available', (full.data ?? []).length > 0, JSON.stringify(full.error))

  console.log(`\n${passed} passed, ${failures.length} failed`)
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
