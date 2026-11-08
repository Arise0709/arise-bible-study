/**
 * Workspace reports (Release 6.2, Stage F), built only from saved activity the caller is already allowed to see:
 * administrators see the whole workspace; instructors see their own courses; group leaders see their own groups.
 * The database applies those limits. Reports never include personal notes, sermons, unshared study history, AI
 * conversations, or anyone's personal details beyond the display name they gave the workspace.
 */
import { cloud } from './manager'
import { OrgError } from './orgs'

/** Reads every row the caller may see, a page at a time (the server returns at most 1000 rows per request). */
type Filter = { eq: (c: string, v: string) => Filter; in: (c: string, v: string[]) => Filter }
async function allRows<T>(table: string, columns: string, orgId: string, extra?: (q: Filter) => Filter): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = cloud().from(table).select(columns).eq('org_id', orgId).range(from, from + 999) as unknown as Filter
    if (extra) q = extra(q)
    const { data, error } = (await (q as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>))
    if (error) throw new OrgError(/Failed to fetch|NetworkError/i.test(error.message) ? 'Could not reach the server. Check your connection and try again.' : error.message)
    out.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) return out
  }
}

export interface CourseRow {
  id: string
  title: string
  status: string
  version: number
  enrolled: number
  active: number
  completed: number
  withdrawn: number
  completionRate: number | null // completed out of everyone not withdrawn
  avgLessonsDone: number | null
  lessons: number
  quizAttempts: number
  avgBestScore: number | null
  written: number
  writtenGraded: number
  sessions: number
  attendanceRate: number | null // present or late, out of attendance recorded
}
export interface GroupRow {
  id: string
  name: string
  members: number
  studiesAssigned: number
  submissions: number
  participation: number | null // submissions out of (assigned studies x members)
  posts: number
}
export interface Reports {
  courses: CourseRow[]
  groups: GroupRow[]
  generatedAt: string
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null)

export async function workspaceReports(orgId: string): Promise<Reports> {
  type C = { id: string; title: string; status: string; published_version: number }
  type E = { id: string; course_id: string; status: string; version: number }
  type P = { enrollment_id: string }
  type A = { enrollment_id: string; course_id: string; score: number }
  type W = { course_id: string; graded_at: string | null }
  type S = { id: string; course_id: string }
  type At = { session_id: string; status: string }
  type V = { course_id: string; version: number; content: { course: { units: { lessonIds: string[] }[] } } }
  type G = { id: string; name: string; archived_at: string | null }
  type GM = { group_id: string; role: string; status: string }
  type St = { id: string; group_id: string; status: string }
  type R = { study_id: string }
  type T = { id: string; group_id: string }
  type Po = { topic_id: string }

  const [courses, enr, prog, att, written, sess, attendance, groups, gm, studies, resp, topics, posts] = await Promise.all([
    allRows<C>('org_courses', 'id, title, status, published_version', orgId),
    allRows<E>('org_enrollments', 'id, course_id, status, version', orgId),
    allRows<P>('org_lesson_progress', 'enrollment_id', orgId),
    allRows<A>('org_quiz_attempts', 'enrollment_id, course_id, score', orgId),
    allRows<W>('org_written_answers', 'course_id, graded_at', orgId),
    allRows<S>('org_sessions', 'id, course_id', orgId),
    allRows<At>('org_attendance', 'session_id, status', orgId),
    allRows<G>('org_groups', 'id, name, archived_at', orgId),
    allRows<GM>('org_group_members', 'group_id, role, status', orgId),
    allRows<St>('org_group_studies', 'id, group_id, status', orgId),
    allRows<R>('org_group_responses', 'study_id', orgId, (q) => q.eq('status', 'submitted')),
    allRows<T>('org_discussion_topics', 'id, group_id', orgId),
    allRows<Po>('org_discussion_posts', 'topic_id', orgId),
  ])
  // lesson counts come from the published versions the caller may read (staff only)
  const staffCourses = [...new Set(enr.map((e) => e.course_id))]
  const versions = staffCourses.length ? await allRows<V>('org_course_versions', 'course_id, version, content', orgId, (q) => q.in('course_id', staffCourses)) : []
  const lessonsIn = (cid: string, v: number) => versions.find((x) => x.course_id === cid && x.version === v)?.content.course.units.reduce((n, u) => n + u.lessonIds.length, 0) ?? 0

  const visibleCourses = courses.filter((c) => enr.some((e) => e.course_id === c.id) || sess.some((s) => s.course_id === c.id) || versions.some((v) => v.course_id === c.id))
  const courseRows: CourseRow[] = visibleCourses.map((c) => {
    const es = enr.filter((e) => e.course_id === c.id)
    const ids = new Set(es.map((e) => e.id))
    const notWithdrawn = es.filter((e) => e.status !== 'withdrawn')
    const done = prog.filter((p) => ids.has(p.enrollment_id))
    const best = new Map<string, number>()
    for (const a of att.filter((x) => x.course_id === c.id)) best.set(a.enrollment_id, Math.max(best.get(a.enrollment_id) ?? 0, a.score))
    const ws = written.filter((w) => w.course_id === c.id)
    const ss = new Set(sess.filter((s) => s.course_id === c.id).map((s) => s.id))
    const at = attendance.filter((a) => ss.has(a.session_id))
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      version: c.published_version,
      enrolled: es.length,
      active: es.filter((e) => e.status === 'active').length,
      completed: es.filter((e) => e.status === 'completed').length,
      withdrawn: es.filter((e) => e.status === 'withdrawn').length,
      completionRate: pct(es.filter((e) => e.status === 'completed').length, notWithdrawn.length),
      avgLessonsDone: notWithdrawn.length ? Math.round((done.length / notWithdrawn.length) * 10) / 10 : null,
      lessons: lessonsIn(c.id, c.published_version),
      quizAttempts: att.filter((x) => x.course_id === c.id).length,
      avgBestScore: best.size ? Math.round([...best.values()].reduce((a, b) => a + b, 0) / best.size) : null,
      written: ws.length,
      writtenGraded: ws.filter((w) => w.graded_at).length,
      sessions: ss.size,
      attendanceRate: pct(at.filter((a) => a.status === 'present' || a.status === 'late').length, at.length),
    }
  })

  const topicGroup = new Map(topics.map((t) => [t.id, t.group_id]))
  const studyGroup = new Map(studies.map((s) => [s.id, s.group_id]))
  const groupRows: GroupRow[] = groups
    .filter((g) => !g.archived_at && gm.some((m) => m.group_id === g.id))
    .map((g) => {
      const memberCount = gm.filter((m) => m.group_id === g.id && m.status === 'active' && m.role === 'member').length
      const assigned = studies.filter((s) => s.group_id === g.id && s.status !== 'draft').length
      const subs = resp.filter((r) => studyGroup.get(r.study_id) === g.id).length
      return {
        id: g.id,
        name: g.name,
        members: memberCount,
        studiesAssigned: assigned,
        submissions: subs,
        participation: pct(subs, assigned * memberCount),
        posts: posts.filter((p) => topicGroup.get(p.topic_id) === g.id).length,
      }
    })
  return { courses: courseRows, groups: groupRows, generatedAt: new Date().toISOString() }
}
