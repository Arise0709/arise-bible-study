/**
 * Account deletion (api/account.ts) against a real Supabase stack. Skipped unless SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const MAIL = process.env.MAILPIT || 'http://127.0.0.1:54324'
const run = !!(URL_ && ANON && SERVICE)

async function account() {
  const email = `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`
  const password = 'correct horse battery staple'
  await createClient(URL_!, ANON!, { auth: { persistSession: false } }).auth.signUp({ email, password, options: { data: { age_confirmed_13: true } } })
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()
    if (s.messages?.length) {
      const m = await (await fetch(`${MAIL}/api/v1/message/${s.messages[0].ID}`)).json()
      await fetch((m.Text as string).match(/https?:\/\/\S*type=signup\S*/)![0], { redirect: 'manual' })
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  const c = createClient(URL_!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } })
  const s = await c.auth.signInWithPassword({ email, password })
  return { c, password, token: s.data.session!.access_token, id: s.data.user!.id }
}

const req = (token: string | null, body: unknown, origin = 'https://www.carterstudybible.app') =>
  new Request('https://www.carterstudybible.app/api/account', {
    method: 'DELETE',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', origin, host: 'www.carterstudybible.app' },
    body: JSON.stringify(body),
  })

describe.skipIf(!run)('deleting an account', () => {
  it('needs a session, the typed confirmation, the password, and the same site; then removes the account and its cloud records', async () => {
    process.env.SUPABASE_URL = URL_
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    const { DELETE } = await import('../api/account')
    const a = await account()
    await a.c.rpc('sync_push', { device: 'd', changes: [{ kind: 'notes', id: 'n1', base: 0, data: { id: 'n1', text: 'x' } }] })
    expect((await DELETE(req(null, { confirm: 'DELETE', password: a.password }))).status).toBe(401)
    expect((await DELETE(req(a.token, { confirm: 'delete', password: a.password }))).status).toBe(400)
    expect((await DELETE(req(a.token, { confirm: 'DELETE', password: 'not my password' }))).status).toBe(403)
    expect((await DELETE(req(a.token, { confirm: 'DELETE', password: a.password }, 'https://evil.example'))).status).toBe(403)
    expect((await DELETE(req('forged.token.value', { confirm: 'DELETE', password: a.password }))).status).toBe(401)
    const admin = createClient(URL_!, SERVICE!, { auth: { persistSession: false } })
    expect((await admin.from('user_records').select('id').eq('user_id', a.id)).data?.length).toBe(1)
    const ok = await DELETE(req(a.token, { confirm: 'DELETE', password: a.password }))
    expect(ok.status).toBe(200)
    expect((await admin.from('user_records').select('id').eq('user_id', a.id)).data?.length).toBe(0)
    expect((await admin.auth.admin.getUserById(a.id)).data.user).toBeNull()
  }, 60000)
})
