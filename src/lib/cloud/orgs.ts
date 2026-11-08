/**
 * Church and ministry workspaces (Release 6.2). Every read and write goes through the database's own rules and
 * checked functions; nothing here decides permissions. The role checks below only choose which buttons to show.
 * Loaded only on the workspace pages, so Bible reading never downloads it.
 */
import { cloud } from './manager'

export type Role = 'owner' | 'admin' | 'teacher' | 'instructor' | 'leader' | 'member'
export const ROLES: Role[] = ['owner', 'admin', 'teacher', 'instructor', 'leader', 'member']
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  teacher: 'Pastor/Teacher',
  instructor: 'Instructor',
  leader: 'Group Leader',
  member: 'Member',
}
export const ROLE_HELP: Record<Role, string> = {
  owner: 'Manages the workspace, its administrators, and its settings.',
  admin: 'Invites members, manages groups and courses, and sees reports.',
  teacher: 'Creates and publishes teaching, leads groups, and reviews student progress.',
  instructor: 'Teaches assigned courses, grades, and records attendance.',
  leader: 'Leads assigned groups and their discussions.',
  member: 'Joins courses and groups, completes lessons, and sees their own progress.',
}
export const rank = (r: Role | string | undefined) => (r ? 6 - ROLES.indexOf(r as Role) : 0) % 7
export const KIND_LABEL = { church: 'Church', ministry: 'Ministry', study_group: 'Bible study group', education: 'Christian educational organization' } as const
export type OrgKind = keyof typeof KIND_LABEL

export interface Org {
  id: string
  name: string
  kind: OrgKind
  description: string
  city: string
  state: string
  website: string
  logo: string | null
  contact_email: string
  time_zone: string
  require_course_review: boolean
  created_at: string
}
export interface Member {
  org_id: string
  user_id: string
  role: Role
  display_name: string
  joined_at: string
  removed_at: string | null
  notify: { announcements: boolean }
  email?: string
}
export interface Invitation {
  id: string
  org_id: string
  email: string
  role: Role
  group_ids: string[]
  course_ids: string[]
  created_at: string
  expires_at: string
  sent_count: number
  accepted_at: string | null
  revoked_at: string | null
}
export interface Membership {
  org: Org
  role: Role
  display_name: string
}
export interface InvitePreview {
  status: 'ok' | 'expired' | 'used' | 'revoked' | 'invalid' | 'wrong_account'
  org?: { name: string; kind: OrgKind; description: string; city: string; state: string; logo: string | null }
  role?: Role
  expires_at?: string
  invited_by?: string
  groups?: string[]
  courses?: string[]
  already_member?: boolean
}

/** Turns a database or network error into the plain sentence the database wrote (or a friendly fallback). */
export class OrgError extends Error {}
function must<T>(r: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (r.error) {
    const m = r.error.message || ''
    if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) throw new OrgError('Could not reach the server. Check your connection and try again.')
    if (/permission denied|row-level security/i.test(m)) throw new OrgError('You do not have permission to do that.')
    throw new OrgError(m.length < 300 ? m : 'Something went wrong. Try again.')
  }
  return r.data as T
}

async function me(): Promise<string> {
  const { data } = await cloud().auth.getSession()
  if (!data.session) throw new OrgError('Sign in first.')
  return data.session.user.id
}

/* ---------------- remembered on this device (no personal content) ---------------- */

const FLAG = 'abs-has-orgs'
const CURRENT = 'abs-current-org'
export function rememberHasOrgs(n: number) {
  try {
    if (n > 0) localStorage.setItem(FLAG, '1')
    else localStorage.removeItem(FLAG)
    window.dispatchEvent(new Event('abs-orgs-changed'))
  } catch {
    /* private mode */
  }
}
export const hasOrgsFlag = () => {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}
export const currentOrgId = () => {
  try {
    return localStorage.getItem(CURRENT) ?? undefined
  } catch {
    return undefined
  }
}
export const setCurrentOrgId = (id: string) => {
  try {
    localStorage.setItem(CURRENT, id)
  } catch {
    /* ignore */
  }
}
const INVITE = 'abs-pending-invite'
export function savePendingInvite(token: string) {
  try {
    localStorage.setItem(INVITE, JSON.stringify({ token, at: Date.now() }))
  } catch {
    /* ignore */
  }
}
export function pendingInvite(): string | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(INVITE) ?? 'null') as { token: string; at: number } | null
    return v && Date.now() - v.at < 31 * 86400_000 ? v.token : undefined
  } catch {
    return undefined
  }
}
export function clearPendingInvite() {
  try {
    localStorage.removeItem(INVITE)
  } catch {
    /* ignore */
  }
}

