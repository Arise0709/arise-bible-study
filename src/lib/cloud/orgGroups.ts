/**
 * Group Bible studies (Release 6.2, Stage D): groups, group studies, responses, and moderated discussions.
 * The database decides every permission. A member's response stays theirs alone until they submit it; personal
 * notes, highlights, sermons and studies are never read here.
 */
import { cloud } from './manager'
import { OrgError } from './orgs'

export interface OrgGroup {
  id: string
  org_id: string
  name: string
  description: string
  topic: string
  visibility: 'private' | 'invite' | 'org'
  schedule: string
  discussions: boolean
  created_at: string
  archived_at: string | null
}
export interface GroupMember {
  group_id: string
  user_id: string
  role: 'leader' | 'member'
  status: 'active' | 'requested' | 'removed'
  added_at: string
}
export type StudyResource =
  | { kind: 'commentary'; work: string; ref: string }
  | { kind: 'link'; url: string; title: string }
  | { kind: 'passage'; ref: string; note?: string }
export interface GroupStudy {
  id: string
  group_id: string
  title: string
  passage: string
  instructions: string
  questions: string[]
  resources: StudyResource[]
  due_on: string | null
  status: 'draft' | 'assigned' | 'closed'
  created_at: string
  updated_at: string
}
export interface GroupResponse {
  study_id: string
  user_id: string
  answers: Record<string, string>
  reflection: string
  read_done: boolean
  status: 'draft' | 'submitted'
  submitted_at: string | null
  updated_at: string
  leader_note: string
}
export interface Topic {
  id: string
  group_id: string
  title: string
  study_id: string | null
  locked: boolean
  created_by: string | null
  created_at: string
}
export interface Post {
  id: string
  topic_id: string
  author_id: string
  body: string
  created_at: string
  edited_at: string | null
  hidden_at: string | null
}
export interface ContentReport {
  id: string
  group_id: string | null
  reporter: string | null
  target_kind: 'post' | 'resource'
  target_id: string
  reason: string
  created_at: string
  resolved_at: string | null
  outcome: string | null
}
export const VISIBILITY_LABEL = {
  private: 'Private (the leader adds members)',
  invite: 'By invitation only',
  org: 'Listed for workspace members (they ask to join, the leader approves)',
} as const

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) {
    const m = r.error.message || ''
    if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) throw new OrgError('Could not reach the server. Check your connection and try again.')
    if (/permission denied|row-level security/i.test(m)) throw new OrgError('You do not have permission to do that.')
    throw new OrgError(m.length < 300 ? m : 'Something went wrong. Try again.')
  }
  return r.data as T
}
export const myId = async () => (await cloud().auth.getSession()).data.session?.user.id ?? ''

/* ---------------- groups and members ---------------- */

export async function groups(orgId: string): Promise<OrgGroup[]> {
  return must(await cloud().from('org_groups').select('*').eq('org_id', orgId).order('name'))
}
export async function group(id: string): Promise<OrgGroup | null> {
  return (must(await cloud().from('org_groups').select('*').eq('id', id).limit(1)) as OrgGroup[])[0] ?? null
}
export async function myGroupRows(orgId: string): Promise<GroupMember[]> {
  return must(await cloud().from('org_group_members').select('group_id, user_id, role, status, added_at').eq('org_id', orgId).eq('user_id', await myId()))
}
export async function groupMembers(groupId: string): Promise<GroupMember[]> {
  return must(await cloud().from('org_group_members').select('group_id, user_id, role, status, added_at').eq('group_id', groupId).neq('status', 'removed'))
}
export async function saveGroup(orgId: string, groupId: string | null, p: Partial<OrgGroup> & { leader?: string; archived?: boolean }): Promise<string> {
  return must(await cloud().rpc('save_group', { o: orgId, gid: groupId, p })) as string
}
/** Adds or promotes a member (role), or removes them (null). A member can remove themselves (leave). */
export async function setGroupMember(groupId: string, userId: string, role: 'leader' | 'member' | null) {
  must(await cloud().rpc('set_group_member', { gid: groupId, u: userId, r: role }))
}
export async function requestToJoin(groupId: string) {
  must(await cloud().rpc('request_to_join_group', { gid: groupId }))
}
/** Display names of people the caller may see (the database limits it). */
export async function names(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return new Map()
  const rows = must(await cloud().from('org_members').select('user_id, display_name').eq('org_id', orgId).in('user_id', uniq)) as { user_id: string; display_name: string }[]
  return new Map(rows.map((r) => [r.user_id, r.display_name]))
}

