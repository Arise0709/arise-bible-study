import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Award, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Circle, Download, ExternalLink, FileText, Lock, Plus, Printer, Upload } from 'lucide-react'
import { db, uid, type Attempt, type Course, type Enrollment, type Lesson, type LessonBlock, type Question, type Quiz } from '../db/db'
import { Dialog, Empty, Loading, downloadBlob, slug, toast, useAsync } from '../components/ui'
import { BlockView } from '../components/Blocks'
import { LinkedText, ScriptureRef } from '../components/Scripture'
import { getPassage, loadBookIndex, passageToText } from '../lib/data'
import { formatRef, parseOsis } from '../lib/refs'
import {
  TRACKS,
  attemptsLeft,
  certificateEligible,
  checkScriptureQuotes,
  courseLessons,
  courseProgress,
  createCourse,
  deleteCourse,
  enroll,
  gradeQuiz,
  importCourse,
  isAutoGraded,
  isReleased,
  parseCourseFile,
  setLessonDone,
  shuffled,
  type CourseImport,
} from '../lib/courses'
import { ProgressBar } from './PlanPages'
import { SaveOffline } from '../components/OfflinePacks'

const refText = (osis: string) => {
  const r = parseOsis(osis)
  return r ? formatRef(r) : osis
}
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }

/* ---------------- dashboard section ---------------- */

