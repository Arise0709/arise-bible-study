/**
 * Shared teaching resources and announcements (Release 6.2, Stage E).
 *
 * Sharing always sends a COPY that its owner chose to make. The original stays in the owner's private records on
 * their devices; nothing personal is shared automatically. The owner can update the copy from their latest
 * version, invite editors, or withdraw it (the copy is deleted). Workspace-wide shares from members wait for an
 * administrator's approval; shares to a group the member belongs to appear there at once.
 */
import type { Lesson, Sermon, Study } from '../../db/types'
import { cloud } from './manager'
import { OrgError } from './orgs'

export type ShareKind = 'study' | 'sermon_outline' | 'lesson' | 'scripture_collection' | 'handout' | 'note'
export const KIND_LABEL: Record<ShareKind, string> = {
  study: 'Bible study',
  sermon_outline: 'Sermon or lesson outline',
  lesson: 'Course lesson',
  scripture_collection: 'Scripture collection',
  handout: 'Handout',
  note: 'Research note',
}
export type ShareContent =
  | { study: Omit<Study, 'folderId'> }
  | { sermon: Omit<Sermon, 'folderId' | 'studyId'> }
  | { lesson: Omit<Lesson, 'instructorNotes'> }
  | { refs: string[]; note: string }
  | { name: string; type: string; size: number; data: string }
  | { text: string }
export interface SharedResource {
  id: string
  org_id: string
  group_id: string | null
  owner_id: string
  kind: ShareKind
  title: string
  description: string
  content: ShareContent
  source_id: string | null
  access: 'view' | 'edit'
  approved_at: string | null
  created_at: string
  updated_at: string
  updated_by: string | null
}
export const HANDOUT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/png', 'image/jpeg']
export const HANDOUT_MAX = 2_000_000

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) {
    const m = r.error.message || ''
    if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) throw new OrgError('Could not reach the server. Check your connection and try again.')
    if (/permission denied|row-level security/i.test(m)) throw new OrgError('You do not have permission to do that.')
    if (/pg_column_size|check constraint/i.test(m)) throw new OrgError('That is too large to share. Try a smaller file or fewer attachments.')
    throw new OrgError(m.length < 300 ? m : 'Something went wrong. Try again.')
  }
  return r.data as T
}

/** What a copy of a personal record contains: only the item itself (no folders, no links to other private records). */
export function copyOf(kind: 'study', s: Study): ShareContent
export function copyOf(kind: 'sermon_outline', s: Sermon): ShareContent
export function copyOf(kind: 'lesson', l: Lesson): ShareContent
export function copyOf(kind: 'study' | 'sermon_outline' | 'lesson', x: Study | Sermon | Lesson): ShareContent {
  if (kind === 'study') {
    const { folderId: _f, ...rest } = x as Study
    void _f
    return { study: rest }
  }
  if (kind === 'sermon_outline') {
    const { folderId: _f, studyId: _s, ...rest } = x as Sermon
    void _f
    void _s
    return { sermon: rest }
  }
  const { instructorNotes: _n, ...rest } = x as Lesson
  void _n
  return { lesson: rest }
}

export async function shared(orgId: string): Promise<SharedResource[]> {
  return must(await cloud().from('org_shared_resources').select('*').eq('org_id', orgId).order('updated_at', { ascending: false }).limit(300))
}
export async function sharedOne(id: string): Promise<SharedResource | null> {
  return (must(await cloud().from('org_shared_resources').select('*').eq('id', id).limit(1)) as SharedResource[])[0] ?? null
}
export async function share(orgId: string, groupId: string | null, p: { kind: ShareKind; title: string; description?: string; content: ShareContent; source_id?: string }): Promise<string> {
  return must(await cloud().rpc('share_resource', { o: orgId, gid: groupId, p })) as string
}
export async function updateShare(id: string, p: { title?: string; description?: string; content?: ShareContent; access?: 'view' | 'edit' }) {
  must(await cloud().rpc('update_shared_resource', { rid: id, p }))
}
export async function revokeShare(id: string) {
  must(await cloud().rpc('revoke_shared_resource', { rid: id }))
}
export async function approveShare(id: string) {
  must(await cloud().rpc('approve_shared_resource', { rid: id }))
}
export async function editors(id: string): Promise<string[]> {
  return (must(await cloud().from('org_resource_editors').select('user_id').eq('resource_id', id)) as { user_id: string }[]).map((r) => r.user_id)
}
export async function setEditor(id: string, userId: string, allow: boolean) {
  must(await cloud().rpc('set_resource_editor', { rid: id, u: userId, allow }))
}

/* ---------------- announcements (shown in the app only; never emailed) ---------------- */

export interface Announcement {
  id: string
  org_id: string
  group_id: string | null
  course_id: string | null
  title: string
  body: string
  pinned: boolean
  expires_on: string | null
  created_by: string | null
  created_at: string
}
export async function announcements(orgId: string): Promise<Announcement[]> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = must(await cloud().from('org_announcements').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100)) as Announcement[]
  return rows.filter((a) => !a.expires_on || a.expires_on >= today).sort((a, b) => Number(b.pinned) - Number(a.pinned))
}
export async function readIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  return new Set((must(await cloud().from('org_announcement_reads').select('announcement_id').in('announcement_id', ids)) as { announcement_id: string }[]).map((r) => r.announcement_id))
}
export async function markRead(ids: string[]) {
  const uid = (await cloud().auth.getSession()).data.session?.user.id
  if (!uid || !ids.length) return
  await cloud().from('org_announcement_reads').upsert(ids.map((announcement_id) => ({ announcement_id, user_id: uid })), { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
}
export async function postAnnouncement(orgId: string, p: { title: string; body: string; group_id?: string; course_id?: string; pinned?: boolean; expires_on?: string }): Promise<string> {
  return must(await cloud().rpc('post_announcement', { o: orgId, p })) as string
}
export async function deleteAnnouncement(id: string) {
  must(await cloud().rpc('delete_announcement', { aid: id }))
}
/** How many announcements the caller has not read yet (for the section's badge). */
export async function unreadCount(orgId: string): Promise<number> {
  const list = await announcements(orgId)
  const read = await readIds(list.map((a) => a.id))
  return list.filter((a) => !read.has(a.id)).length
}