/* ---------------- workspaces ---------------- */

export async function myMemberships(): Promise<Membership[]> {
  const uid = await me()
  const rows = must(await cloud().from('org_members').select('role, display_name, orgs(*)').eq('user_id', uid).is('removed_at', null))
  const list = (rows as unknown as { role: Role; display_name: string; orgs: Org | null }[])
    .filter((r) => r.orgs)
    .map((r) => ({ org: r.orgs!, role: r.role, display_name: r.display_name }))
    .sort((a, b) => a.org.name.localeCompare(b.org.name))
  rememberHasOrgs(list.length)
  return list
}

export interface NewOrg {
  name: string
  kind: OrgKind
  description: string
  city: string
  state: string
  website: string
  contact_email: string
  time_zone: string
  display_name: string
  adult: boolean
}
export async function createOrg(p: NewOrg): Promise<string> {
  const id = must(await cloud().rpc('create_org', { p })) as string
  rememberHasOrgs(1)
  setCurrentOrgId(id)
  return id
}
export async function updateOrg(id: string, p: Partial<Org>) {
  must(await cloud().rpc('update_org', { o: id, p }))
}
export async function deleteOrg(id: string, confirmName: string) {
  must(await cloud().rpc('delete_org', { o: id, confirm_name: confirmName }))
}
export async function restoreOrg(id: string) {
  must(await cloud().rpc('restore_org', { o: id }))
}
export async function myDeletedOrgs(): Promise<{ id: string; name: string; purge_after: string }[]> {
  return must(await cloud().rpc('my_deleted_orgs')) ?? []
}

/* ---------------- members ---------------- */

export const PAGE = 50

/** Members the caller is allowed to see (the database decides), a page at a time; emails only for administrators. */
export async function members(orgId: string, opts: { page?: number; search?: string; includeRemoved?: boolean; withEmail?: boolean } = {}): Promise<{ rows: Member[]; more: boolean }> {
  const page = opts.page ?? 0
  let q = cloud().from('org_members').select('*').eq('org_id', orgId).order('display_name').range(page * PAGE, page * PAGE + PAGE)
  if (!opts.includeRemoved) q = q.is('removed_at', null)
  if (opts.search?.trim()) q = q.ilike('display_name', `%${opts.search.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`)
  const rows = must(await q) as Member[]
  const more = rows.length > PAGE
  const list = rows.slice(0, PAGE)
  if (opts.withEmail && list.length) {
    const contacts = must(await cloud().from('org_member_contacts').select('user_id, email').eq('org_id', orgId).in('user_id', list.map((m) => m.user_id))) as { user_id: string; email: string }[]
    const byId = new Map(contacts.map((c) => [c.user_id, c.email]))
    for (const m of list) m.email = byId.get(m.user_id)
  }
  return { rows: list, more }
}
export async function setRole(orgId: string, userId: string, role: Role) {
  must(await cloud().rpc('set_member_role', { o: orgId, u: userId, r: role }))
}
export async function removeMember(orgId: string, userId: string) {
  must(await cloud().rpc('remove_member', { o: orgId, u: userId }))
}
export async function leaveOrg(orgId: string) {
  must(await cloud().rpc('remove_member', { o: orgId, u: await me() }))
}
export async function setMySettings(orgId: string, p: { display_name?: string; notify?: { announcements: boolean } }) {
  must(await cloud().rpc('set_my_member_settings', { o: orgId, p }))
}

/* ---------------- ownership ---------------- */

export async function offerOwnership(orgId: string, userId: string) {
  must(await cloud().rpc('offer_ownership', { o: orgId, u: userId }))
}
export async function openTransfer(orgId: string): Promise<{ id: string; to_user: string; expires_at: string } | undefined> {
  const rows = must(await cloud().from('org_ownership_transfers').select('id, to_user, expires_at').eq('org_id', orgId).is('accepted_at', null).is('cancelled_at', null).gt('expires_at', new Date().toISOString()))
  return (rows as { id: string; to_user: string; expires_at: string }[])[0]
}
export async function myOwnershipOffers(): Promise<{ id: string; org_id: string; org_name: string; from_name: string; expires_at: string }[]> {
  return must(await cloud().rpc('my_ownership_offers')) ?? []
}
export async function acceptOwnership(id: string) {
  must(await cloud().rpc('accept_ownership', { tid: id }))
}
export async function cancelOwnership(id: string) {
  must(await cloud().rpc('cancel_ownership_offer', { tid: id }))
}

