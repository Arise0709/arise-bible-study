/**
 * Church courses (Release 6.2, Stage C): the workspace course library, the student course and lesson views, the
 * instructor's Manage page (students, grading, attendance, instructors, options, exports), and the course and lesson
 * editors (the same builder used for personal courses). Loaded only with the workspace pages.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Award, BookOpen, CheckCircle2, Circle, Download, Lock, Pencil, Plus, Printer, Settings2, Users } from 'lucide-react'
import { db } from '../db/db'
import type { Course, Lesson, Quiz } from '../db/types'
import { Dialog, Empty, ErrorBox, Loading, Tabs, downloadBlob, slug, toast, useAsync } from '../components/ui'
import { LinkedText } from '../components/Scripture'
import { courseLessons, isReleased, publishProblems } from '../lib/courses'
import { formatRef, parseOsis } from '../lib/refs'
import { cloud } from '../lib/cloud/manager'
import { ROLE_LABEL, members, myMemberships, rank, type Member, type Membership } from '../lib/cloud/orgs'
import {
  ATTENDANCE_LABEL,
  GRADE_LABEL,
  STATUS_LABEL,
  addSession,
  assignInstructor,
  attempts,
  attendance,
  claimCertificate,
  copyIntoWorkspace,
  courseEnrollments,
  courseInstructors,
  courseVersions,
  csv,
  deleteSession,
  enrollMembers,
  enrollSelf,
  fullVersion,
  gradeWritten,
  markLesson,
  moveToLatest,
  myEnrollment,
  myOrgEnrollments,
  myTeaching,
  openDraft,
  orgCourse,
  orgCourses,
  progress,
  publishOrgCourse,
  recordAttendance,
  release,
  reviewAttempt,
  saveWritten,
  sessions,
  setCourseOptions,
  setLastLesson,
  submitQuiz,
  withdraw,
  writtenAnswers,
  type AttendanceStatus,
  type CourseContent,
  type OrgAttempt,
  type OrgCourse,
  type OrgEnrollment,
  type QuizSubmitResult,
  type WrittenAnswer,
} from '../lib/cloud/orgCourses'
import type { OrgCtx } from './ChurchPages'
import { CourseEditorPage, LessonEditorPage, type OrgEditing } from './CourseBuilder'
import { LessonBlockView, PrimaryScripture, QuizForm, QuizResultView } from './CoursePages'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const refText = (o: string) => (parseOsis(o) ? formatRef(parseOsis(o)!) : o)
const lessonOrder = (c: CourseContent) => {
  const byId = new Map(c.lessons.map((l) => [l.id, l]))
  return c.course.units.flatMap((u) => u.lessonIds.map((id) => byId.get(id)).filter((l): l is Lesson => !!l))
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      if (done) toast(done)
      return true
    } catch (e) {
      setError(errText(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}
const Alert = ({ children }: { children: ReactNode }) =>
  children ? (
    <div className="notice error" role="alert">
      {children}
    </div>
  ) : null

/** Whether the caller is staff for a course: administrators and owners, or an assigned instructor. */
const isStaff = (me: Membership, teaching: Set<string>, courseId: string) => rank(me.role) >= 5 || (rank(me.role) >= 3 && teaching.has(courseId))

/* =============================== the Courses section of a workspace =============================== */