/* ---------------- studies and responses ---------------- */

export async function studies(groupId: string): Promise<GroupStudy[]> {
  return must(await cloud().from('org_group_studies').select('*').eq('group_id', groupId).order('created_at', { ascending: false }))
}
export async function study(id: string): Promise<GroupStudy | null> {
  return (must(await cloud().from('org_group_studies').select('*').eq('id', id).limit(1)) as GroupStudy[])[0] ?? null
}
export async function saveStudy(groupId: string, studyId: string | null, p: Partial<Omit<GroupStudy, 'id' | 'group_id'>>): Promise<string> {
  return must(await cloud().rpc('save_group_study', { gid: groupId, sid: studyId, p })) as string
}
export async function myResponse(studyId: string): Promise<GroupResponse | null> {
  return (must(await cloud().from('org_group_responses').select('*').eq('study_id', studyId).eq('user_id', await myId()).limit(1)) as GroupResponse[])[0] ?? null
}
/** Saves the caller's own response (draft or submitted). Drafts are private to them. */
export async function saveResponse(studyId: string, p: { answers: Record<string, string>; reflection: string; read_done: boolean; status: 'draft' | 'submitted' }) {
  const uid = await myId()
  const have = await myResponse(studyId)
  if (have) must(await cloud().from('org_group_responses').update({ ...p, updated_at: new Date().toISOString() }).eq('study_id', studyId).eq('user_id', uid).select('study_id'))
  else must(await cloud().from('org_group_responses').insert({ study_id: studyId, user_id: uid, ...p }).select('study_id'))
}
/** Submitted responses (the leader's view; drafts never appear here). */
export async function responses(studyId: string): Promise<GroupResponse[]> {
  return must(await cloud().from('org_group_responses').select('*').eq('study_id', studyId).eq('status', 'submitted').order('submitted_at'))
}
export async function submittedCounts(studyIds: string[]): Promise<Map<string, number>> {
  if (!studyIds.length) return new Map()
  const rows = must(await cloud().from('org_group_responses').select('study_id').in('study_id', studyIds).eq('status', 'submitted')) as { study_id: string }[]
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.study_id, (m.get(r.study_id) ?? 0) + 1)
  return m
}
export async function noteOnResponse(studyId: string, userId: string, note: string) {
  must(await cloud().rpc('note_on_response', { sid: studyId, u: userId, note }))
}

/* ---------------- discussions ---------------- */

export async function topics(groupId: string): Promise<Topic[]> {
  return must(await cloud().from('org_discussion_topics').select('*').eq('group_id', groupId).order('created_at', { ascending: false }))
}
export async function createTopic(groupId: string, title: string, studyId?: string): Promise<string> {
  return must(await cloud().rpc('create_topic', { gid: groupId, title, sid: studyId ?? null })) as string
}
export async function posts(topicId: string): Promise<Post[]> {
  return must(await cloud().from('org_discussion_posts').select('id, topic_id, author_id, body, created_at, edited_at, hidden_at').eq('topic_id', topicId).order('created_at').limit(500))
}
export async function addPost(topicId: string, body: string) {
  must(await cloud().from('org_discussion_posts').insert({ topic_id: topicId, author_id: await myId(), body: body.trim() }).select('id'))
}
export async function editPost(id: string, body: string) {
  must(await cloud().from('org_discussion_posts').update({ body: body.trim(), edited_at: new Date().toISOString() }).eq('id', id).select('id'))
}
export async function moderate(kind: 'post' | 'topic', id: string, action: 'hide' | 'show' | 'lock' | 'unlock' | 'delete') {
  must(await cloud().rpc('moderate', { kind, target: id, act: action }))
}
export async function report(kind: 'post' | 'resource', id: string, reason: string): Promise<string> {
  return must(await cloud().rpc('report_content', { kind, target: id, reason })) as string
}
export async function openReports(filter: { group?: string; org?: string }): Promise<ContentReport[]> {
  let q = cloud().from('org_content_reports').select('*').is('resolved_at', null).order('created_at')
  if (filter.group) q = q.eq('group_id', filter.group)
  if (filter.org) q = q.eq('org_id', filter.org)
  return must(await q)
}
export async function resolveReport(id: string, outcome: 'hidden' | 'removed' | 'no_action') {
  must(await cloud().rpc('resolve_report', { rid: id, outcome }))
}
