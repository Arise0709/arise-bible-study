/**
 * The invitation server function (api/org-invite.ts) against a real Supabase stack, with a stand-in email
 * service that captures what would be sent. Skipped unless SUPABASE_URL, SUPABASE_ANON_KEY and
 * SUPABASE_SERVICE_ROLE_KEY are set.
 */
import http from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const run = !!(URL_ && ANON && SERVICE)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

const sent: { auth: string; body: { from: string; to: string[]; subject: string; text: string; html: string } }[] = []
let mailStatus = 200
let server: http.Server

async function person(tag: string) {
  const admin = createClient(URL_!, SERVICE!, opts)
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`
  const password = 'correct horse battery staple'
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  const c = createClient(URL_!, ANON!, opts)
  const s = await c.auth.signInWithPassword({ email, password })
  return { c, email, password, id: data.user!.id, token: s.data.session!.access_token }
}

const post = (token: string | null, body: unknown, origin = 'https://www.carterstudybible.app') =>
  new Request('https://www.carterstudybible.app/api/org-invite', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', origin, host: 'www.carterstudybible.app' },
    body: JSON.stringify(body),
  })

describe.skipIf(!run)('the invitation server function', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = ''
      req.on('data', (c) => (b += c))
      req.on('end', () => {
        sent.push({ auth: req.headers.authorization ?? '', body: JSON.parse(b) })
        res.writeHead(mailStatus, { 'content-type': 'application/json' }).end('{"id":"x"}')
      })
    })
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    process.env.SUPABASE_URL = URL_
    process.env.SUPABASE_ANON_KEY = ANON
    process.env.RESEND_API_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/emails`
    delete process.env.SITE_URL
  })
  afterAll(() => server?.close())

  it('creates the invitation as the leader, emails it, and returns the link; the database decides who may invite', async () => {
    const { POST } = await import('../api/org-invite')
    const owner = await person('inv-owner')
    const org = (await owner.c.rpc('create_org', { p: { name: 'Invite Test Church', kind: 'church', contact_email: 'office@example.org', display_name: 'Pastor P', adult: true } })).data as string
    const to = `guest-${Date.now()}@example.org`

    // without the email key: the link only
    delete process.env.RESEND_API_KEY
    let r = await POST(post(owner.token, { org, email: to, role: 'member' }))
    let j = await r.json()
    expect(r.status).toBe(200)
    expect(j.emailed).toBe(false)
    expect(j.link).toMatch(/^https:\/\/www\.carterstudybible\.app\/church\/join#token=[0-9a-f]{64}$/)
    expect(sent.length).toBe(0)

    // with the key: emailed through the service, from the church's sender address
    process.env.RESEND_API_KEY = 're_test_key'
    r = await POST(post(owner.token, { org, email: to, role: 'teacher' }))
    j = await r.json()
    expect(r.status).toBe(200)
    expect(j.emailed).toBe(true)
    expect(sent.length).toBe(1)
    expect(sent[0].auth).toBe('Bearer re_test_key')
    expect(sent[0].body.to).toEqual([to])
    expect(sent[0].body.from).toBe('Carter Study Bible <no-reply@carterstudybible.app>')
    expect(sent[0].body.text).toContain('Pastor P invited you to join Invite Test Church')
    expect(sent[0].body.text).toContain('as Pastor/Teacher')
    expect(sent[0].body.text).toContain(j.link)

    // a new invitation to the same person replaces the old link
    const guest = createClient(URL_!, SERVICE!, opts)
    const open = await guest.from('org_invitations').select('id').eq('org_id', org).is('accepted_at', null).is('revoked_at', null)
    expect(open.data?.length).toBe(1)

    // re-sending gives a new link and emails it again
    r = await POST(post(owner.token, { resend: j.id }))
    const again = await r.json()
    expect(again.emailed).toBe(true)
    expect(again.link).not.toBe(j.link)
    expect(sent.length).toBe(2)

    // the email service refusing still returns the link, with a clear note
    mailStatus = 422
    r = await POST(post(owner.token, { org, email: `x-${Date.now()}@example.org`, role: 'member' }))
    j = await r.json()
    expect(r.status).toBe(200)
    expect(j.emailed).toBe(false)
    expect(j.email_error).toMatch(/code 422/)
    mailStatus = 200

    // refusals: no sign-in, another site, a forged token, a member without authority, a role above the caller
    expect((await POST(post(null, { org, email: to, role: 'member' }))).status).toBe(401)
    expect((await POST(post(owner.token, { org, email: to, role: 'member' }, 'https://evil.example'))).status).toBe(403)
    expect((await POST(post('forged.token.value', { org, email: to, role: 'member' }))).status).toBe(401)
    const outsider = await person('inv-outsider')
    const before = sent.length
    const no = await POST(post(outsider.token, { org, email: to, role: 'member' }))
    expect(no.status).toBe(403)
    expect((await no.json()).error).toMatch(/Only leaders/)
    expect((await POST(post(owner.token, { org, email: to, role: 'owner' }))).status).toBe(400)
    expect(sent.length).toBe(before) // nothing was emailed for refused requests
  }, 60000)

  it('account deletion: an owner with members must transfer first; a sole owner\'s workspace goes with the account', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    const { DELETE } = await import('../api/account')
    const del = (token: string, password: string) =>
      new Request('https://www.carterstudybible.app/api/account', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://www.carterstudybible.app', host: 'www.carterstudybible.app' },
        body: JSON.stringify({ confirm: 'DELETE', password }),
      })
    const admin = createClient(URL_!, SERVICE!, opts)
    const owner = await person('del-owner')
    const member = await person('del-member')
    const org = (await owner.c.rpc('create_org', { p: { name: 'Has Members', kind: 'church', contact_email: 'o@example.org', display_name: 'O', adult: true } })).data as string
    const inv = await owner.c.rpc('create_invitation', { o: org, p: { email: member.email, role: 'member' } })
    await member.c.rpc('accept_invitation', { token: inv.data.token, display_name: 'M', adult: true })
    const blocked = await DELETE(del(owner.token, owner.password))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error).toMatch(/Transfer ownership/)
    expect((await admin.auth.admin.getUserById(owner.id)).data.user).not.toBeNull()

    const solo = await person('del-solo')
    const lone = (await solo.c.rpc('create_org', { p: { name: 'Just Me', kind: 'ministry', contact_email: 's@example.org', display_name: 'S', adult: true } })).data as string
    expect((await DELETE(del(solo.token, solo.password))).status).toBe(200)
    expect((await admin.from('orgs').select('id').eq('id', lone)).data?.length).toBe(0)

    // a plain member deleting their account: membership ends, the church keeps the workspace
    expect((await DELETE(del(member.token, member.password))).status).toBe(200)
    expect((await admin.from('orgs').select('id').eq('id', org)).data?.length).toBe(1)
    expect((await admin.from('org_members').select('user_id').eq('org_id', org).eq('user_id', member.id)).data?.length).toBe(0)
  }, 60000)
})