export function CoursesTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const data = useAsync(async () => {
    const [courses, mine, teaching] = await Promise.all([orgCourses(org.id), myOrgEnrollments(org.id), myTeaching(org.id)])
    const done = await progress(mine.map((e) => e.id))
    return { courses, mine, teaching, done }
  }, [org.id])
  const [adding, setAdding] = useState(false)
  const act = useAction()
  const nav = useNavigate()
  if (data.loading && !data.data) return <Loading label="Loading courses" />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { courses, mine, teaching, done } = data.data!
  const byId = new Map(courses.map((c) => [c.id, c]))
  const enrolled = new Map(mine.filter((e) => e.status !== 'withdrawn').map((e) => [e.course_id, e]))
  const catalog = courses.filter((c) => c.status === 'published' && c.catalog && !enrolled.has(c.id))
  const staffCourses = courses.filter((c) => isStaff(me, teaching, c.id))
  const otherForTeachers = rank(me.role) >= 4 ? courses.filter((c) => !isStaff(me, teaching, c.id) && !enrolled.has(c.id) && !catalog.includes(c)) : []
  const base = `/church/${org.id}/courses`
  return (
    <div className="stack">
      <section className="stack" aria-labelledby="my-courses-h">
        <h2 id="my-courses-h" style={{ margin: 0, fontSize: '1.15rem' }}>
          My courses
        </h2>
        {!enrolled.size ? (
          <Empty>You are not enrolled in a course here yet.{catalog.length ? ' See the catalog below.' : ''}</Empty>
        ) : (
          <ul className="list" data-testid="my-org-courses">
            {[...enrolled.values()].map((e) => {
              const c = byId.get(e.course_id)
              const n = done.filter((d) => d.enrollment_id === e.id).length
              return (
                <li key={e.id} className="row" style={{ flexWrap: 'wrap' }}>
                  <Link to={`${base}/${e.course_id}`} style={{ fontWeight: 600 }}>
                    {c?.title ?? 'Course'}
                  </Link>
                  <span className={`badge ${e.status === 'completed' ? 'source' : ''}`}>{e.status === 'completed' ? 'Completed' : `${n} lesson${n === 1 ? '' : 's'} done`}</span>
                  {e.deadline && e.status !== 'completed' && <span className="muted small">finish by {e.deadline}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {catalog.length > 0 && (
        <section className="stack" aria-labelledby="catalog-h">
          <h2 id="catalog-h" style={{ margin: 0, fontSize: '1.15rem' }}>
            Course catalog
          </h2>
          <Alert>{act.error}</Alert>
          <ul className="list" data-testid="org-catalog">
            {catalog.map((c) => (
              <li key={c.id} className="stack" style={{ gap: 4 }}>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Link to={`${base}/${c.id}`} style={{ fontWeight: 600 }}>
                    {c.title}
                  </Link>
                  <span className="spacer" />
                  <button
                    className="btn primary small"
                    disabled={act.busy}
                    onClick={() => void act.run(() => enrollSelf(c.id), `You are enrolled in ${c.title}.`).then((ok) => ok && nav(`${base}/${c.id}`))}
                  >
                    Enroll
                  </button>
                </div>
                {c.description && <span className="small">{c.description}</span>}
                {c.enroll_deadline && <span className="muted small">Enrollment closes {c.enroll_deadline}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(staffCourses.length > 0 || rank(me.role) >= 4) && (
        <section className="stack" aria-labelledby="teaching-h">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h2 id="teaching-h" style={{ margin: 0, fontSize: '1.15rem' }}>
              {rank(me.role) >= 5 ? 'All workspace courses' : 'Courses you teach'}
            </h2>
            <span className="spacer" />
            {rank(me.role) >= 4 && (
              <button className="btn" onClick={() => setAdding(true)} data-testid="add-org-course">
                <Plus size={16} aria-hidden /> Add a course
              </button>
            )}
          </div>
          {!staffCourses.length ? (
            <Empty>No courses yet. Add one from your own courses on this device, or start a new one.</Empty>
          ) : (
            <ul className="list" data-testid="teaching-list">
              {staffCourses.map((c) => (
                <li key={c.id} className="row" style={{ flexWrap: 'wrap' }}>
                  <strong>{c.title}</strong>
                  <span className={`badge ${c.status === 'published' ? 'source' : ''}`}>
                    {STATUS_LABEL[c.status]}
                    {c.published_version ? `, version ${c.published_version}` : ''}
                  </span>
                  {c.catalog && c.status === 'published' && <span className="muted small">in the catalog</span>}
                  <span className="spacer" />
                  <Link className="btn small" to={`${base}/${c.id}/edit`}>
                    <Pencil size={14} aria-hidden /> Edit
                  </Link>
                  <Link className="btn small" to={`${base}/${c.id}/manage`}>
                    <Settings2 size={14} aria-hidden /> Manage
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {otherForTeachers.length > 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              {otherForTeachers.length} other course{otherForTeachers.length === 1 ? '' : 's'} in this workspace {otherForTeachers.length === 1 ? 'is' : 'are'} taught by others.
            </p>
          )}
        </section>
      )}
      <AddCourseDialog orgId={org.id} open={adding} onClose={() => setAdding(false)} onAdded={(id) => nav(`${base}/${id}/edit`)} />
    </div>
  )
}

function AddCourseDialog({ orgId, open, onClose, onAdded }: { orgId: string; open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const mine = useAsync(async () => (open ? (await db.courses.toArray()).filter((c) => c.role === 'instructor' && c.status !== 'archived') : []), [open])
  const [pick, setPick] = useState('__new')
  const act = useAction()
  return (
    <Dialog open={open} onClose={onClose} title="Add a course to this workspace">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          let id = ''
          void act
            .run(async () => {
              if (pick === '__new') {
                const now = Date.now()
                const course: Course = {
                  id: crypto.randomUUID(), title: 'Untitled course', description: '', objectives: [], category: 'Foundations', level: 'beginner', duration: '', perspective: '',
                  author: '', organization: '', units: [{ id: crypto.randomUUID(), title: 'Unit 1', lessonIds: [] }], completion: { lessons: true, quizzes: false, attendance: 0 },
                  certificate: { enabled: false, instructor: '' }, status: 'draft', version: 0, origin: 'authored', role: 'instructor', createdAt: now, updatedAt: now,
                }
                id = await copyIntoWorkspace(orgId, { course, lessons: [] })
              } else {
                const c = (await db.courses.get(pick))!
                id = await copyIntoWorkspace(orgId, { course: c, lessons: await courseLessons(c) }, c.id)
              }
            }, 'Course added to the workspace.')
            .then((ok) => {
              if (ok) {
                onClose()
                onAdded(id)
              }
            })
        }}
      >
        <fieldset className="stack" style={{ gap: 6 }}>
          <legend>
            <strong>Start from</strong>
          </legend>
          <label className="row">
            <input type="radio" name="from" checked={pick === '__new'} onChange={() => setPick('__new')} /> A new, empty course
          </label>
          {(mine.data ?? []).map((c) => (
            <label key={c.id} className="row">
              <input type="radio" name="from" checked={pick === c.id} onChange={() => setPick(c.id)} /> A copy of my course "{c.title}"
            </label>
          ))}
        </fieldset>
        <p className="muted small" style={{ margin: 0 }}>
          A copy becomes a workspace course that this workspace's instructors and administrators can edit. Your own course on this device stays yours and is not changed or
          linked. Later edits to one do not change the other.
        </p>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Add course
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* =============================== shared loading for course routes =============================== */

interface CourseCtx {
  orgId: string
  me: Membership
  course: OrgCourse
  staff: boolean
  base: string
}

function useCourseCtx(): { loading: boolean; error?: Error; ctx?: CourseCtx; reload: () => void } {
  const { orgId = '', courseId = '' } = useParams()
  const r = useAsync(async () => {
    const [all, course, teaching] = await Promise.all([myMemberships(), orgCourse(courseId), myTeaching(orgId)])
    const me = all.find((m) => m.org.id === orgId)
    if (!me || !course || course.org_id !== orgId) return undefined
    return { orgId, me, course, staff: isStaff(me, teaching, courseId), base: `/church/${orgId}/courses/${courseId}` }
  }, [orgId, courseId])
  return { loading: r.loading && !r.data, error: r.error, ctx: r.data, reload: r.reload }
}

function NotAvailable({ orgId }: { orgId: string }) {
  return (
    <div className="page stack" style={{ maxWidth: 720 }}>
      <h1>Course not available</h1>
      <p>This course is not open to you, or it no longer exists.</p>
      <p>
        <Link to={`/church/${orgId}?tab=courses`}>Back to courses</Link>
      </p>
    </div>
  )
}

function Crumbs({ ctx, here }: { ctx: CourseCtx; here?: string }) {
  return (
    <span>
      <Link to={`/church/${ctx.orgId}`}>{ctx.me.org.name}</Link> / <Link to={`/church/${ctx.orgId}?tab=courses`}>Courses</Link>
      {here ? ` / ${here}` : ''}
    </span>
  )
}

/* =============================== editing (the same builder as personal courses) =============================== */

export function OrgCourseEditRoute({ lesson }: { lesson?: boolean }) {
  const { orgId = '', courseId = '' } = useParams()
  const c = useCourseCtx()
  const draft = useAsync(() => openDraft(courseId), [courseId])
  if (c.loading || (draft.loading && !draft.data)) return <Loading label="Loading the course" />
  if (c.error) return <div className="page"><ErrorBox error={c.error} onRetry={c.reload} /></div>
  if (!c.ctx || !c.ctx.staff) return <NotAvailable orgId={orgId} />
  if (draft.error) return <div className="page"><ErrorBox error={draft.error} onRetry={draft.reload} /></div>
  const org: OrgEditing = {
    draft: draft.data!,
    base: c.ctx.base,
    crumbs: <Crumbs ctx={c.ctx} />,
    header: <OrgCourseHeader ctx={c.ctx} draft={draft.data!} onChanged={c.reload} />,
    footer: <VersionList courseId={courseId} />,
  }
  return lesson ? <LessonEditorPage org={org} /> : <CourseEditorPage org={org} />
}

function OrgCourseHeader({ ctx, draft, onChanged }: { ctx: CourseCtx; draft: OrgEditing['draft']; onChanged: () => void }) {
  const { course, me } = ctx
  const [problems, setProblems] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const act = useAction()
  const needsReview = rank(me.role) < 5 && (rank(me.role) < 4 || me.org.require_course_review)
  /** Saves waiting edits, checks the course like a personal publish does, then runs the action. */
  const checked = (fn: () => Promise<unknown>, done?: string) =>
    void act.run(async () => {
      await draft.flush()
      const p = publishProblems(draft.course, draft.lessons())
      setProblems(p)
      if (!p.length) {
        await fn()
        if (done) toast(done)
        onChanged()
      }
    })
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className={`badge ${course.status === 'published' ? 'source' : ''}`} data-testid="org-course-status">
          {STATUS_LABEL[course.status]}
          {course.published_version ? `, version ${course.published_version}` : ''}
        </span>
        {needsReview ? (
          course.status !== 'review' ? (
            <button className="btn primary" disabled={act.busy} onClick={() => checked(() => setCourseOptions(course.id, { status: 'review' }), 'Sent for review. An administrator will publish it.')}>
              Submit for review
            </button>
          ) : (
            <span className="muted small">Waiting for an administrator to review and publish.</span>
          )
        ) : (
          <>
            <label className="sr-only" htmlFor="pub-notes">
              What changed (optional)
            </label>
            <input id="pub-notes" placeholder="What changed (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minWidth: 200 }} />
            <button
              className="btn primary"
              disabled={act.busy}
              data-testid="org-publish"
              onClick={() =>
                checked(async () => {
                  const v = await publishOrgCourse(course.id, notes)
                  toast(`Published version ${v}. Students already enrolled keep the version they started until they choose to update.`)
                  setNotes('')
                })
              }
            >
              {course.published_version ? 'Publish an update' : 'Publish to the workspace'}
            </button>
          </>
        )}
        <Link className="btn" to={`${ctx.base}?preview=1`}>
          Preview as a student
        </Link>
        <Link className="btn" to={`${ctx.base}/manage`}>
          <Settings2 size={16} aria-hidden /> Manage students
        </Link>
      </div>
      {problems.length > 0 && (
        <div className="notice warn" role="alert" data-testid="publish-problems">
          <strong>Not published yet:</strong>
          <ul style={{ margin: '4px 0 0' }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <Alert>{act.error}</Alert>
      <p className="muted small" style={{ margin: 0 }}>
        This course belongs to {me.org.name}. Edits save to the workspace for its instructors. Students see only published versions, and a new version never changes work students
        already completed.
      </p>
    </div>
  )
}

function VersionList({ courseId }: { courseId: string }) {
  const v = useAsync(() => courseVersions(courseId), [courseId])
  if (!v.data?.length) return null
  return (
    <details>
      <summary>Version history ({v.data.length})</summary>
      <ul className="list">
        {v.data.map((x) => (
          <li key={x.version} className="small">
            <strong>Version {x.version}</strong>, published {new Date(x.published_at).toLocaleString()}
            {x.notes ? `: ${x.notes}` : ''}
          </li>
        ))}
      </ul>
    </details>
  )
}

/* =============================== the student's course view =============================== */

export function OrgCoursePage() {
  const { orgId = '' } = useParams()
  const [params] = useSearchParams()
  const preview = params.get('preview') === '1'
  const c = useCourseCtx()
  const data = useAsync(async () => {
    if (!c.ctx) return undefined
    const e = await myEnrollment(c.ctx.course.id)
    const usePreview = preview && c.ctx.staff
    const version = e && e.status !== 'withdrawn' ? e.version : c.ctx.course.published_version
    const content = usePreview ? (await openDraft(c.ctx.course.id, true)).content : version ? await release(c.ctx.course.id, version) : null
    const done = e ? (await progress([e.id])).map((p) => p.lesson_id) : []
    return { e, content, done, usePreview }
  }, [c.ctx?.course.id, preview])
  const act = useAction()
  useEffect(() => {
    if (c.ctx) document.title = `${c.ctx.course.title} · Arise Bible Study`
  }, [c.ctx])
  if (c.loading) return <Loading label="Loading the course" />
  if (c.error) return <div className="page"><ErrorBox error={c.error} onRetry={c.reload} /></div>
  if (!c.ctx) return <NotAvailable orgId={orgId} />
  if (data.error) return <div className="page"><ErrorBox error={data.error} onRetry={data.reload} /></div>
  if (!data.data) return <Loading label="Loading the course" />
  const ctx = c.ctx
  const { e, content, done, usePreview } = data.data
  const active = e && e.status !== 'withdrawn'
  if (!content)
    return (
      <div className="page stack" style={{ maxWidth: 820 }}>
        <p className="small" style={{ margin: 0 }}>
          <Crumbs ctx={ctx} />
        </p>
        <h1 style={{ margin: 0 }}>{ctx.course.title}</h1>
        <p>This course has not been published yet.</p>
        {ctx.staff && <Link to={`${ctx.base}/edit`}>Edit the course</Link>}
      </div>
    )
  const lessons = lessonOrder(content).filter((l) => usePreview || l.status === 'published')
  const doneSet = new Set(done)
  const pct = lessons.length ? Math.round((lessons.filter((l) => doneSet.has(l.id)).length / lessons.length) * 100) : 0
  const next = lessons.find((l) => !doneSet.has(l.id))
  const canEnroll = !active && ctx.course.status === 'published' && ctx.course.catalog && (!ctx.course.enroll_deadline || ctx.course.enroll_deadline >= new Date().toISOString().slice(0, 10))
  const course = content.course
  return (
    <div className="page stack" style={{ maxWidth: 860 }}>
      <p className="small" style={{ margin: 0 }}>
        <Crumbs ctx={ctx} here={course.title} />
      </p>
      {usePreview && <div className="notice info">Preview of the working copy (as students would see it after the next publish).</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{course.title}</h1>
        <span className="spacer" />
        {ctx.staff && (
          <>
            <Link className="btn small" to={`${ctx.base}/edit`}>
              <Pencil size={14} aria-hidden /> Edit
            </Link>
            <Link className="btn small" to={`${ctx.base}/manage`}>
              <Settings2 size={14} aria-hidden /> Manage
            </Link>
          </>
        )}
      </div>
      {course.description && <p style={{ margin: 0 }}>{course.description}</p>}
      {course.objectives.length > 0 && (
        <section>
          <h2 style={{ fontSize: '1.05rem' }}>You will learn to</h2>
          <ul>
            {course.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}
      {course.perspective && (
        <p className="small muted" style={{ margin: 0 }}>
          Perspective: {course.perspective}
        </p>
      )}
      <Alert>{act.error}</Alert>
      {active ? (
        <div className="card stack" data-testid="org-enrollment">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <strong>{e!.status === 'completed' ? 'Completed' : `${pct}% complete`}</strong>
            <div className="progress" style={{ flex: 1, minWidth: 120 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress">
              <div style={{ width: `${pct}%` }} />
            </div>
          </div>
          {e!.deadline && e!.status !== 'completed' && <span className="small">Finish by {e!.deadline}</span>}
          {e!.version < ctx.course.published_version && e!.status === 'active' && (
            <div className="notice info row" style={{ flexWrap: 'wrap' }}>
              <span>An updated version of this course is available. Lessons you finished stay finished.</span>
              <button className="btn small" disabled={act.busy} onClick={() => void act.run(() => moveToLatest(e!.id), 'Moved to the latest version.').then(() => data.reload())}>
                Use the updated version
              </button>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {next && (
              <Link className="btn primary" to={`${ctx.base}/lessons/${e!.last_lesson_id && !doneSet.has(e!.last_lesson_id) ? e!.last_lesson_id : next.id}`}>
                {done.length ? 'Continue' : 'Start the first lesson'}
              </Link>
            )}
            {e!.status === 'completed' && course.certificate.enabled && <Certificate ctx={ctx} e={e!} course={course} onClaim={data.reload} />}
            <span className="spacer" />
            {e!.status === 'active' && (
              <button className="btn small" onClick={() => confirm('Withdraw from this course? Your work so far is kept.') && void act.run(() => withdraw(e!.id), 'You withdrew from the course.').then(() => data.reload())}>
                Withdraw
              </button>
            )}
          </div>
        </div>
      ) : canEnroll ? (
        <div>
          <button className="btn primary" disabled={act.busy} onClick={() => void act.run(() => enrollSelf(ctx.course.id), 'You are enrolled.').then(() => data.reload())} data-testid="org-enroll">
            Enroll in this course
          </button>
        </div>
      ) : !ctx.staff ? (
        <p className="muted">{e?.status === 'withdrawn' ? 'You withdrew from this course.' : 'Enrollment is by invitation from an instructor.'}</p>
      ) : null}
      <section className="stack" aria-labelledby="lessons-h">
        <h2 id="lessons-h" style={{ margin: 0, fontSize: '1.15rem' }}>
          Lessons
        </h2>
        {course.units.map((u) => {
          const ls = u.lessonIds.map((id) => lessons.find((l) => l.id === id)).filter((l): l is Lesson => !!l)
          if (!ls.length) return null
          return (
            <div key={u.id} className="stack" style={{ gap: 4 }}>
              <strong>{u.title}</strong>
              <ol className="list" style={{ paddingLeft: 0 }}>
                {ls.map((l) => {
                  const open = usePreview || ctx.staff || isReleased(l)
                  return (
                    <li key={l.id} className="row">
                      {doneSet.has(l.id) ? <CheckCircle2 size={16} aria-label="Done" /> : open ? <Circle size={16} aria-label="Not done" /> : <Lock size={16} aria-label="Locked" />}
                      {open && (active || usePreview || ctx.staff) ? <Link to={`${ctx.base}/lessons/${l.id}${usePreview ? '?preview=1' : ''}`}>{l.title}</Link> : <span>{l.title}</span>}
                      {!open && <span className="muted small">opens {l.releaseOn}</span>}
                    </li>
                  )
                })}
              </ol>
            </div>
          )
        })}
      </section>
    </div>
  )
}

function Certificate({ ctx, e, course, onClaim }: { ctx: CourseCtx; e: OrgEnrollment; course: Course; onClaim: () => void }) {
  const [show, setShow] = useState(false)
  const act = useAction()
  return (
    <>
      <button
        className="btn"
        onClick={() => {
          if (e.certificate_at) setShow(true)
          else void act.run(() => claimCertificate(e.id)).then((ok) => ok && (onClaim(), setShow(true)))
        }}
      >
        <Award size={16} aria-hidden /> Certificate
      </button>
      <Alert>{act.error}</Alert>
      <Dialog open={show} onClose={() => setShow(false)} title="Certificate of completion" wide>
        <div className="stack" style={{ textAlign: 'center', padding: 24, border: '2px solid var(--border)', borderRadius: 8 }} data-testid="org-certificate">
          <span className="muted">Certificate of completion</span>
          <strong style={{ fontSize: '1.6rem' }}>{ctx.me.display_name}</strong>
          <span>completed</span>
          <strong style={{ fontSize: '1.3rem' }}>{course.title}</strong>
          <span>
            {ctx.me.org.name}
            {course.certificate.instructor ? ` · ${course.certificate.instructor}` : ''}
          </span>
          <span className="muted small">Completed {new Date(e.completed_at ?? e.certificate_at ?? Date.now()).toLocaleDateString()}. Recorded by the workspace from saved course work.</span>
        </div>
        <div className="row no-print" style={{ marginTop: 12 }}>
          <button className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden /> Print
          </button>
        </div>
      </Dialog>
    </>
  )
}

/* =============================== the student's lesson view =============================== */

export function OrgLessonPage() {
  const { orgId = '', lessonId = '' } = useParams()
  const [params] = useSearchParams()
  const preview = params.get('preview') === '1'
  const nav = useNavigate()
  const c = useCourseCtx()
  const data = useAsync(async () => {
    if (!c.ctx) return undefined
    const e = await myEnrollment(c.ctx.course.id)
    const usePreview = preview && c.ctx.staff
    const active = e && e.status !== 'withdrawn' ? e : null
    const version = active ? active.version : c.ctx.course.published_version
    const content = usePreview ? (await openDraft(c.ctx.course.id, true)).content : c.ctx.staff && !active ? await fullVersion(c.ctx.course.id, version) : version ? await release(c.ctx.course.id, version) : null
    const done = active ? (await progress([active.id])).map((p) => p.lesson_id) : []
    const mineWritten = active ? await writtenAnswers({ enrollment: active.id }) : []
    const mineAttempts = active ? await attempts({ enrollment: active.id }) : []
    return { e: active, content, done, usePreview, mineWritten, mineAttempts }
  }, [c.ctx?.course.id, preview, lessonId])
  const act = useAction()
  const lessonIdRef = useRef(lessonId)
  useEffect(() => {
    lessonIdRef.current = lessonId
    const e = data.data?.e
    if (e && e.last_lesson_id !== lessonId) void setLastLesson(e.id, lessonId)
  }, [data.data?.e, lessonId])
  if (c.loading) return <Loading label="Loading the lesson" />
  if (c.error) return <div className="page"><ErrorBox error={c.error} onRetry={c.reload} /></div>
  if (!c.ctx) return <NotAvailable orgId={orgId} />
  if (data.error) return <div className="page"><ErrorBox error={data.error} onRetry={data.reload} /></div>
  if (!data.data) return <Loading label="Loading the lesson" />
  const ctx = c.ctx
  const { e, content, done, usePreview, mineWritten, mineAttempts } = data.data!
  const lessons = content ? lessonOrder(content).filter((l) => usePreview || l.status === 'published') : []
  const i = lessons.findIndex((l) => l.id === lessonId)
  const lesson = lessons[i]
  if (!content || !lesson || (!e && !ctx.staff && !usePreview))
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Lesson not available</h1>
        <p>{!e && !ctx.staff ? 'Enroll in the course to open its lessons.' : 'This lesson is not part of the version you are taking.'}</p>
        <Link to={ctx.base}>Back to the course</Link>
      </div>
    )
  if (!usePreview && !ctx.staff && !isReleased(lesson))
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>{lesson.title}</h1>
        <p>This lesson opens on {lesson.releaseOn}.</p>
        <Link to={ctx.base}>Back to the course</Link>
      </div>
    )
  const isDone = done.includes(lesson.id)
  const prev = lessons[i - 1]
  const next = lessons[i + 1]
  const q = (x: string) => `${ctx.base}/lessons/${x}${usePreview ? '?preview=1' : ''}`
  return (
    <div className="page stack lesson" style={{ maxWidth: 860 }}>
      <p className="small" style={{ margin: 0 }}>
        <Crumbs ctx={ctx} /> / <Link to={ctx.base}>{content.course.title}</Link>
      </p>
      {usePreview && <div className="notice info">Preview of the working copy.</div>}
      {ctx.staff && !e && !usePreview && <div className="notice info">Instructor view of the published version (with answers and notes).</div>}
      <h1 style={{ margin: 0 }}>{lesson.title}</h1>
      {lesson.intro && <LinkedText text={lesson.intro} className="prewrap" />}
      {lesson.objectives.length > 0 && (
        <ul>
          {lesson.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      )}
      {lesson.primaryRef && <PrimaryScripture osis={lesson.primaryRef} />}
      {lesson.supportingRefs.length > 0 && (
        <p className="small">
          Also read:{' '}
          {lesson.supportingRefs.map((r) => {
            const p = parseOsis(r)
            return p ? (
              <Link key={r} to={`/bible/${p.book}/${p.chapter}${p.verse ? '/' + p.verse : ''}`} style={{ marginRight: 8 }}>
                {refText(r)}
              </Link>
            ) : null
          })}
        </p>
      )}
      {lesson.blocks.map((b) => (
        <LessonBlockView key={b.id} block={b} />
      ))}
      {lesson.context && (
        <section>
          <h2>Context</h2>
          <LinkedText text={lesson.context} className="prewrap" />
        </section>
      )}
      {lesson.discussion.length > 0 && (
        <section>
          <h2>Discussion</h2>
          <ul>
            {lesson.discussion.map((d) => (
              <li key={d}>
                <LinkedText text={d} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(lesson.reflection.length > 0 || lesson.assignments.length > 0) && (
        <section className="stack">
          <h2 style={{ marginBottom: 0 }}>Your responses</h2>
          {e ? (
            <p className="muted small" style={{ margin: 0 }}>
              Saved to the course as you type. Your instructors can read these, and may leave feedback.
            </p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>Students write their answers here.</p>
          )}
          {lesson.reflection.map((p) => (
            <WrittenField key={'r' + p} e={e} lesson={lesson} kind="reflection" prompt={p} existing={mineWritten.find((w) => w.lesson_id === lesson.id && w.kind === 'reflection' && w.prompt === p)} />
          ))}
          {lesson.assignments.map((p) => (
            <WrittenField key={'a' + p} e={e} lesson={lesson} kind="assignment" prompt={p} existing={mineWritten.find((w) => w.lesson_id === lesson.id && w.kind === 'assignment' && w.prompt === p)} />
          ))}
        </section>
      )}
      {lesson.summary && (
        <section>
          <h2>Summary</h2>
          <LinkedText text={lesson.summary} className="prewrap" />
        </section>
      )}
      {ctx.staff && lesson.instructorNotes && (
        <div className="notice info">
          <strong>Instructor notes:</strong> {lesson.instructorNotes}
        </div>
      )}
      {lesson.quiz && lesson.quiz.questions.length > 0 && (
        <OrgQuiz courseId={ctx.course.id} lesson={lesson} quiz={lesson.quiz} e={e} past={mineAttempts.filter((a) => a.lesson_id === lesson.id)} onDone={data.reload} />
      )}
      <Alert>{act.error}</Alert>
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        {prev && (
          <Link className="btn" to={q(prev.id)}>
            Previous
          </Link>
        )}
        {e && (
          <button
            className={`btn ${isDone ? '' : 'primary'}`}
            disabled={act.busy}
            data-testid="org-mark-done"
            onClick={() =>
              void act
                .run(async () => {
                  const complete = await markLesson(e.id, lesson.id, !isDone)
                  if (complete && !isDone) toast('Course complete. Well done.')
                })
                .then((ok) => {
                  if (!ok) return
                  if (!isDone && next) nav(q(next.id))
                  else if (!isDone) nav(ctx.base) // the last lesson: back to the course and its progress
                  else data.reload()
                })
            }
          >
            {isDone ? 'Mark as not done' : next ? 'Mark done and continue' : 'Mark done'}
          </button>
        )}
        {next && (
          <Link className="btn" to={q(next.id)}>
            Next
          </Link>
        )}
        <span className="spacer" />
        <Link to={ctx.base}>All lessons</Link>
      </div>
    </div>
  )
}

function WrittenField({ e, lesson, kind, prompt, existing }: { e: OrgEnrollment | null; lesson: Lesson; kind: 'reflection' | 'assignment'; prompt: string; existing?: WrittenAnswer }) {
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('')
  const value = text ?? existing?.body ?? ''
  const pending = useRef<string | null>(null)
  const save = (body: string) => {
    if (!e) return
    pending.current = null
    saveWritten(e.id, lesson.id, kind, prompt, body).then(
      () => setState('saved'),
      () => setState('error'),
    )
  }
  useEffect(() => {
    if (!e || text === null || text === (existing?.body ?? '')) return
    setState('saving')
    pending.current = text
    const t = setTimeout(() => save(text), 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, e?.id, existing?.body, lesson.id, kind, prompt])
  // leaving the lesson (or the page) never drops what was typed
  useEffect(() => {
    const out = () => pending.current !== null && save(pending.current)
    window.addEventListener('pagehide', out)
    return () => {
      window.removeEventListener('pagehide', out)
      out()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e?.id, lesson.id, kind, prompt])
  return (
    <div className="stack" style={{ gap: 4 }}>
      <label className="stack" style={{ gap: 4 }}>
        <span>
          {kind === 'assignment' ? <strong>Assignment: </strong> : null}
          <LinkedText text={prompt} />
        </span>
        <textarea rows={kind === 'assignment' ? 5 : 3} value={value} onChange={(ev) => setText(ev.target.value)} disabled={!e} />
      </label>
      <span className="muted small" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved: check your connection. Your text is still here.' : ''}
      </span>
      {existing?.graded_at && (
        <div className="notice info small" data-testid="written-feedback">
          <strong>{existing.grade ? GRADE_LABEL[existing.grade] : 'Reviewed'}</strong>
          {existing.points != null ? ` · ${existing.points} points` : ''}
          {existing.feedback ? ` · ${existing.feedback}` : ''}
        </div>
      )}
    </div>
  )
}

function OrgQuiz({ courseId, lesson, quiz, e, past, onDone }: { courseId: string; lesson: Lesson; quiz: Quiz; e: OrgEnrollment | null; past: OrgAttempt[]; onDone: () => void }) {
  const [running, setRunning] = useState<{ id: string; startedAt: number } | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [result, setResult] = useState<QuizSubmitResult | null>(null)
  const act = useAction()
  const used = past.length
  const left = used > 0 && !quiz.allowRetake ? 0 : quiz.attempts > 0 ? Math.max(0, quiz.attempts - used) : Infinity
  const best = past.reduce((m, a) => Math.max(m, a.score), 0)
  const lastFeedback = past.find((a) => a.feedback)
  const submit = () =>
    void act.run(async () => {
      const r = await submitQuiz(courseId, lesson.id, answers)
      setResult(r)
      setRunning(null)
      onDone()
    })
  return (
    <section className="card stack" aria-labelledby="oq-h" data-testid="org-quiz">
      <h2 id="oq-h" style={{ margin: 0 }}>
        {quiz.title}
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}. Passing score {quiz.passScore}%.{quiz.required ? ' Required to complete the course.' : ' Optional.'}
        {quiz.attempts > 0 && ` ${Number.isFinite(left) ? left : 'Unlimited'} of ${quiz.attempts} attempts left.`}
        {used > 0 && ` Best score: ${best}%.`} Graded by the workspace when you submit.
      </p>
      {lastFeedback && (
        <div className="notice info small">
          <strong>Instructor feedback:</strong> {lastFeedback.feedback}
        </div>
      )}
      <Alert>{act.error}</Alert>
      {!e ? (
        <p className="muted small" style={{ margin: 0 }}>Students take the quiz here.</p>
      ) : running ? (
        <QuizForm quiz={quiz} attempt={running} answers={answers} setAnswers={setAnswers} onSubmit={submit} />
      ) : (
        <>
          {result && <QuizResultView quiz={result.quiz ?? quiz} attempt={{ answers, score: result.score, passed: result.passed }} graded={result} reveal={result.reveal} />}
          {left > 0 ? (
            <div>
              <button
                className="btn primary"
                onClick={() => {
                  setAnswers({})
                  setResult(null)
                  setRunning({ id: crypto.randomUUID(), startedAt: Date.now() })
                }}
              >
                {used ? 'Take the quiz again' : 'Start the quiz'}
              </button>
            </div>
          ) : (
            used > 0 && <p className="muted small" style={{ margin: 0 }}>No more attempts are allowed for this quiz.</p>
          )}
        </>
      )}
    </section>
  )
}

/* =============================== the instructor's Manage page =============================== */

export function OrgCourseManage() {
  const { orgId = '' } = useParams()
  const c = useCourseCtx()
  const [tab, setTab] = useState<'students' | 'grading' | 'attendance' | 'options'>('students')
  if (c.loading) return <Loading label="Loading the course" />
  if (c.error) return <div className="page"><ErrorBox error={c.error} onRetry={c.reload} /></div>
  if (!c.ctx || !c.ctx.staff) return <NotAvailable orgId={orgId} />
  const ctx = c.ctx
  return (
    <div className="page stack" style={{ maxWidth: 1040 }}>
      <p className="small" style={{ margin: 0 }}>
        <Crumbs ctx={ctx} here={ctx.course.title} />
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Manage: {ctx.course.title}</h1>
        <span className={`badge ${ctx.course.status === 'published' ? 'source' : ''}`}>
          {STATUS_LABEL[ctx.course.status]}
          {ctx.course.published_version ? `, version ${ctx.course.published_version}` : ''}
        </span>
        <span className="spacer" />
        <Link className="btn small" to={`${ctx.base}/edit`}>
          <Pencil size={14} aria-hidden /> Edit
        </Link>
        <Link className="btn small" to={ctx.base}>
          <BookOpen size={14} aria-hidden /> Course page
        </Link>
      </div>
      <Tabs
        tabs={[
          { id: 'students', label: 'Students' },
          { id: 'grading', label: 'Grading' },
          { id: 'attendance', label: 'Attendance' },
          { id: 'options', label: 'Options and instructors' },
        ]}
        value={tab}
        onChange={setTab}
        label="Manage course"
      />
      <div role="tabpanel">
        {tab === 'students' && <StudentsPanel ctx={ctx} />}
        {tab === 'grading' && <GradingPanel ctx={ctx} />}
        {tab === 'attendance' && <AttendancePanel ctx={ctx} />}
        {tab === 'options' && <OptionsPanel ctx={ctx} onChanged={c.reload} />}
      </div>
    </div>
  )
}

/** Names for the people this caller may see (the database limits it to their students and leaders). */
function useNames(orgId: string, ids: (string | null)[]) {
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  return useAsync(async () => {
    if (!key) return new Map<string, string>()
    const r = await cloud().from('org_members').select('user_id, display_name').eq('org_id', orgId).in('user_id', key.split(','))
    return new Map(((r.data ?? []) as { user_id: string; display_name: string }[]).map((m) => [m.user_id, m.display_name]))
  }, [orgId, key])
}

function StudentsPanel({ ctx }: { ctx: CourseCtx }) {
  const data = useAsync(async () => {
    const [enr, v] = await Promise.all([courseEnrollments(ctx.course.id), ctx.course.published_version ? fullVersion(ctx.course.id, ctx.course.published_version) : null])
    const prog = await progress(enr.map((e) => e.id))
    const att = await attempts({ course: ctx.course.id })
    return { enr, prog, att, total: v ? lessonOrder(v).length : 0 }
  }, [ctx.course.id])
  const names = useNames(ctx.orgId, data.data?.enr.map((e) => e.user_id) ?? [])
  const [enrolling, setEnrolling] = useState(false)
  const act = useAction()
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { enr, prog, att, total } = data.data!
  const name = (u: string | null) => (u ? (names.data?.get(u) ?? 'Former member') : 'Former member')
  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Student', 'Status', 'Version', 'Lessons done', 'Best quiz score', 'Enrolled', 'Completed']]
    for (const e of enr) {
      const best = att.filter((a) => a.enrollment_id === e.id).reduce((m, a) => Math.max(m, a.score), -1)
      rows.push([name(e.user_id), e.status, e.version, prog.filter((p) => p.enrollment_id === e.id).length, best < 0 ? '' : best, e.enrolled_at.slice(0, 10), e.completed_at?.slice(0, 10) ?? ''])
    }
    downloadBlob(new Blob([csv(rows)], { type: 'text/csv' }), `${slug(ctx.course.title)}-students.csv`)
  }
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => setEnrolling(true)} disabled={ctx.course.status !== 'published'} data-testid="enroll-members">
          <Users size={16} aria-hidden /> Enroll members
        </button>
        {ctx.course.status !== 'published' && <span className="muted small">Publish the course before enrolling students.</span>}
        <span className="spacer" />
        <button className="btn" onClick={exportCsv} disabled={!enr.length}>
          <Download size={16} aria-hidden /> Download as spreadsheet (CSV)
        </button>
      </div>
      <Alert>{act.error}</Alert>
      {!enr.length ? (
        <Empty>No students yet.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" data-testid="students-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                <th scope="col">Progress</th>
                <th scope="col">Best quiz</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {enr.map((e) => {
                const n = prog.filter((p) => p.enrollment_id === e.id).length
                const best = att.filter((a) => a.enrollment_id === e.id).reduce((m, a) => Math.max(m, a.score), -1)
                return (
                  <tr key={e.id}>
                    <td>{name(e.user_id)}</td>
                    <td>
                      {n} of {total} lessons{e.version < ctx.course.published_version ? <span className="muted small"> (version {e.version})</span> : ''}
                    </td>
                    <td>{best < 0 ? '' : `${best}%`}</td>
                    <td>
                      {e.status === 'completed' ? 'Completed' : e.status === 'withdrawn' ? 'Withdrawn' : 'Active'}
                      {e.deadline && e.status === 'active' ? <span className="muted small"> · by {e.deadline}</span> : ''}
                    </td>
                    <td>
                      {e.status === 'active' && (
                        <button className="btn small" onClick={() => confirm(`Withdraw ${name(e.user_id)} from this course? Their work is kept.`) && void act.run(() => withdraw(e.id), 'Withdrawn.').then(() => data.reload())}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <EnrollDialog ctx={ctx} open={enrolling} onClose={() => setEnrolling(false)} already={new Set(enr.filter((e) => e.status !== 'withdrawn').map((e) => e.user_id ?? ''))} onDone={data.reload} />
    </div>
  )
}

function EnrollDialog({ ctx, open, onClose, already, onDone }: { ctx: CourseCtx; open: boolean; onClose: () => void; already: Set<string>; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const list = useAsync(async () => (open ? (await members(ctx.orgId, { search })).rows : []), [open, search, ctx.orgId])
  const [pick, setPick] = useState<string[]>([])
  const [deadline, setDeadline] = useState('')
  const act = useAction()
  const people = (list.data ?? []).filter((m: Member) => !already.has(m.user_id))
  return (
    <Dialog open={open} onClose={onClose} title="Enroll members">
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          {rank(ctx.me.role) >= 5 ? 'Choose members of the workspace.' : 'You can enroll members you can see here (leaders and people in your groups). To add someone else, invite them to this course from the Invitations section.'}
        </p>
        <label className="sr-only" htmlFor="enroll-search">
          Search members
        </label>
        <input id="enroll-search" type="search" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        {list.loading && !list.data ? (
          <Loading />
        ) : !people.length ? (
          <Empty>No one else to enroll.</Empty>
        ) : (
          <fieldset className="stack" style={{ gap: 4, maxHeight: 280, overflow: 'auto' }}>
            <legend className="sr-only">Members</legend>
            {people.map((m) => (
              <label key={m.user_id} className="row">
                <input type="checkbox" checked={pick.includes(m.user_id)} onChange={() => setPick(pick.includes(m.user_id) ? pick.filter((x) => x !== m.user_id) : [...pick, m.user_id])} /> {m.display_name}{' '}
                <span className="muted small">{ROLE_LABEL[m.role]}</span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <strong>Finish by (optional)</strong>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button
            className="btn primary"
            disabled={!pick.length || act.busy}
            onClick={() =>
              void act.run(() => enrollMembers(ctx.course.id, pick, deadline || undefined), `${pick.length} enrolled.`).then((ok) => {
                if (ok) {
                  setPick([])
                  onClose()
                  onDone()
                }
              })
            }
          >
            Enroll {pick.length || ''}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function GradingPanel({ ctx }: { ctx: CourseCtx }) {
  const data = useAsync(async () => {
    const [w, a, enr] = await Promise.all([writtenAnswers({ course: ctx.course.id }), attempts({ course: ctx.course.id }), courseEnrollments(ctx.course.id)])
    const versions = new Map<number, CourseContent | null>()
    for (const v of new Set(a.map((x) => x.version))) versions.set(v, await fullVersion(ctx.course.id, v))
    return { w, a, enr, versions }
  }, [ctx.course.id])
  const names = useNames(ctx.orgId, data.data?.enr.map((e) => e.user_id) ?? [])
  const [show, setShow] = useState<'waiting' | 'all'>('waiting')
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { w, a, enr, versions } = data.data!
  const who = (eid: string) => {
    const u = enr.find((e) => e.id === eid)?.user_id
    return u ? (names.data?.get(u) ?? 'Former member') : 'Former member'
  }
  const written = w.filter((x) => show === 'all' || !x.graded_at || x.updated_at > x.graded_at)
  const quizzes = a.filter((x) => x.results.some((r) => !r.auto && r.answered) && (show === 'all' || !x.reviewed_at))
  return (
    <div className="stack">
      <div className="row">
        <label className="row small">
          <input type="radio" name="show" checked={show === 'waiting'} onChange={() => setShow('waiting')} /> Waiting for review
        </label>
        <label className="row small">
          <input type="radio" name="show" checked={show === 'all'} onChange={() => setShow('all')} /> Everything
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Automatic quiz scores, your grades, and students' reflections are kept separately. Course completion is worked out from saved lessons, required quizzes, and attendance.
      </p>
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Written answers</h2>
      {!written.length ? <Empty>Nothing waiting.</Empty> : written.map((x) => <GradeWritten key={x.id} x={x} who={who(x.enrollment_id)} onDone={data.reload} />)}
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Quiz answers that need a person</h2>
      {!quizzes.length ? (
        <Empty>Nothing waiting.</Empty>
      ) : (
        quizzes.map((x) => <ReviewAttempt key={x.id} x={x} who={who(x.enrollment_id)} quiz={versions.get(x.version)?.lessons.find((l) => l.id === x.lesson_id)?.quiz} onDone={data.reload} />)
      )}
    </div>
  )
}

function GradeWritten({ x, who, onDone }: { x: WrittenAnswer; who: string; onDone: () => void }) {
  const [grade, setGrade] = useState<WrittenAnswer['grade']>(x.grade ?? 'complete')
  const [points, setPoints] = useState(x.points?.toString() ?? '')
  const [feedback, setFeedback] = useState(x.feedback)
  const act = useAction()
  return (
    <form
      className="card stack"
      data-testid="grade-written"
      onSubmit={(e) => {
        e.preventDefault()
        void act.run(() => gradeWritten(x.id, grade, points === '' ? null : Number(points), feedback), 'Saved.').then((ok) => ok && onDone())
      }}
    >
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong>{who}</strong>
        <span className="muted small">
          {x.kind === 'assignment' ? 'Assignment' : 'Reflection'} · {new Date(x.updated_at).toLocaleString()}
          {x.graded_at && x.updated_at > x.graded_at ? ' · changed since you graded it' : ''}
        </span>
      </div>
      <em className="small">{x.prompt}</em>
      <div className="prewrap" style={{ background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>
        {x.body || <span className="muted">(empty)</span>}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="row small">
          Grade
          <select value={grade ?? ''} onChange={(e) => setGrade(e.target.value as WrittenAnswer['grade'])}>
            {Object.entries(GRADE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="row small">
          Points (optional)
          <input type="number" min={0} max={1000} style={{ width: 90 }} value={points} onChange={(e) => setPoints(e.target.value)} />
        </label>
      </div>
      <label className="stack small" style={{ gap: 4 }}>
        Feedback to the student
        <textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </label>
      <Alert>{act.error}</Alert>
      <div>
        <button className="btn primary small" type="submit" disabled={act.busy}>
          Save grade
        </button>
      </div>
    </form>
  )
}

function ReviewAttempt({ x, who, quiz, onDone }: { x: OrgAttempt; who: string; quiz?: Quiz; onDone: () => void }) {
  const [manual, setManual] = useState<Record<string, number>>(x.manual ?? {})
  const [feedback, setFeedback] = useState(x.feedback)
  const act = useAction()
  const written = (quiz?.questions ?? []).filter((q) => x.results.some((r) => r.id === q.id && !r.auto))
  return (
    <div className="card stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong>{who}</strong>
        <span className="muted small">
          {quiz?.title ?? 'Quiz'} · automatic score {x.score}% · {new Date(x.submitted_at).toLocaleString()}
        </span>
      </div>
      {written.map((q) => (
        <div key={q.id} className="stack small" style={{ gap: 4 }}>
          <em>{q.prompt}</em>
          <div className="prewrap" style={{ background: 'var(--surface-2)', padding: 8, borderRadius: 6 }}>
            {String(x.answers[q.id] ?? '') || <span className="muted">(no answer)</span>}
          </div>
          <label className="row">
            Credit
            <select value={manual[q.id] ?? ''} onChange={(e) => setManual({ ...manual, [q.id]: Number(e.target.value) })}>
              <option value="">Not marked</option>
              <option value="1">Full</option>
              <option value="0.5">Partial</option>
              <option value="0">None</option>
            </select>
          </label>
        </div>
      ))}
      <label className="stack small" style={{ gap: 4 }}>
        Feedback to the student
        <textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </label>
      <Alert>{act.error}</Alert>
      <div>
        <button className="btn primary small" disabled={act.busy} onClick={() => void act.run(() => reviewAttempt(x.id, manual, feedback), 'Review saved.').then((ok) => ok && onDone())}>
          Save review
        </button>
      </div>
    </div>
  )
}

function AttendancePanel({ ctx }: { ctx: CourseCtx }) {
  const data = useAsync(async () => {
    const [ss, enr] = await Promise.all([sessions(ctx.course.id), courseEnrollments(ctx.course.id)])
    const att = await attendance(ss.map((s) => s.id))
    return { ss, enr: enr.filter((e) => e.status !== 'withdrawn'), att }
  }, [ctx.course.id])
  const names = useNames(ctx.orgId, data.data?.enr.map((e) => e.user_id) ?? [])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [title, setTitle] = useState('')
  const act = useAction()
  const [local, setLocal] = useState<Record<string, AttendanceStatus | ''>>({})
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { ss, enr, att } = data.data!
  const name = (u: string | null) => (u ? (names.data?.get(u) ?? 'Former member') : 'Former member')
  const cell = (sid: string, eid: string) => local[`${sid}/${eid}`] ?? att.find((a) => a.session_id === sid && a.enrollment_id === eid)?.status ?? ''
  const exportCsv = () => {
    const rows: string[][] = [['Student', ...ss.map((s) => `${s.held_on}${s.title ? ' ' + s.title : ''}`), 'Present or late']]
    for (const e of enr) rows.push([name(e.user_id), ...ss.map((s) => (cell(s.id, e.id) ? ATTENDANCE_LABEL[cell(s.id, e.id) as AttendanceStatus] : '')), String(ss.filter((s) => ['present', 'late'].includes(cell(s.id, e.id))).length)])
    downloadBlob(new Blob([csv(rows)], { type: 'text/csv' }), `${slug(ctx.course.title)}-attendance.csv`)
  }
  return (
    <div className="stack">
      <form
        className="row"
        style={{ flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          void act.run(() => addSession(ctx.course.id, date, title), 'Session added.').then((ok) => ok && (setTitle(''), data.reload()))
        }}
      >
        <label className="row small">
          Class session on
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="sr-only" htmlFor="sess-title">
          Session title
        </label>
        <input id="sess-title" placeholder="Title (optional), e.g. Week 1" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn" type="submit" disabled={act.busy}>
          <Plus size={16} aria-hidden /> Add session
        </button>
        <span className="spacer" />
        <button className="btn" type="button" onClick={exportCsv} disabled={!ss.length}>
          <Download size={16} aria-hidden /> Download as spreadsheet (CSV)
        </button>
      </form>
      <p className="muted small" style={{ margin: 0 }}>
        Attendance is what you record for each real class session. The app never infers it from activity.
      </p>
      <Alert>{act.error}</Alert>
      {!ss.length || !enr.length ? (
        <Empty>{!ss.length ? 'Add a class session to take attendance.' : 'No students enrolled yet.'}</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" data-testid="attendance-table">
            <thead>
              <tr>
                <th scope="col">Student</th>
                {ss.map((s) => (
                  <th key={s.id} scope="col">
                    {s.held_on}
                    {s.title ? <div className="small">{s.title}</div> : null}
                    <button className="btn small" type="button" onClick={() => confirm('Delete this session and its attendance?') && void act.run(() => deleteSession(s.id), 'Session deleted.').then(() => data.reload())} aria-label={`Delete session ${s.held_on}`}>
                      Delete
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enr.map((e) => (
                <tr key={e.id}>
                  <td>{name(e.user_id)}</td>
                  {ss.map((s) => (
                    <td key={s.id}>
                      <select
                        aria-label={`${name(e.user_id)}, ${s.held_on}`}
                        value={cell(s.id, e.id)}
                        onChange={(ev) => {
                          const v = ev.target.value as AttendanceStatus | ''
                          setLocal({ ...local, [`${s.id}/${e.id}`]: v })
                          void act.run(() => recordAttendance(s.id, e.id, v || null))
                        }}
                      >
                        <option value="">Not recorded</option>
                        {Object.entries(ATTENDANCE_LABEL).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function OptionsPanel({ ctx, onChanged }: { ctx: CourseCtx; onChanged: () => void }) {
  const { course } = ctx
  const [catalog, setCatalog] = useState(course.catalog)
  const [deadline, setDeadline] = useState(course.enroll_deadline ?? '')
  const ins = useAsync(() => courseInstructors(course.id), [course.id])
  const staff = useAsync(async () => (rank(ctx.me.role) >= 4 ? (await members(ctx.orgId)).rows.filter((m) => rank(m.role) >= 3) : []), [ctx.orgId])
  const names = useNames(ctx.orgId, ins.data ?? [])
  const [addId, setAddId] = useState('')
  const act = useAction()
  const canAssign = rank(ctx.me.role) >= 4
  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault()
          void act.run(() => setCourseOptions(course.id, { catalog, enroll_deadline: deadline }), 'Saved.').then(onChanged)
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Enrollment</h2>
        <label className="row">
          <input type="checkbox" checked={catalog} onChange={(e) => setCatalog(e.target.checked)} /> List in the workspace course catalog (members can enroll themselves)
        </label>
        <label className="row small">
          Enrollment closes after
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Save
          </button>
        </div>
      </form>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Instructors</h2>
        <ul className="list">
          {(ins.data ?? []).map((u) => (
            <li key={u} className="row">
              {names.data?.get(u) ?? 'Instructor'}
              <span className="spacer" />
              {canAssign && (
                <button className="btn small" onClick={() => void act.run(() => assignInstructor(course.id, u, false), 'Instructor removed from this course.').then(() => ins.reload())}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {canAssign && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="sr-only" htmlFor="add-instr">
              Add an instructor
            </label>
            <select id="add-instr" value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Add an instructor</option>
              {(staff.data ?? [])
                .filter((m) => !(ins.data ?? []).includes(m.user_id))
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name} ({ROLE_LABEL[m.role]})
                  </option>
                ))}
            </select>
            <button className="btn" disabled={!addId || act.busy} onClick={() => void act.run(() => assignInstructor(course.id, addId, true), 'Instructor assigned.').then(() => (setAddId(''), ins.reload()))}>
              Assign
            </button>
          </div>
        )}
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Archive</h2>
        <p style={{ margin: 0 }}>Archiving closes enrollment. Enrolled students keep access to the version they are taking, and every record is kept.</p>
        <div>
          {course.status !== 'archived' ? (
            <button className="btn" onClick={() => void act.run(() => setCourseOptions(course.id, { status: 'archived' }), 'Course archived.').then(onChanged)}>
              Archive course
            </button>
          ) : (
            <button className="btn" disabled={!course.published_version} onClick={() => void act.run(() => setCourseOptions(course.id, { status: 'published' }), 'Course restored.').then(onChanged)}>
              Restore from archive
            </button>
          )}
        </div>
      </section>
      <Alert>{act.error}</Alert>
    </div>
  )
}