/* ---------------- invitations ---------------- */

export interface InviteRequest {
  org: string
  email: string
  role: Role
  group_ids?: string[]
  course_ids?: string[]
  days?: number
}
export interface InviteResult {
  id: string
  link: string
  emailed: boolean
  email_error?: string
  expires_at: string
}

/** Creates (or re-sends) an invitation through the server, which emails it when email is set up and always returns the link. */
export async function sendInvite(req: InviteRequest | { resend: string; days?: number }): Promise<InviteResult> {
  const token = (await cloud().auth.getSession()).data.session?.access_token
  if (!token) throw new OrgError('Sign in first.')
  let r: Response
  try {
    r = await fetch('/api/org-invite', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(req) })
  } catch {
    throw new OrgError('Could not reach the server. Check your connection and try again.')
  }
  const j = (await r.json().catch(() => ({}))) as InviteResult & { error?: string }
  if (!r.ok) throw new OrgError(j.error ?? `The invitation could not be created (code ${r.status}).`)
  return j
}
export async function invitations(orgId: string): Promise<Invitation[]> {
  return must(await cloud().from('org_invitations').select('id, org_id, email, role, group_ids, course_ids, created_at, expires_at, sent_count, accepted_at, revoked_at').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200)) as Invitation[]
}
export async function revokeInvite(id: string) {
  must(await cloud().rpc('revoke_invitation', { iid: id }))
}
export async function previewInvite(token: string): Promise<InvitePreview> {
  return must(await cloud().rpc('invitation_preview', { token })) as InvitePreview
}
export async function acceptInvite(token: string, displayName: string, adult: boolean): Promise<string> {
  const id = must(await cloud().rpc('accept_invitation', { token, display_name: displayName, adult })) as string
  rememberHasOrgs(1)
  setCurrentOrgId(id)
  clearPendingInvite()
  return id
}
export function inviteStatus(i: Invitation): 'accepted' | 'revoked' | 'expired' | 'pending' {
  return i.accepted_at ? 'accepted' : i.revoked_at ? 'revoked' : new Date(i.expires_at).getTime() < Date.now() ? 'expired' : 'pending'
}

/** Roles the caller may offer or assign (strictly below their own; members can be invited by leaders into their groups and courses). */
export function assignableRoles(mine: Role): Role[] {
  const r = rank(mine)
  if (r >= 5) return ROLES.filter((x) => x !== 'owner' && rank(x) < r)
  if (r >= 2) return ['member']
  return []
}

/* ---------------- audit ---------------- */

export async function auditLog(orgId: string, page = 0): Promise<{ rows: { id: number; actor: string | null; action: string; target: string | null; detail: Record<string, unknown>; at: string }[]; more: boolean }> {
  const rows = must(await cloud().from('org_audit_events').select('*').eq('org_id', orgId).order('at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE)) as { id: number; actor: string | null; action: string; target: string | null; detail: Record<string, unknown>; at: string }[]
  return { rows: rows.slice(0, PAGE), more: rows.length > PAGE }
}

/* ---------------- logo ---------------- */

/** Shrinks a chosen image to at most 256 px and about 200 KB (WebP or PNG), so the logo is stored small. */
export async function logoFromFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new OrgError('Choose a PNG, JPEG, or WebP image.')
  if (file.size > 8_000_000) throw new OrgError('That image is too large. Choose one under 8 MB.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => bad(new OrgError('That image could not be read.'))
      i.src = url
    })
    const scale = Math.min(1, 256 / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * scale))
    c.height = Math.max(1, Math.round(img.height * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    for (const [type, q] of [['image/webp', 0.85], ['image/webp', 0.6], ['image/png', undefined]] as const) {
      const d = c.toDataURL(type, q)
      if (d.startsWith(`data:${type}`) && d.length <= 270_000) return d
    }
    throw new OrgError('That image is still too large after shrinking. Try a simpler logo.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
