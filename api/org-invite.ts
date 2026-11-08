/**
 * Church workspace invitations: creates (or re-sends) an invitation AS THE SIGNED-IN LEADER, so the database's own
 * rules decide whether they may offer that role, group, or course. Then emails the link through Resend and
 * returns it so the leader can also copy it.
 *
 * Needs SUPABASE_URL and SUPABASE_ANON_KEY. Email needs RESEND_API_KEY (secret, server only); without it the
 * link is still returned and the leader sends it themselves. No service key is used here.
 * The token travels in the link's #fragment, which browsers never send to servers or in Referer headers.
 */
import { clientId, rateLimited, sameSite } from './_lib/guard.js'

const json = (status: number, body: unknown) => Response.json(body, { status })
const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', teacher: 'Pastor/Teacher', instructor: 'Instructor', leader: 'Group Leader', member: 'Member' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The site address put in emails: a known host only, never whatever a request claims. */
export function siteUrl(req: Request): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  if (/^(www\.)?carterstudybible\.app$/.test(host) || /^arise-bible-study-[a-z0-9-]+\.vercel\.app$/.test(host)) return `https://${host}`
  if (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return `http://${host}`
  return 'https://www.carterstudybible.app'
}

export function inviteEmail(p: { org: string; inviter?: string; role: string; link: string; expires: string; groups?: string[]; courses?: string[] }) {
  const role = ROLE_LABEL[p.role] ?? 'Member'
  const who = p.inviter ? `${p.inviter} invited you` : 'You are invited'
  const extras = [...(p.groups ?? []).map((g) => `the group "${g}"`), ...(p.courses ?? []).map((c) => `the course "${c}"`)]
  const also = extras.length ? ` You will also join ${extras.join(' and ')}.` : ''
  const until = new Date(p.expires).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const subject = `${p.org}: invitation to Carter Study Bible`
  const text = `${who} to join ${p.org} on Carter Study Bible as ${role}.${also}

Open this link to review and accept (it works once, for this email address, until ${until}):
${p.link}

You will sign in or create a free account with this email address first. Your personal notes and studies stay private; only what you choose to submit or share is seen by the workspace.

If you did not expect this, you can ignore it.`
  const html = `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#222;line-height:1.5">
<h2 style="margin:0 0 12px">Carter Study Bible</h2>
<p>${esc(who)} to join <strong>${esc(p.org)}</strong> as <strong>${esc(role)}</strong>.${esc(also)}</p>
<p><a href="${esc(p.link)}" style="display:inline-block;background:#3b2f63;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Review the invitation</a></p>
<p style="font-size:14px;color:#555">This link works once, for this email address, until ${esc(until)}. You will sign in or create a free account with this address first. Your personal notes and studies stay private; only what you choose to submit or share is seen by the workspace.</p>
<p style="font-size:13px;color:#777">If you did not expect this, you can ignore it.</p>
</div>`
  return { subject, text, html }
}

async function rest(url: string, anon: string, token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  const body = await r.json().catch(() => null)
  return { ok: r.ok, status: r.status, body }
}

export async function POST(request: Request) {
  const url = process.env.SUPABASE_URL
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return json(501, { error: 'Accounts are not set up on this deployment.' })
  if (!sameSite(request)) return json(403, { error: 'This request must come from Carter Study Bible.' })
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'Sign in first.' })
  if (await rateLimited(`org-invite:${clientId(request)}`, 3600, 60)) return json(429, { error: 'Too many invitations from here. Try again in an hour.' })
  let body: { org?: string; email?: string; role?: string; group_ids?: string[]; course_ids?: string[]; days?: number; resend?: string }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'The request could not be read.' })
  }

  // the database checks the caller's authority (and rate limits per leader and per workspace)
  const created = body.resend
    ? await rest(url, anon, token, 'rpc/resend_invitation', { method: 'POST', body: JSON.stringify({ iid: body.resend, days: body.days ?? 7 }) })
    : await rest(url, anon, token, 'rpc/create_invitation', {
        method: 'POST',
        body: JSON.stringify({ o: body.org, p: { email: body.email, role: body.role ?? 'member', group_ids: body.group_ids ?? [], course_ids: body.course_ids ?? [], days: body.days ?? 7 } }),
      })
  if (!created.ok) {
    const status = created.status === 401 ? 401 : created.status === 403 ? 403 : 400
    const msg = (created.body as { message?: string } | null)?.message
    return json(status, { error: status === 401 ? 'Your sign-in has expired. Sign in again.' : msg && msg.length < 300 ? msg : 'The invitation could not be created.' })
  }
  const inv = created.body as { id: string; token: string; expires_at: string; org_name: string; email?: string }
  const link = `${siteUrl(request)}/church/join#token=${inv.token}`
  const to = (body.resend ? inv.email : body.email)?.trim().toLowerCase() ?? ''

  const key = process.env.RESEND_API_KEY
  if (!key) return json(200, { id: inv.id, link, emailed: false, expires_at: inv.expires_at })

  // details for the email, read as the leader (their own name; group and course titles they can see)
  const preview = await rest(url, anon, token, `org_invitations?id=eq.${encodeURIComponent(inv.id)}&select=org_id,role,group_ids,course_ids,invited_by`)
  const row = (preview.body as { org_id: string; role: string; group_ids: string[]; course_ids: string[]; invited_by: string }[] | null)?.[0]
  let inviter: string | undefined
  let groups: string[] = []
  let courses: string[] = []
  if (row) {
    const m = await rest(url, anon, token, `org_members?org_id=eq.${row.org_id}&user_id=eq.${row.invited_by}&select=display_name`)
    inviter = (m.body as { display_name: string }[] | null)?.[0]?.display_name
    if (row.group_ids.length) groups = ((await rest(url, anon, token, `org_groups?id=in.(${row.group_ids.join(',')})&select=name`)).body as { name: string }[] | null)?.map((g) => g.name) ?? []
    if (row.course_ids.length) courses = ((await rest(url, anon, token, `org_courses?id=in.(${row.course_ids.join(',')})&select=title`)).body as { title: string }[] | null)?.map((c) => c.title) ?? []
  }
  const mail = inviteEmail({ org: inv.org_name, inviter, role: row?.role ?? body.role ?? 'member', link, expires: inv.expires_at, groups, courses })
  try {
    const sent = await fetch(process.env.RESEND_API_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM || 'Carter Study Bible <no-reply@carterstudybible.app>', to: [to], subject: mail.subject, text: mail.text, html: mail.html }),
    })
    if (!sent.ok) {
      console.log(JSON.stringify({ event: 'invite_email_failed', status: sent.status })) // no addresses or tokens in logs
      return json(200, { id: inv.id, link, emailed: false, email_error: `The email service refused the message (code ${sent.status}). Copy the link and send it yourself.`, expires_at: inv.expires_at })
    }
  } catch {
    return json(200, { id: inv.id, link, emailed: false, email_error: 'The email service could not be reached. Copy the link and send it yourself.', expires_at: inv.expires_at })
  }
  return json(200, { id: inv.id, link, emailed: true, expires_at: inv.expires_at })
}