export function CoursesSection() {
  const nav = useNavigate()
  const courses = useLiveQuery(() => db.courses.orderBy('updatedAt').reverse().toArray(), [])
  const enrollments = useLiveQuery(() => db.enrollments.toArray(), [])
  const [importing, setImporting] = useState(false)
  if (!courses || !enrollments) return <Loading label="Loading courses" />
  const byCourse = new Map(enrollments.map((e) => [e.courseId, e]))
  const count = (c: Course) => c.units.reduce((n, u) => n + u.lessonIds.length, 0)
  const pct = (c: Course, e: Enrollment) => (count(c) ? Math.round((Object.keys(e.lessonsDone).filter((id) => c.units.some((u) => u.lessonIds.includes(id))).length / count(c)) * 100) : 0)
  const takeable = courses.filter((c) => c.status === 'published')
  const mine = takeable.filter((c) => byCourse.has(c.id))
  const current = mine.filter((c) => !byCourse.get(c.id)!.completedAt).sort((a, b) => byCourse.get(b.id)!.updatedAt - byCourse.get(a.id)!.updatedAt)
  const completed = mine.filter((c) => byCourse.get(c.id)!.completedAt)
  const catalog = takeable.filter((c) => !byCourse.has(c.id) && c.role === 'student')
  const teaching = courses.filter((c) => c.role === 'instructor')
  const cont = current[0]
  const contLesson = cont && (byCourse.get(cont.id)!.lastLessonId ?? cont.units.flatMap((u) => u.lessonIds).find((id) => !byCourse.get(cont.id)!.lessonsDone[id]))

  return (
    <section className="stack" aria-labelledby="courses-h">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 id="courses-h" style={{ margin: 0 }}>Courses</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setImporting(true)}>
          <Upload size={16} aria-hidden /> Add a course from a file
        </button>
        <button
          className="btn"
          onClick={async () => {
            const c = await createCourse()
            nav(`/learn/courses/${c.id}/edit`)
          }}
        >
          <Plus size={16} aria-hidden /> Create a course
        </button>
      </div>
      {cont && (
        <div className="card stack" data-testid="continue-learning">
          <h3 style={{ margin: 0 }}>Continue learning</h3>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Link to={contLesson ? `/learn/courses/${cont.id}/lessons/${contLesson}` : `/learn/courses/${cont.id}`} style={{ fontWeight: 600 }}>
              {cont.title}
            </Link>
            <span className="spacer" />
            <span className="muted small">{pct(cont, byCourse.get(cont.id)!)}% complete</span>
          </div>
          <ProgressBar percent={pct(cont, byCourse.get(cont.id)!)} label={`${cont.title}: ${pct(cont, byCourse.get(cont.id)!)}% complete`} />
        </div>
      )}
      {!courses.length && (
        <Empty>
          No courses on this device yet. Courses are written by your church or instructor. Add one from a course file they share with you, or create your own.
        </Empty>
      )}
      {current.length > 1 && (
        <>
          <h3 style={{ margin: '8px 0 0' }}>My courses</h3>
          <ul className="list">
            {current.slice(1).map((c) => (
              <li key={c.id} className="row">
                <Link to={`/learn/courses/${c.id}`}>{c.title}</Link>
                <span className="spacer" />
                <span className="muted small">{pct(c, byCourse.get(c.id)!)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {catalog.length > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0' }}>Available courses</h3>
          {TRACKS.map((t) => {
            const list = catalog.filter((c) => (TRACKS as readonly string[]).includes(c.category) ? c.category === t : t === 'Other')
            if (!list.length) return null
            return (
              <div key={t}>
                <h4 style={{ margin: '4px 0' }}>{t}</h4>
                <ul className="list">
                  {list.map((c) => (
                    <li key={c.id}>
                      <Link to={`/learn/courses/${c.id}`} style={{ fontWeight: 600 }}>{c.title}</Link>
                      <div className="muted small">
                        {LEVEL[c.level]}
                        {c.duration && `, ${c.duration}`}
                        {c.organization && `, ${c.organization}`}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
      {completed.length > 0 && (
        <details>
          <summary>Completed courses ({completed.length})</summary>
          <ul className="list">
            {completed.map((c) => (
              <li key={c.id} className="row">
                <Link to={`/learn/courses/${c.id}`}>{c.title}</Link>
                <span className="muted small">completed {new Date(byCourse.get(c.id)!.completedAt!).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {teaching.length > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0' }}>Courses I teach</h3>
          <ul className="list">
            {teaching.map((c) => (
              <li key={c.id} className="row" style={{ flexWrap: 'wrap' }}>
                <Link to={`/learn/courses/${c.id}/edit`} style={{ fontWeight: 600 }}>{c.title}</Link>
                <span className={`badge ${c.status === 'published' ? 'source' : ''}`}>{c.status === 'draft' ? 'Draft' : c.status === 'published' ? `Published, version ${c.version}` : 'Archived'}</span>
                <span className="spacer" />
                <span className="muted small">{count(c)} lessons</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <ImportCourseDialog open={importing} onClose={() => setImporting(false)} />
    </section>
  )
}

/** What to do next, in one line. */
export function NextStep() {
  const enrollments = useLiveQuery(() => db.enrollments.toArray(), [])
  const courses = useLiveQuery(() => db.courses.toArray(), [])
  const plans = useLiveQuery(() => db.plans.where('status').equals('active').count(), [])
  if (!enrollments || !courses || plans === undefined) return null
  const open = enrollments.filter((e) => !e.completedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const c = open && courses.find((x) => x.id === open.courseId)
  let text: React.ReactNode = null
  if (c) {
    const next = c.units.flatMap((u) => u.lessonIds).find((id) => !open.lessonsDone[id])
    text = next ? (
      <>
        Next lesson in <Link to={`/learn/courses/${c.id}/lessons/${next}`}>{c.title}</Link>.
      </>
    ) : (
      <>
        Finish the requirements for <Link to={`/learn/courses/${c.id}`}>{c.title}</Link>.
      </>
    )
  } else if (!plans) {
    text = (
      <>
        Start with a <Link to="/learn/plans/new">reading plan</Link>. Foundations of the Christian Faith is a good first step.
      </>
    )
  }
  if (!text) return null
  return (
    <div className="notice info small" data-testid="next-step">
      <strong>Recommended next step:</strong> {text}
    </div>
  )
}

/* ---------------- import ---------------- */

function ImportCourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const [imp, setImp] = useState<CourseImport | null>(null)
  const [checks, setChecks] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  const reset = () => {
    setImp(null)
    setChecks(null)
    setErr('')
  }
  const read = async (f: File) => {
    reset()
    try {
      await loadBookIndex()
      const p = parseCourseFile(await f.text())
      setImp(p)
      setChecks(await checkScriptureQuotes(p.file.lessons, async (osis, tr) => {
        const r = parseOsis(osis)
        return r ? passageToText(await getPassage(r, tr)) : undefined
      }))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const save = async (role: 'student' | 'instructor') => {
    if (!imp) return
    try {
      const c = await importCourse(imp, role)
      toast(role === 'student' ? 'Course added' : 'A copy is ready to edit')
      onClose()
      reset()
      nav(role === 'student' ? `/learn/courses/${c.id}` : `/learn/courses/${c.id}/edit`)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Dialog open={open} onClose={() => (reset(), onClose())} title="Add a course from a file">
      <div className="stack">
        <p style={{ margin: 0 }}>Choose a course file (.json) shared by your church or instructor. The file is checked before anything is added.</p>
        <input type="file" accept=".json,application/json" aria-label="Course file" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        {err && (
          <div className="notice error" role="alert">
            {err}
          </div>
        )}
        {imp && (
          <div className="card stack" data-testid="import-preview">
            <strong>{imp.file.course.title}</strong>
            <span className="small">
              {imp.file.lessons.length} lesson{imp.file.lessons.length === 1 ? '' : 's'}, version {imp.file.course.version}
              {imp.file.course.author && `, by ${imp.file.course.author}`}
              {imp.file.course.organization && `, ${imp.file.course.organization}`}
            </span>
            {checks === null && <Loading label="Checking Scripture quotations" />}
            {[...imp.warnings, ...(checks ?? [])].map((w) => (
              <div key={w} className="notice warn small">
                {w}
              </div>
            ))}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => save('student')} disabled={checks === null}>
                Take this course
              </button>
              {imp.file.audience === 'instructors' && (
                <button className="btn" onClick={() => save('instructor')} disabled={checks === null}>
                  Make an editable copy to teach
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

/* ---------------- course page ---------------- */

function useCourse(id: string) {
  const course = useLiveQuery(() => db.courses.get(id), [id])
  const lessons = useLiveQuery(async () => {
    const c = await db.courses.get(id)
    return c ? courseLessons(c) : []
  }, [id])
  const enrollment = useLiveQuery(() => db.enrollments.where('courseId').equals(id).first(), [id])
  const attempts = useLiveQuery(() => db.attempts.where('courseId').equals(id).toArray(), [id])
  return { course, lessons, enrollment, attempts, loading: course === undefined && lessons === undefined }
}

export function CoursePage() {
  const { id = '' } = useParams()
  const [sp] = useSearchParams()
  const preview = sp.get('preview') === '1'
  const nav = useNavigate()
  const { course, lessons, enrollment, attempts } = useCourse(id)
  const [name, setName] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  useEffect(() => {
    if (course) document.title = `${course.title} · Arise Bible Study`
  }, [course])
  useEffect(() => {
    if (enrollment) setName(enrollment.studentName)
  }, [enrollment])
  const progress = useMemo(() => (course && lessons && attempts ? courseProgress(course, preview ? lessons.map((l) => ({ ...l, status: 'published' })) : lessons, enrollment, attempts) : undefined), [course, lessons, enrollment, attempts, preview])
  // record the completion date once requirements are met
  useEffect(() => {
    if (enrollment && progress?.complete && !enrollment.completedAt) db.enrollments.update(enrollment.id, { completedAt: Date.now(), updatedAt: Date.now() })
  }, [enrollment, progress?.complete])
  if (course === undefined || lessons === undefined || attempts === undefined) return <Loading />
  if (!course) {
    return (
      <div className="page">
        <h1>Course not found</h1>
        <Link to="/learn">Back to Learn</Link>
      </div>
    )
  }
  const visible = lessons.filter((l) => preview || l.status === 'published')
  const byId = new Map(visible.map((l) => [l.id, l]))
  const eligible = progress && certificateEligible(course, progress, name)

  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to="/learn">Learn</Link> / Course
      </p>
      {preview && (
        <div className="notice info row">
          Preview: this is how students see the course. Draft lessons are shown here so you can check them; students only see published lessons.
          <span className="spacer" />
          <Link to={`/learn/courses/${course.id}/edit`}>Back to editing</Link>
        </div>
      )}
      <h1 style={{ margin: 0 }}>{course.title}</h1>
      <div className="muted small">
        {course.category}, {LEVEL[course.level]}
        {course.duration && `, ${course.duration}`}
        {course.author && `. By ${course.author}`}
        {course.organization && `, ${course.organization}`}
        {course.version > 0 && `. Version ${course.version}`}
      </div>
      {course.description && <LinkedText text={course.description} className="prewrap" />}
      {course.perspective && (
        <div className="notice info small">
          <strong>The author's theological perspective:</strong> {course.perspective}
        </div>
      )}
      {course.objectives.length > 0 && (
        <section>
          <h2>What you will learn</h2>
          <ul>
            {course.objectives.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </section>
      )}
      {progress && enrollment && (
        <div className="stack" style={{ gap: 4 }}>
          <ProgressBar percent={progress.percent} label={`${progress.percent}% complete`} />
          <div className="small">
            {progress.lessonsDone} of {progress.lessonsTotal} lessons
            {progress.quizzesRequired > 0 && `, ${progress.quizzesPassed} of ${progress.quizzesRequired} required quizzes passed`}
            {progress.complete && enrollment.completedAt && `. Completed ${new Date(enrollment.completedAt).toLocaleDateString()}.`}
          </div>
        </div>
      )}
      {!enrollment && (
        <form
          className="card stack"
          onSubmit={async (e) => {
            e.preventDefault()
            await enroll(course, name)
            toast('You are enrolled')
            const first = course.units.flatMap((u) => u.lessonIds).find((x) => byId.has(x))
            if (first) nav(`/learn/courses/${course.id}/lessons/${first}${preview ? '?preview=1' : ''}`)
          }}
        >
          <label className="stack" style={{ gap: 4 }}>
            <strong>Your name (optional)</strong>
            <span className="muted small">Used only on your certificate. It stays on this device.</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <div>
            <button className="btn primary" type="submit" disabled={!visible.length}>
              Enroll and start
            </button>
          </div>
        </form>
      )}
      <section aria-labelledby="units-h">
        <h2 id="units-h">Lessons</h2>
        {course.units.map((u) => {
          const ls = u.lessonIds.map((x) => byId.get(x)).filter((l): l is Lesson => !!l)
          if (!ls.length) return null
          return (
            <div key={u.id}>
              <h3 style={{ margin: '8px 0 4px' }}>{u.title}</h3>
              <ol className="list" style={{ paddingLeft: 0 }}>
                {ls.map((l) => {
                  const done = !!enrollment?.lessonsDone[l.id]
                  const open = preview || isReleased(l)
                  return (
                    <li key={l.id} className="row">
                      {done ? <CheckCircle2 size={16} aria-label="Completed" /> : open ? <Circle size={16} aria-hidden /> : <Lock size={16} aria-label="Not yet open" />}
                      {open ? <Link to={`/learn/courses/${course.id}/lessons/${l.id}${preview ? '?preview=1' : ''}`}>{l.title}</Link> : <span>{l.title}</span>}
                      {!open && <span className="muted small">opens {l.releaseOn}</span>}
                      {l.status !== 'published' && <span className="badge">Draft</span>}
                    </li>
                  )
                })}
              </ol>
            </div>
          )
        })}
        {!visible.length && <Empty>No lessons are published in this course yet.</Empty>}
      </section>
      {course.certificate.enabled && enrollment && progress && (
        <section className="card stack" aria-labelledby="cert-h">
          <h2 id="cert-h" style={{ margin: 0 }}>
            <Award size={18} aria-hidden /> Certificate
          </h2>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Name on the certificate</strong>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => db.enrollments.update(enrollment.id, { studentName: name.trim(), updatedAt: Date.now() })} />
          </label>
          {eligible?.ok ? (
            <div>
              <button
                className="btn primary"
                data-testid="certificate"
                onClick={async () => {
                  const { certificatePdf } = await import('../export/certificate')
                  const at = enrollment.certificateAt ?? Date.now()
                  await db.enrollments.update(enrollment.id, { studentName: name.trim(), certificateAt: at, updatedAt: Date.now() })
                  downloadBlob(await certificatePdf({ student: name.trim(), course: course.title, completed: new Date(enrollment.completedAt ?? at), organization: course.organization, instructor: course.certificate.instructor }), `${slug(course.title)}-certificate.pdf`)
                }}
              >
                <Download size={16} aria-hidden /> Download certificate
              </button>
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }} data-testid="certificate-not-yet">
              {eligible?.reason}
            </p>
          )}
        </section>
      )}
      {visible.length > 0 && (
        <SaveOffline
          id={`course:${course.id}`}
          label={`Course: ${course.title}`}
          refs={visible.flatMap((l) => [l.primaryRef, ...l.supportingRefs, ...l.blocks.flatMap((b) => (b.kind === 'scripture' ? [b.ref] : b.kind === 'xref' ? [b.to] : []))]).filter(Boolean)}
        />
      )}
      {course.role === 'student' && (
        <div>
          <button className="btn danger" onClick={() => setConfirmRemove(true)}>
            Remove this course from this device
          </button>
        </div>
      )}
      <Dialog open={confirmRemove} onClose={() => setConfirmRemove(false)} title="Remove this course?">
        <p>This removes the course, your progress, quiz results, and reflections in it from this device. Include it in a backup first if you want to keep a record.</p>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              await deleteCourse(course.id)
              nav('/learn')
            }}
          >
            Remove
          </button>
          <button className="btn" onClick={() => setConfirmRemove(false)}>
            Keep it
          </button>
        </div>
      </Dialog>
    </div>
  )
}

/* ---------------- lesson ---------------- */

export function LessonPage() {
  const { id = '', lessonId = '' } = useParams()
  const [sp] = useSearchParams()
  const preview = sp.get('preview') === '1'
  const nav = useNavigate()
  const { course, lessons, enrollment, attempts } = useCourse(id)
  const lesson = lessons?.find((l) => l.id === lessonId)
  useEffect(() => {
    if (lesson) document.title = `${lesson.title} · Arise Bible Study`
    window.scrollTo?.(0, 0)
  }, [lesson])
  useEffect(() => {
    if (enrollment && lesson && enrollment.lastLessonId !== lesson.id) db.enrollments.update(enrollment.id, { lastLessonId: lesson.id, updatedAt: Date.now() })
  }, [enrollment, lesson])
  if (course === undefined || lessons === undefined || attempts === undefined) return <Loading />
  if (!course || !lesson || (!preview && lesson.status !== 'published')) {
    return (
      <div className="page">
        <h1>Lesson not found</h1>
        <Link to={course ? `/learn/courses/${course.id}` : '/learn'}>Back</Link>
      </div>
    )
  }
  const visible = lessons.filter((l) => preview || l.status === 'published')
  const i = visible.findIndex((l) => l.id === lesson.id)
  const prev = visible[i - 1]
  const next = visible[i + 1]
  const q = preview ? '?preview=1' : ''
  const done = !!enrollment?.lessonsDone[lesson.id]
  const progress = courseProgress(course, preview ? visible.map((l) => ({ ...l, status: 'published' as const })) : lessons, enrollment, attempts)
  if (!preview && !isReleased(lesson)) {
    return (
      <div className="page">
        <h1>{lesson.title}</h1>
        <p>This lesson opens on {lesson.releaseOn}.</p>
        <Link to={`/learn/courses/${course.id}`}>Back to the course</Link>
      </div>
    )
  }
  const toggleDone = async () => {
    const e = enrollment ?? (await enroll(course, ''))
    await setLessonDone(e, lesson.id, !done)
    if (!done) toast('Lesson complete')
  }

  return (
    <div className="lesson-layout">
      <aside className="lesson-nav no-print" aria-label="Course outline">
        <Link to={`/learn/courses/${course.id}${q}`} style={{ fontWeight: 600 }}>
          {course.title}
        </Link>
        <ProgressBar percent={progress.percent} label={`Course ${progress.percent}% complete`} />
        <span className="muted small">{progress.percent}% complete</span>
        <label className="mobile-only stack" style={{ gap: 4 }}>
          <span className="small">Go to lesson</span>
          <select value={lesson.id} onChange={(e) => nav(`/learn/courses/${course.id}/lessons/${e.target.value}${q}`)}>
            {visible.map((l, n) => (
              <option key={l.id} value={l.id}>
                {n + 1}. {l.title}
                {enrollment?.lessonsDone[l.id] ? ' (done)' : ''}
              </option>
            ))}
          </select>
        </label>
        <nav className="desktop-only" aria-label="Lessons">
          {course.units.map((u) => {
            const ls = u.lessonIds.map((x) => visible.find((l) => l.id === x)).filter((l): l is Lesson => !!l)
            if (!ls.length) return null
            return (
              <div key={u.id}>
                <div className="small muted" style={{ marginTop: 8 }}>{u.title}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {ls.map((l) => (
                    <li key={l.id} className="row small" style={{ gap: 6, padding: '2px 0' }}>
                      {enrollment?.lessonsDone[l.id] ? <CheckCircle2 size={14} aria-label="Completed" /> : <Circle size={14} aria-hidden />}
                      <Link to={`/learn/courses/${course.id}/lessons/${l.id}${q}`} aria-current={l.id === lesson.id ? 'page' : undefined} style={{ fontWeight: l.id === lesson.id ? 700 : undefined }}>
                        {l.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </nav>
      </aside>
      <article className="lesson stack" aria-labelledby="lesson-h">
        {preview && (
          <div className="notice info small no-print">
            Preview{lesson.status !== 'published' ? ': this lesson is a draft and students cannot see it yet.' : '.'} <Link to={`/learn/courses/${course.id}/lessons/${lesson.id}/edit`}>Edit lesson</Link>
          </div>
        )}
        <div className="row no-print" style={{ flexWrap: 'wrap' }}>
          <span className="muted small">
            Lesson {i + 1} of {visible.length}
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => window.print()}>
            <Printer size={14} aria-hidden /> Print or save as PDF
          </button>
        </div>
        <h1 id="lesson-h" style={{ margin: 0 }}>{lesson.title}</h1>
        {lesson.intro && <LinkedText text={lesson.intro} className="prewrap" />}
        {lesson.objectives.length > 0 && (
          <section>
            <h2>Objectives</h2>
            <ul>
              {lesson.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </section>
        )}
        {lesson.primaryRef && <PrimaryScripture osis={lesson.primaryRef} />}
        {lesson.supportingRefs.length > 0 && (
          <section>
            <h2>Supporting Scriptures</h2>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {lesson.supportingRefs.map((r) => (
                <ScriptureRef key={r} r={r} />
              ))}
            </div>
          </section>
        )}
        {lesson.blocks.length > 0 && (
          <section className="stack" aria-label="Lesson content">
            {lesson.blocks.map((b) => (
              <LessonBlockView key={b.id} block={b} />
            ))}
          </section>
        )}
        {lesson.context && (
          <section>
            <h2>Historical and biblical context</h2>
            <LinkedText text={lesson.context} className="prewrap" />
          </section>
        )}
        {preview && lesson.instructorNotes && (
          <section className="notice warn">
            <strong>Instructor notes (not shown to students)</strong>
            <LinkedText text={lesson.instructorNotes} className="prewrap" />
          </section>
        )}
        {lesson.discussion.length > 0 && (
          <section>
            <h2>Discussion questions</h2>
            <ol>
              {lesson.discussion.map((d) => (
                <li key={d}>
                  <LinkedText text={d} />
                </li>
              ))}
            </ol>
          </section>
        )}
        {lesson.reflection.length > 0 && (
          <section className="stack">
            <h2 style={{ marginBottom: 0 }}>Reflection</h2>
            <p className="muted small" style={{ margin: 0 }}>Your answers are saved on this device as you type. They are yours; they are not graded.</p>
            {lesson.reflection.map((r) => (
              <Written key={r} course={course} lesson={lesson} prompt={r} />
            ))}
          </section>
        )}
        {lesson.assignments.length > 0 && (
          <section>
            <h2>Assignments</h2>
            <ul>
              {lesson.assignments.map((a) => (
                <li key={a}>
                  <LinkedText text={a} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {lesson.quiz && lesson.quiz.questions.length > 0 && <QuizRunner course={course} lesson={lesson} quiz={lesson.quiz} attempts={attempts.filter((a) => a.lessonId === lesson.id)} />}
        {lesson.summary && (
          <section>
            <h2>Summary</h2>
            <LinkedText text={lesson.summary} className="prewrap" />
          </section>
        )}
        <section className="stack no-print">
          <h2 style={{ marginBottom: 0 }}>My notes</h2>
          <Written course={course} lesson={lesson} prompt="__notes" label="My notes on this lesson" />
        </section>
        <div className="row no-print" style={{ flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {prev ? (
            <Link className="btn" to={`/learn/courses/${course.id}/lessons/${prev.id}${q}`}>
              <ChevronLeft size={16} aria-hidden /> Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="spacer" />
          <button className={`btn ${done ? '' : 'primary'}`} aria-pressed={done} onClick={toggleDone} data-testid="lesson-complete">
            {done ? <CheckCircle2 size={16} aria-hidden /> : <Circle size={16} aria-hidden />} {done ? 'Lesson completed' : 'Mark lesson complete'}
          </button>
          {next ? (
            <Link className="btn" to={`/learn/courses/${course.id}/lessons/${next.id}${q}`}>
              Next lesson <ChevronRight size={16} aria-hidden />
            </Link>
          ) : (
            <Link className="btn" to={`/learn/courses/${course.id}${q}`}>
              Course overview <ChevronRight size={16} aria-hidden />
            </Link>
          )}
        </div>
      </article>
    </div>
  )
}

function PrimaryScripture({ osis }: { osis: string }) {
  const r = parseOsis(osis)
  const { data, error } = useAsync(async () => (r ? passageToText(await getPassage(r, 'KJV')) : ''), [osis])
  if (!r) return null
  return (
    <section aria-labelledby="ps-h">
      <h2 id="ps-h">Primary Scripture</h2>
      <div className="block scripture">
        <div className="block-label">
          <BookOpen size={13} aria-hidden /> Scripture · <ScriptureRef r={osis} /> (KJV)
        </div>
        {error ? <div className="notice error small">Could not load {refText(osis)}.</div> : data === undefined ? <Loading /> : <blockquote style={{ margin: 0 }}>{data}</blockquote>}
      </div>
      <p className="small no-print" style={{ margin: '6px 0 0' }}>
        <Link to={`/bible/${r.book}/${r.chapter}${r.verse ? '/' + r.verse + (r.endVerse && !r.endChapter ? '-' + r.endVerse : '') : ''}`}>Open in the Bible reader</Link> to read the context or study this passage.
      </p>
    </section>
  )
}

export function LessonBlockView({ block: b }: { block: LessonBlock }) {
  if (b.kind === 'text')
    return b.heading ? (
      <h2 style={{ marginBottom: 0 }}>{b.text}</h2>
    ) : (
      <div className="block lesson-text">
        <div className="block-label">Lesson</div>
        <LinkedText text={b.text} className="prewrap" />
      </div>
    )
  if (b.kind === 'video')
    return (
      <div className="block">
        <div className="block-label">Video</div>
        <a href={b.url} target="_blank" rel="noopener noreferrer nofollow">
          {b.title || b.url} <ExternalLink size={13} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <div className="muted small">Opens on the video site. An internet connection is needed.</div>
      </div>
    )
  if (b.kind === 'file')
    return (
      <div className="block">
        <div className="block-label">Download</div>
        <button
          className="btn sm"
          onClick={() => {
            const bin = atob(b.data)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            downloadBlob(new Blob([bytes], { type: b.type }), b.name)
          }}
        >
          <FileText size={14} aria-hidden /> {b.name} ({Math.max(1, Math.round(b.size / 1024))} KB)
        </button>
      </div>
    )
  if (b.kind === 'ai')
    return (
      <div className="block ai">
        <div className="block-label">{b.reviewed ? 'AI-assisted draft, reviewed by the lesson author' : 'AI-generated draft (not reviewed)'}</div>
        <LinkedText text={b.text} className="prewrap" />
        {b.citations.length > 0 && (
          <div className="small">
            Passages:{' '}
            {b.citations.map((c) => (
              <ScriptureRef key={c} r={c} />
            ))}
          </div>
        )}
      </div>
    )
  return <BlockView block={b} onChange={() => {}} readOnly />
}

/** A reflection or note answer, saved as the student types. */
function Written({ course, lesson, prompt, label }: { course: Course; lesson: Lesson; prompt: string; label?: string }) {
  const existing = useLiveQuery(() => db.submissions.where('lessonId').equals(lesson.id).filter((s) => s.prompt === prompt).first(), [lesson.id, prompt])
  const [text, setText] = useState<string | null>(null)
  const [state, setState] = useState<'' | 'saving' | 'saved'>('')
  const value = text ?? existing?.text ?? ''
  useEffect(() => {
    if (text === null || text === (existing?.text ?? '')) return
    setState('saving')
    const t = setTimeout(async () => {
      const now = Date.now()
      if (existing) await db.submissions.update(existing.id, { text, updatedAt: now })
      else await db.submissions.add({ id: uid(), courseId: course.id, lessonId: lesson.id, prompt, text, createdAt: now, updatedAt: now })
      setState('saved')
    }, 500)
    return () => clearTimeout(t)
  }, [text, existing, course.id, lesson.id, prompt])
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span>{label ?? <LinkedText text={prompt} />}</span>
      <textarea rows={3} value={value} onChange={(e) => setText(e.target.value)} />
      <span className="muted small" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
      </span>
    </label>
  )
}

/* ---------------- quiz ---------------- */

function QuizRunner({ course, lesson, quiz, attempts }: { course: Course; lesson: Lesson; quiz: Quiz; attempts: Attempt[] }) {
  const mine = attempts.filter((a) => a.quizId === quiz.id).sort((a, b) => b.startedAt - a.startedAt)
  const open = mine.find((a) => !a.submittedAt)
  const last = mine.find((a) => a.submittedAt)
  const best = mine.reduce((m, a) => Math.max(m, a.score ?? 0), 0)
  const left = attemptsLeft(quiz, attempts)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [showResult, setShowResult] = useState<string | null>(null)
  const result = mine.find((a) => a.id === showResult) ?? (open ? undefined : last)

  const start = async () => {
    const a: Attempt = { id: uid(), courseId: course.id, lessonId: lesson.id, quizId: quiz.id, startedAt: Date.now(), answers: {}, updatedAt: Date.now() }
    await db.attempts.add(a)
    setAnswers({})
    setShowResult(null)
  }
  const submit = async (a: Attempt) => {
    const g = gradeQuiz(quiz, answers)
    await db.attempts.update(a.id, { answers, submittedAt: Date.now(), score: g.score, passed: g.passed, updatedAt: Date.now() })
    setShowResult(a.id)
  }

  return (
    <section className="card stack" aria-labelledby="quiz-h" data-testid="quiz">
      <h2 id="quiz-h" style={{ margin: 0 }}>
        {quiz.title}
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}. Passing score {quiz.passScore}%.{quiz.required ? ' Required to complete the course.' : ' Optional.'}
        {quiz.timeLimit > 0 && ` Time limit: ${quiz.timeLimit} minutes.`}
        {quiz.attempts > 0 && ` ${Number.isFinite(left) ? left : 'Unlimited'} of ${quiz.attempts} attempts left.`}
        {mine.some((a) => a.submittedAt) && ` Best score: ${best}%.`}
      </p>
      {open ? (
        <QuizForm quiz={quiz} attempt={open} answers={answers} setAnswers={setAnswers} onSubmit={() => submit(open)} />
      ) : (
        <>
          {result && <QuizResultView quiz={quiz} attempt={result} />}
          {left > 0 ? (
            <div>
              <button className="btn primary" onClick={start}>
                {mine.length ? 'Take the quiz again' : 'Start the quiz'}
              </button>
            </div>
          ) : (
            mine.length > 0 && <p className="muted small" style={{ margin: 0 }}>No more attempts are allowed for this quiz.</p>
          )}
        </>
      )}
    </section>
  )
}

function QuizForm({ quiz, attempt, answers, setAnswers, onSubmit }: { quiz: Quiz; attempt: Attempt; answers: Record<string, unknown>; setAnswers: (a: Record<string, unknown>) => void; onSubmit: () => void }) {
  const questions = useMemo(() => (quiz.shuffle ? shuffled(quiz.questions, attempt.id) : quiz.questions), [quiz, attempt.id])
  const deadline = quiz.timeLimit > 0 ? attempt.startedAt + quiz.timeLimit * 60000 : 0
  const [now, setNow] = useState(Date.now())
  const submitted = useRef(false)
  useEffect(() => {
    if (!deadline) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [deadline])
  useEffect(() => {
    if (deadline && now >= deadline && !submitted.current) {
      submitted.current = true
      onSubmit()
    }
  }, [now, deadline, onSubmit])
  const set = (id: string, v: unknown) => setAnswers({ ...answers, [id]: v })
  const remaining = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : 0
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        submitted.current = true
        onSubmit()
      }}
    >
      {deadline > 0 && (
        <div className="notice info small" role="timer" aria-live="off">
          Time left: {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}. Your answers are submitted automatically when time runs out.
        </div>
      )}
      {questions.map((q, n) => (
        <fieldset key={q.id} className="quiz-q">
          <legend>
            {n + 1}. <LinkedText text={q.prompt} />
          </legend>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => set(q.id, v)} seed={attempt.id} />
        </fieldset>
      ))}
      <div>
        <button className="btn primary" type="submit">
          Submit answers
        </button>
      </div>
    </form>
  )
}

function QuestionInput({ q, value, onChange, seed }: { q: Question; value: unknown; onChange: (v: unknown) => void; seed: string }) {
  switch (q.type) {
    case 'choice':
      return (
        <div className="stack" style={{ gap: 4 }}>
          {(q.options ?? []).map((o, i) => (
            <label key={i} className="row">
              <input type="radio" name={q.id} checked={value === i} onChange={() => onChange(i)} /> {o}
            </label>
          ))}
        </div>
      )
    case 'truefalse':
      return (
        <div className="row">
          {[true, false].map((v) => (
            <label key={String(v)} className="row">
              <input type="radio" name={q.id} checked={value === v} onChange={() => onChange(v)} /> {v ? 'True' : 'False'}
            </label>
          ))}
        </div>
      )
    case 'blank':
      return <input aria-label="Your answer" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'reference':
      return <input aria-label="Scripture reference, for example John 3:16" placeholder="e.g. John 3:16" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'short':
    case 'reflection':
      return <textarea aria-label="Your answer" rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'matching': {
      const rights = shuffled((q.pairs ?? []).map((p) => p[1]), seed + q.id)
      const v = (value as Record<string, string>) ?? {}
      return (
        <div className="stack" style={{ gap: 4 }}>
          {(q.pairs ?? []).map(([left], i) => (
            <label key={i} className="row">
              <span style={{ minWidth: 120 }}>{left}</span>
              <select value={v[String(i)] ?? ''} onChange={(e) => onChange({ ...v, [String(i)]: e.target.value })} aria-label={`Match for ${left}`}>
                <option value="">Choose</option>
                {rights.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )
    }
  }
}

function answerText(q: Question): string {
  switch (q.type) {
    case 'choice':
      return q.options?.[q.answer as number] ?? ''
    case 'truefalse':
      return q.answer ? 'True' : 'False'
    case 'blank':
      return (q.answer as string[]).join(' or ')
    case 'reference':
      return refText(String(q.answer))
    case 'matching':
      return (q.pairs ?? []).map(([a, b]) => `${a}: ${b}`).join('; ')
    default:
      return ''
  }
}

function QuizResultView({ quiz, attempt }: { quiz: Quiz; attempt: Attempt }) {
  const g = gradeQuiz(quiz, attempt.answers)
  const reveal = quiz.showAnswers === 'after-submit' || (quiz.showAnswers === 'after-pass' && attempt.passed)
  return (
    <div className="stack" data-testid="quiz-result" role="status">
      <div className={`notice ${attempt.passed ? 'ok' : 'warn'}`}>
        <strong>
          Score: {attempt.score}%. {attempt.passed ? 'Passed.' : `Not yet passing (${quiz.passScore}% needed).`}
        </strong>
        {g.written > 0 && ` ${g.written} written answer${g.written === 1 ? ' is' : 's are'} saved and not graded automatically.`}
      </div>
      {g.review.length > 0 && (
        <div className="small">
          <strong>For more study:</strong>{' '}
          {g.review.map((r) => (
            <span key={r} style={{ marginRight: 8 }}>
              <ScriptureRef r={r} />
            </span>
          ))}
        </div>
      )}
      <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
        {quiz.questions.map((q) => {
          const r = g.results.find((x) => x.id === q.id)!
          return (
            <li key={q.id} className="small">
              <LinkedText text={q.prompt} />{' '}
              {isAutoGraded(q) ? (
                <strong>{r.credit === 1 ? 'Correct' : r.credit > 0 ? 'Partly correct' : r.answered ? 'Not correct' : 'Not answered'}</strong>
              ) : (
                <em>Saved, not graded automatically</em>
              )}
              {reveal && isAutoGraded(q) && r.credit < 1 && <div>Answer: {answerText(q)}</div>}
              {reveal && q.explanation && (
                <div className="muted">
                  {isAutoGraded(q) ? '' : 'Things to consider: '}
                  <LinkedText text={q.explanation} />
                </div>
              )}
              {q.refs.length > 0 && (
                <div>
                  {q.refs.map((x) => (
                    <span key={x} style={{ marginRight: 8 }}>
                      <ScriptureRef r={x} />
                    </span>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!reveal && <p className="muted small" style={{ margin: 0 }}>The instructor has chosen not to show answers {quiz.showAnswers === 'after-pass' ? 'until you pass' : 'for this quiz'}.</p>}
    </div>
  )
}
