/**
 * Workspace reports (Release 6.2, Stage F), built only from saved activity the caller is already allowed to see:
 * administrators see the whole workspace; instructors see their own courses; group leaders see their own groups.
 * The database applies those limits. Reports never include personal notes, sermons, unshared study history, AI
 * conversations, or anyone's personal details beyond the display name they gave the workspace.
 */
import { cloud } from './manager'
import { OrgError } from './orgs'

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

interface RawCourse {
  id: string
  title: string
  status: string
  version: number
  enrolled: number
  active: number
  completed: number
  withdrawn: number
  lessons: number
  progress: number
  quizAttempts: number
  avgBestScore: number | null
  written: number
  writtenGraded: number
  sessions: number
  attPresent: number
  attTotal: number
}
type RawGroup = Omit<GroupRow, 'participation'>

/** One database call: the permission is checked once and the counts are added up in the database. */
export async function workspaceReports(orgId: string): Promise<Reports> {
  const { data, error } = await cloud().rpc('org_report', { o: orgId })
  if (error) throw new OrgError(/Failed to fetch|NetworkError/i.test(error.message) ? 'Could not reach the server. Check your connection and try again.' : error.message)
  const r = data as { courses: RawCourse[]; groups: RawGroup[]; generatedAt: string }
  return {
    courses: r.courses.map((c) => {
      const counted = c.enrolled - c.withdrawn
      return {
        id: c.id,
        title: c.title,
        status: c.status,
        version: c.version,
        enrolled: c.enrolled,
        active: c.active,
        completed: c.completed,
        withdrawn: c.withdrawn,
        completionRate: pct(c.completed, counted),
        avgLessonsDone: counted ? Math.round((c.progress / counted) * 10) / 10 : null,
        lessons: c.lessons,
        quizAttempts: c.quizAttempts,
        avgBestScore: c.avgBestScore === null ? null : Number(c.avgBestScore),
        written: c.written,
        writtenGraded: c.writtenGraded,
        sessions: c.sessions,
        attendanceRate: pct(c.attPresent, c.attTotal),
      }
    }),
    groups: r.groups.map((g) => ({ ...g, participation: pct(g.submissions, g.studiesAssigned * g.members) })),
    generatedAt: r.generatedAt,
  }
}
