/**
 * Delete the signed-in person's account (and with it every synced record, by cascade).
 * The browser's local copy is not touched. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server
 * (the service key never reaches the browser).
 *
 * Checks: a valid session token, the same-site origin, the typed confirmation, the password again, and a
 * rate limit. Nothing is deleted unless all pass. An owner of a church workspace that has other members must
 * transfer ownership first. Workspaces the person owns alone are deleted with the account; in workspaces they
 * only belong to, their membership ends and the church keeps its records with the name removed.
 */
import { clientId, rateLimited, sameSite } from './_lib/guard.js'

const json = (status: number, body: unknown) => Response.json(body, { status })

export async function DELETE(request: Request) {
  const url = process.env.SUPABASE_URL
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.SUPABASE_ANON_KEY
  if (!url || !service || !anon) return json(501, { error: 'Accounts are not set up on this deployment.' })
  if (!sameSite(request)) return json(403, { error: 'This request must come from Carter Study Bible.' })
  if (await rateLimited(`account-delete:${clientId(request)}`, 3600, 5)) return json(429, { error: 'Too many attempts. Try again in an hour.' })
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'Sign in first.' })
  let body: { confirm?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'The request could not be read.' })
  }
  if (body.confirm !== 'DELETE') return json(400, { error: 'Type DELETE to confirm.' })

  // who is asking (the token is checked by the auth server, not trusted from the client)
  const me = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: `Bearer ${token}` } })
  if (!me.ok) return json(401, { error: 'Your sign-in has expired. Sign in again.' })
  const user = (await me.json()) as { id: string; email?: string }

  // the password again, so a borrowed unlocked device can't delete the account
  const check = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: String(body.password ?? '') }),
  })
  if (!check.ok) return json(403, { error: 'That password is not correct.' })

  // A church workspace must never be left without an owner (Release 6.2). Older databases without workspaces skip this.
  const admin = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' }
  const owned = await fetch(`${url}/rest/v1/rpc/orgs_blocking_account_deletion`, { method: 'POST', headers: admin, body: JSON.stringify({ u: user.id }) })
  if (owned.ok) {
    const list = (await owned.json()) as { id: string; name: string }[]
    if (list.length) {
      return json(409, { error: `You own ${list.map((o) => `"${o.name}"`).join(', ')}, which other people belong to. Transfer ownership to an administrator first (workspace Settings), then delete your account. Nothing was removed.` })
    }
  }
  // workspaces this person owns with nobody else in them go with the account
  const soleOwned = await fetch(`${url}/rest/v1/org_members?user_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=org_id`, { headers: admin })
  const soleIds = soleOwned.ok ? ((await soleOwned.json()) as { org_id: string }[]).map((r) => r.org_id) : []

  const del = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'DELETE',
    headers: { apikey: service, authorization: `Bearer ${service}` },
  })
  if (!del.ok) {
    // status only, never keys or personal details; 401/403 here usually means the service key setting is wrong
    console.log(JSON.stringify({ event: 'account_delete_failed', status: del.status }))
    const hint = del.status === 401 || del.status === 403 ? ' (the server is not allowed to delete accounts: check the service key setting)' : ''
    return json(502, { error: `The account could not be deleted (code ${del.status})${hint}. Nothing was removed. Try again later.` })
  }
  if (soleIds.length) await fetch(`${url}/rest/v1/orgs?id=in.(${soleIds.join(',')})`, { method: 'DELETE', headers: admin }).catch(() => {})
  console.log(JSON.stringify({ event: 'account_deleted', at: new Date().toISOString() })) // no personal details in logs
  return json(200, { deleted: true })
}
