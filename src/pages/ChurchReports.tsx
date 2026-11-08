/**
 * Workspace reports (Release 6.2, Stage F): course enrollment, completion, scores, written work, attendance, and
 * group participation, from saved activity only, with spreadsheet (CSV) export. Administrators see the whole
 * workspace; instructors their own courses; group leaders their own groups.
 */
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Empty, ErrorBox, Loading, downloadBlob, slug, useAsync } from '../components/ui'
import { rank } from '../lib/cloud/orgs'
import { myTeaching, csv } from '../lib/cloud/orgCourses'
import { myGroupRows } from '../lib/cloud/orgGroups'
import { workspaceReports, type CourseRow, type GroupRow } from '../lib/cloud/orgReports'
import type { OrgCtx } from './ChurchPages'

const show = (v: number | null, suffix = '') => (v === null ? 'n/a' : `${v}${suffix}`)

export function ReportsTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const isAdmin = rank(me.role) >= 5
  const data = useAsync(async () => {
    const [r, teach, rows] = await Promise.all([workspaceReports(org.id), myTeaching(org.id), myGroupRows(org.id)])
    const leads = new Set(rows.filter((x) => x.role === 'leader' && x.status === 'active').map((x) => x.group_id))
    return {
      ...r,
      courses: r.courses.filter((c) => isAdmin || teach.has(c.id)),
      groups: r.groups.filter((g) => isAdmin || leads.has(g.id)),
    }
  }, [org.id, isAdmin])
  if (data.loading && !data.data) return <Loading label="Preparing reports" />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { courses, groups, generatedAt } = data.data!
  const day = generatedAt.slice(0, 10)
  const courseCsv = () =>
    downloadBlob(
      new Blob(
        [
          csv([
            ['Course', 'Status', 'Version', 'Enrolled', 'Active', 'Completed', 'Withdrawn', 'Completion rate %', 'Lessons in course', 'Average lessons done', 'Quiz attempts', 'Average best quiz score %', 'Written answers', 'Written answers graded', 'Class sessions', 'Attendance rate % (present or late)'],
            ...courses.map((c) => [c.title, c.status, c.version, c.enrolled, c.active, c.completed, c.withdrawn, c.completionRate, c.lessons, c.avgLessonsDone, c.quizAttempts, c.avgBestScore, c.written, c.writtenGraded, c.sessions, c.attendanceRate]),
          ]),
        ],
        { type: 'text/csv' },
      ),
      `${slug(org.name)}-courses-${day}.csv`,
    )
  const groupCsv = () =>
    downloadBlob(
      new Blob([csv([['Group', 'Members', 'Studies assigned', 'Responses submitted', 'Participation %', 'Discussion posts'], ...groups.map((g) => [g.name, g.members, g.studiesAssigned, g.submissions, g.participation, g.posts])])], { type: 'text/csv' }),
      `${slug(org.name)}-groups-${day}.csv`,
    )
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        {isAdmin ? 'The whole workspace.' : 'The courses you teach and the groups you lead.'} Built from saved course work, attendance an instructor recorded, and responses members
        submitted. Reports never include personal notes, sermons, unshared studies, or AI conversations. For each student's details, open a course's Manage page.
      </p>
      <section className="stack" aria-labelledby="rep-courses">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h2 id="rep-courses" style={{ margin: 0, fontSize: '1.15rem' }}>
            Courses
          </h2>
          <span className="spacer" />
          <button className="btn" onClick={courseCsv} disabled={!courses.length} data-testid="courses-csv">
            <Download size={16} aria-hidden /> Download as spreadsheet (CSV)
          </button>
        </div>
        {!courses.length ? <Empty>No courses to report on.</Empty> : <CourseTable rows={courses} orgId={org.id} />}
      </section>
      <section className="stack" aria-labelledby="rep-groups">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <h2 id="rep-groups" style={{ margin: 0, fontSize: '1.15rem' }}>
            Groups
          </h2>
          <span className="spacer" />
          <button className="btn" onClick={groupCsv} disabled={!groups.length} data-testid="groups-csv">
            <Download size={16} aria-hidden /> Download as spreadsheet (CSV)
          </button>
        </div>
        {!groups.length ? <Empty>No groups to report on.</Empty> : <GroupTable rows={groups} orgId={org.id} />}
      </section>
      <p className="muted small" style={{ margin: 0 }}>
        Prepared {new Date(generatedAt).toLocaleString()}.{' '}
        <button className="btn small" onClick={data.reload}>
          Refresh
        </button>
      </p>
    </div>
  )
}

function CourseTable({ rows, orgId }: { rows: CourseRow[]; orgId: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" data-testid="course-report">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Enrolled</th>
            <th scope="col">Completed</th>
            <th scope="col">Avg. lessons done</th>
            <th scope="col">Avg. best quiz</th>
            <th scope="col">Written (graded)</th>
            <th scope="col">Attendance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/church/${orgId}/courses/${c.id}/manage`}>{c.title}</Link>
              </td>
              <td>
                {c.enrolled}
                {c.withdrawn ? <span className="muted small"> ({c.withdrawn} withdrew)</span> : null}
              </td>
              <td>
                {c.completed} <span className="muted small">({show(c.completionRate, '%')})</span>
              </td>
              <td>
                {show(c.avgLessonsDone)} <span className="muted small">of {c.lessons}</span>
              </td>
              <td>{show(c.avgBestScore, '%')}</td>
              <td>
                {c.written} ({c.writtenGraded})
              </td>
              <td>
                {show(c.attendanceRate, '%')} <span className="muted small">over {c.sessions} session{c.sessions === 1 ? '' : 's'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupTable({ rows, orgId }: { rows: GroupRow[]; orgId: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table" data-testid="group-report">
        <thead>
          <tr>
            <th scope="col">Group</th>
            <th scope="col">Members</th>
            <th scope="col">Studies assigned</th>
            <th scope="col">Responses submitted</th>
            <th scope="col">Participation</th>
            <th scope="col">Discussion posts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                <Link to={`/church/${orgId}/groups/${g.id}`}>{g.name}</Link>
              </td>
              <td>{g.members}</td>
              <td>{g.studiesAssigned}</td>
              <td>{g.submissions}</td>
              <td>{show(g.participation, '%')}</td>
              <td>{g.posts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
