import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp, BookOpen, Copy, Download, Eye, FileText, Heading, Plus, Trash2, Type, Video } from 'lucide-react'
import { db, uid, type Course, type Lesson, type LessonBlock, type Question, type QuestionType, type Quiz } from '../db/db'
import { Dialog, Loading, downloadBlob, slug, toast } from '../components/ui'
import { BlockView, InsertScriptureDialog } from '../components/Blocks'
import { loadBookIndex } from '../lib/data'
import { formatRef, isValidRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import {
  ATTACHMENT_TYPES,
  TRACKS,
  TRACK_TOPICS,
  addLesson,
  courseFileFrom,
  courseLessons,
  deleteCourse,
  deleteLesson,
  duplicateCourse,
  newQuiz,
  publishCourse,
  publishProblems,
  questionProblem,
  setCourseStatus,
} from '../lib/courses'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
const refLabel = (o: string) => (parseOsis(o) ? formatRef(parseOsis(o)!) : o)

/** Saves edits shortly after typing stops; flushes on leaving the page. */
function useDraft<T extends { id: string; updatedAt: number }>(initial: T | undefined, save: (v: T) => Promise<unknown>) {
  const [value, setValue] = useState<T | undefined>(initial)
  const [state, setState] = useState<'saved' | 'saving'>('saved')
  const pending = useRef<T | null>(null)
  // take the stored copy when nothing is waiting to be saved (e.g. after Publish or Archive changed it)
  useEffect(() => {
    if (initial && (!value || value.id !== initial.id || (!pending.current && initial.updatedAt > value.updatedAt))) setValue(initial)
  }, [initial, value])
  useEffect(() => {
    if (!pending.current) return
    setState('saving')
    const t = setTimeout(async () => {
      const v = pending.current
      pending.current = null
      if (v) await save(v)
      setState('saved')
    }, 500)
    return () => clearTimeout(t)
  }, [value, save])
  useEffect(
    () => () => {
      if (pending.current) save(pending.current)
    },
    [save],
  )
  /** write any waiting edit now, before an action that reads or changes the stored copy */
  const flush = async () => {
    const v = pending.current
    pending.current = null
    if (v) await save(v)
    setState('saved')
  }
  const update = (f: (v: T) => T) =>
    setValue((cur) => {
      if (!cur) return cur
      const next = { ...f(cur), updatedAt: Date.now() }
      pending.current = next
      return next
    })
  return { value, update, state, flush }
}

const saveCourse = (c: Course) => db.courses.put(c)
const saveLesson = (l: Lesson) => db.lessons.put(l)

/* ---------------- course editor ---------------- */

export function CourseEditorPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const stored = useLiveQuery(() => db.courses.get(id), [id])
  const lessons = useLiveQuery(() => db.lessons.where('courseId').equals(id).toArray(), [id])
  const versions = useLiveQuery(() => db.courseVersions.where('courseId').equals(id).reverse().sortBy('version'), [id])
  const { value: course, update, state, flush } = useDraft(stored ?? undefined, saveCourse)
  const [problems, setProblems] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    loadBookIndex()
  }, [])
  useEffect(() => {
    if (course) document.title = `Edit: ${course.title} · Arise Bible Study`
  }, [course])
  if (stored === undefined || lessons === undefined) return <Loading />
  if (!stored || !course) {
    return (
      <div className="page">
        <h1>Course not found</h1>
        <Link to="/learn">Back to Learn</Link>
      </div>
    )
  }
  if (course.role !== 'instructor') {
    return (
      <div className="page">
        <h1>{course.title}</h1>
        <p>This course was added from a course file to take, so it can't be edited here.</p>
        <Link to={`/learn/courses/${course.id}`}>Open the course</Link>
      </div>
    )
  }
  const byId = new Map(lessons.map((l) => [l.id, l]))
  const moveUnit = (i: number, d: number) =>
    update((c) => {
      const u = c.units.slice()
      const j = i + d
      if (j < 0 || j >= u.length) return c
      ;[u[i], u[j]] = [u[j], u[i]]
      return { ...c, units: u }
    })
  const moveLesson = (unitId: string, i: number, d: number) =>
    update((c) => ({
      ...c,
      units: c.units.map((u) => {
        if (u.id !== unitId) return u
        const ids = u.lessonIds.slice()
        const j = i + d
        if (j < 0 || j >= ids.length) return u
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        return { ...u, lessonIds: ids }
      }),
    }))
  const moveToUnit = (lessonId: string, unitId: string) =>
    update((c) => ({ ...c, units: c.units.map((u) => ({ ...u, lessonIds: u.id === unitId ? [...u.lessonIds.filter((x) => x !== lessonId), lessonId] : u.lessonIds.filter((x) => x !== lessonId) })) }))
  const publish = async () => {
    await flush()
    const fresh = (await db.courses.get(course.id))!
    const p = publishProblems(fresh, await courseLessons(fresh))
    setProblems(p)
    if (p.length) return
    await publishCourse(fresh)
    toast('Published. Download a course file to share it.')
  }
  const latest = versions?.[0]

  return (
    <div className="page stack" style={{ maxWidth: 960 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to="/learn">Learn</Link> / Course builder
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Edit course</h1>
        <span className={`badge ${course.status === 'published' ? 'source' : ''}`} data-testid="course-status">
          {course.status === 'draft' ? 'Draft (only on this device)' : course.status === 'published' ? `Published, version ${course.version}` : 'Archived'}
        </span>
        <span className="spacer" />
        <span className="muted small" aria-live="polite" data-status={state}>
          {state === 'saving' ? 'Saving…' : 'All changes saved'}
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={publish}>
          {course.version ? 'Publish an update' : 'Publish'}
        </button>
        <Link className="btn" to={`/learn/courses/${course.id}?preview=1`}>
          <Eye size={16} aria-hidden /> Preview as a student
        </Link>
        <button
          className="btn"
          onClick={async () => {
            await flush()
            const fresh = (await db.courses.get(course.id))!
            const copy = await duplicateCourse(fresh, await courseLessons(fresh))
            toast('Copy made')
            nav(`/learn/courses/${copy.id}/edit`)
          }}
        >
          <Copy size={16} aria-hidden /> Duplicate
        </button>
        {course.status !== 'archived' ? (
          <button className="btn" onClick={async () => (await flush(), setCourseStatus(course, 'archived'))}>
            Archive
          </button>
        ) : (
          <button className="btn" onClick={async () => (await flush(), setCourseStatus(course, course.version ? 'published' : 'draft'))}>
            Restore from archive
          </button>
        )}
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} aria-hidden /> Delete
        </button>
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
      <p className="muted small" style={{ margin: 0 }}>
        Drafts stay on this device. Publishing saves a version. To share a published course, download a course file and send it to your students; they add it with "Add a course from a file". Nothing is uploaded.
      </p>
      {latest && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => downloadBlob(new Blob([courseFileFrom(latest, 'students')], { type: 'application/json' }), `${slug(course.title)}-v${latest.version}.json`)}>
            <Download size={16} aria-hidden /> Course file for students
          </button>
          <button className="btn" onClick={() => downloadBlob(new Blob([courseFileFrom(latest, 'instructors')], { type: 'application/json' }), `${slug(course.title)}-v${latest.version}-instructors.json`)}>
            <Download size={16} aria-hidden /> Course file for instructors (includes instructor notes)
          </button>
        </div>
      )}

      <section className="card stack" aria-labelledby="details-h">
        <h2 id="details-h" style={{ margin: 0 }}>Course details</h2>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Title</strong>
          <input value={course.title} onChange={(e) => update((c) => ({ ...c, title: e.target.value }))} onFocus={(e) => course.title === 'Untitled course' && e.target.select()} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Description</strong>
          <textarea rows={3} value={course.description} onChange={(e) => update((c) => ({ ...c, description: e.target.value }))} />
        </label>
        <LinesField label="Learning objectives (one per line)" value={course.objectives} onChange={(v) => update((c) => ({ ...c, objectives: v }))} />
        <div className="grid-2">
          <label className="stack" style={{ gap: 4 }}>
            <strong>Category</strong>
            <select value={course.category} onChange={(e) => update((c) => ({ ...c, category: e.target.value }))}>
              {TRACKS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {TRACK_TOPICS[course.category] && <span className="muted small">Suggested topics in this track: {TRACK_TOPICS[course.category].join(', ')}.</span>}
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Difficulty</strong>
            <select value={course.level} onChange={(e) => update((c) => ({ ...c, level: e.target.value as Course['level'] }))}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Estimated duration</strong>
            <input value={course.duration} placeholder="e.g. 8 weeks" onChange={(e) => update((c) => ({ ...c, duration: e.target.value }))} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Author</strong>
            <input value={course.author} onChange={(e) => update((c) => ({ ...c, author: e.target.value }))} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Organization</strong>
            <input value={course.organization} placeholder="e.g. Arise Church" onChange={(e) => update((c) => ({ ...c, organization: e.target.value }))} />
          </label>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Your theological perspective (shown to students)</strong>
          <span className="muted small">For example your church's tradition or statement of faith. Scripture text is never changed to fit a perspective.</span>
          <textarea rows={2} value={course.perspective} onChange={(e) => update((c) => ({ ...c, perspective: e.target.value }))} />
        </label>
        <fieldset className="stack" style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600 }}>Completion requirements</legend>
          <label className="row">
            <input type="checkbox" checked={course.completion.lessons} onChange={(e) => update((c) => ({ ...c, completion: { ...c.completion, lessons: e.target.checked } }))} /> Complete every lesson
          </label>
          <label className="row">
            <input type="checkbox" checked={course.completion.quizzes} onChange={(e) => update((c) => ({ ...c, completion: { ...c.completion, quizzes: e.target.checked } }))} /> Pass every required quiz
          </label>
          <label className="row">
            Sessions of attendance required
            <input type="number" min={0} max={100} style={{ width: 80 }} value={course.completion.attendance} onChange={(e) => update((c) => ({ ...c, completion: { ...c.completion, attendance: Math.max(0, +e.target.value || 0) } }))} />
          </label>
          {course.completion.attendance > 0 && <span className="muted small">You record attendance on this device (below). Students' devices can't see it, so you issue certificates for this course yourself.</span>}
          <label className="row">
            <input type="checkbox" checked={course.certificate.enabled} onChange={(e) => update((c) => ({ ...c, certificate: { ...c.certificate, enabled: e.target.checked } }))} /> Offer a completion certificate
          </label>
          {course.certificate.enabled && (
            <label className="stack" style={{ gap: 4 }}>
              <strong>Instructor name on certificates</strong>
              <input value={course.certificate.instructor} onChange={(e) => update((c) => ({ ...c, certificate: { ...c.certificate, instructor: e.target.value } }))} />
            </label>
          )}
        </fieldset>
      </section>

      <section className="stack" aria-labelledby="units-h">
        <div className="row">
          <h2 id="units-h" style={{ margin: 0 }}>Units and lessons</h2>
          <span className="spacer" />
          <button className="btn" onClick={() => update((c) => ({ ...c, units: [...c.units, { id: uid(), title: `Unit ${c.units.length + 1}`, lessonIds: [] }] }))}>
            <Plus size={16} aria-hidden /> Add unit
          </button>
        </div>
        {course.units.map((u, ui) => (
          <div key={u.id} className="card stack" data-testid="unit">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input aria-label="Unit title" value={u.title} onChange={(e) => update((c) => ({ ...c, units: c.units.map((x) => (x.id === u.id ? { ...x, title: e.target.value } : x)) }))} style={{ flex: 1, minWidth: 160, fontWeight: 600 }} />
              <button className="iconbtn" onClick={() => moveUnit(ui, -1)} disabled={ui === 0} aria-label={`Move ${u.title} up`}>
                <ArrowUp size={16} />
              </button>
              <button className="iconbtn" onClick={() => moveUnit(ui, 1)} disabled={ui === course.units.length - 1} aria-label={`Move ${u.title} down`}>
                <ArrowDown size={16} />
              </button>
              <button className="iconbtn" disabled={u.lessonIds.length > 0 || course.units.length === 1} title={u.lessonIds.length ? 'Move or delete its lessons first' : undefined} onClick={() => update((c) => ({ ...c, units: c.units.filter((x) => x.id !== u.id) }))} aria-label={`Delete ${u.title}`}>
                <Trash2 size={16} />
              </button>
            </div>
            <ol className="list" style={{ paddingLeft: 0 }}>
              {u.lessonIds.map((lid, li) => {
                const l = byId.get(lid)
                if (!l) return null
                return (
                  <li key={lid} className="row" style={{ flexWrap: 'wrap' }}>
                    <Link to={`/learn/courses/${course.id}/lessons/${lid}/edit`} style={{ fontWeight: 600 }}>
                      {l.title}
                    </Link>
                    <span className={`badge ${l.status === 'published' ? 'source' : ''}`}>{l.status === 'draft' ? 'Draft' : l.status === 'published' ? 'Published' : 'Archived'}</span>
                    {l.releaseOn && <span className="muted small">opens {l.releaseOn}</span>}
                    <span className="spacer" />
                    <button className="iconbtn" onClick={() => moveLesson(u.id, li, -1)} disabled={li === 0} aria-label={`Move ${l.title} up`}>
                      <ArrowUp size={16} />
                    </button>
                    <button className="iconbtn" onClick={() => moveLesson(u.id, li, 1)} disabled={li === u.lessonIds.length - 1} aria-label={`Move ${l.title} down`}>
                      <ArrowDown size={16} />
                    </button>
                    {course.units.length > 1 && (
                      <select aria-label={`Move ${l.title} to unit`} value={u.id} onChange={(e) => moveToUnit(lid, e.target.value)}>
                        {course.units.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                )
              })}
            </ol>
            <div>
              <button
                className="btn sm"
                onClick={async () => {
                  // save waiting edits first so the new lesson lands in the current outline and is not overwritten
                  await flush()
                  const l = await addLesson((await db.courses.get(course.id))!, u.id)
                  nav(`/learn/courses/${course.id}/lessons/${l.id}/edit`)
                }}
              >
                <Plus size={14} aria-hidden /> Add lesson
              </button>
            </div>
          </div>
        ))}
      </section>

      {versions && versions.length > 0 && (
        <details>
          <summary>Version history ({versions.length})</summary>
          <ul className="list">
            {versions.map((v) => (
              <li key={v.id} className="row" style={{ flexWrap: 'wrap' }}>
                <strong>Version {v.version}</strong>
                <span className="muted small">
                  published {new Date(v.publishedAt).toLocaleString()}, {v.lessons.length} lessons
                </span>
                <span className="spacer" />
                <button className="btn sm" onClick={() => downloadBlob(new Blob([courseFileFrom(v, 'instructors')], { type: 'application/json' }), `${slug(course.title)}-v${v.version}-instructors.json`)}>
                  Download
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    const copy = await duplicateCourse(v.course, v.lessons, `${v.course.title} (from version ${v.version})`)
                    nav(`/learn/courses/${copy.id}/edit`)
                  }}
                >
                  Copy as a new draft
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <AttendanceSection course={course} />

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this course?">
        <p>This deletes the course, all its lessons, and its version history from this device. Course files you already shared are not affected.</p>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              await flush()
              await deleteCourse(course.id)
              nav('/learn')
            }}
          >
            Delete course
          </button>
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      </Dialog>
    </div>
  )
}

function LinesField({ label, value, onChange, rows = 3 }: { label: string; value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  const [text, setText] = useState(value.join('\n'))
  useEffect(() => {
    if (lines(text).join('\n') !== value.join('\n')) setText(value.join('\n'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <label className="stack" style={{ gap: 4 }}>
      <strong>{label}</strong>
      <textarea
        rows={rows}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          onChange(lines(e.target.value))
        }}
      />
    </label>
  )
}

function AttendanceSection({ course }: { course: Course }) {
  const rows = useLiveQuery(() => db.attendance.where('courseId').equals(course.id).toArray(), [course.id]) ?? []
  const [name, setName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const names = [...new Set(rows.map((r) => r.name))].sort()
  const dates = [...new Set(rows.map((r) => r.date))].sort()
  const cell = (n: string, d: string) => rows.find((r) => r.name === n && r.date === d)
  const toggle = async (n: string, d: string) => {
    const r = cell(n, d)
    if (r) await db.attendance.update(r.id, { present: !r.present, updatedAt: Date.now() })
    else await db.attendance.add({ id: uid(), courseId: course.id, date: d, name: n, present: true, updatedAt: Date.now() })
  }
  const csv = () => {
    const q = (s: string) => `"${s.replace(/"/g, '""')}"`
    const out = [['Name', ...dates, 'Sessions attended'].map(q).join(',')]
    for (const n of names) out.push([q(n), ...dates.map((d) => (cell(n, d)?.present ? 'Present' : '')), String(dates.filter((d) => cell(n, d)?.present).length)].join(','))
    downloadBlob(new Blob([out.join('\r\n')], { type: 'text/csv' }), `${slug(course.title)}-attendance.csv`)
  }
  return (
    <details>
      <summary>Attendance (recorded on this device)</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <form
          className="row"
          style={{ flexWrap: 'wrap' }}
          onSubmit={async (e) => {
            e.preventDefault()
            if (!name.trim()) return
            await db.attendance.add({ id: uid(), courseId: course.id, date, name: name.trim(), present: true, updatedAt: Date.now() })
            setName('')
          }}
        >
          <input aria-label="Student name" placeholder="Student name" value={name} onChange={(e) => setName(e.target.value)} />
          <input aria-label="Session date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn" type="submit">
            Mark present
          </button>
          {names.length > 0 && (
            <button className="btn" type="button" onClick={csv}>
              <Download size={16} aria-hidden /> Download as spreadsheet (CSV)
            </button>
          )}
        </form>
        {names.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="small" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 4 }}>Name</th>
                  {dates.map((d) => (
                    <th key={d} style={{ padding: 4 }}>
                      {d}
                    </th>
                  ))}
                  <th style={{ padding: 4 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {names.map((n) => (
                  <tr key={n} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 4 }}>{n}</td>
                    {dates.map((d) => (
                      <td key={d} style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!!cell(n, d)?.present} onChange={() => toggle(n, d)} aria-label={`${n} present on ${d}`} />
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      {dates.filter((d) => cell(n, d)?.present).length}
                      {course.completion.attendance > 0 && ` / ${course.completion.attendance}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  )
}

/* ---------------- lesson editor ---------------- */

export function LessonEditorPage() {
  const { id = '', lessonId = '' } = useParams()
  const nav = useNavigate()
  const course = useLiveQuery(() => db.courses.get(id), [id])
  const stored = useLiveQuery(() => db.lessons.get(lessonId), [lessonId])
  const { value: lesson, update, state, flush } = useDraft(stored ?? undefined, saveLesson)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [counts, setCounts] = useState(false)
  useEffect(() => {
    loadBookIndex().then(() => setCounts(true))
  }, [])
  useEffect(() => {
    if (lesson) document.title = `Edit lesson: ${lesson.title} · Arise Bible Study`
  }, [lesson])
  if (course === undefined || stored === undefined || !counts) return <Loading />
  if (!course || !stored || !lesson || course.role !== 'instructor') {
    return (
      <div className="page">
        <h1>Lesson not found</h1>
        <Link to="/learn">Back to Learn</Link>
      </div>
    )
  }
  const set = <K extends keyof Lesson>(k: K, v: Lesson[K]) => update((l) => ({ ...l, [k]: v }))

  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to="/learn">Learn</Link> / <Link to={`/learn/courses/${course.id}/edit`}>{course.title}</Link> / Lesson
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Edit lesson</h1>
        <span className="spacer" />
        <span className="muted small" aria-live="polite" data-status={state}>
          {state === 'saving' ? 'Saving…' : 'All changes saved'}
        </span>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <label className="row">
          <strong>Status</strong>
          <select value={lesson.status} onChange={(e) => set('status', e.target.value as Lesson['status'])} aria-describedby="status-help">
            <option value="draft">Draft</option>
            <option value="published">Published (included the next time the course is published)</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="row">
          <strong>Opens on</strong>
          <input type="date" value={lesson.releaseOn ?? ''} onChange={(e) => set('releaseOn', e.target.value || undefined)} />
        </label>
        <Link className="btn" to={`/learn/courses/${course.id}/lessons/${lesson.id}?preview=1`}>
          <Eye size={16} aria-hidden /> Preview
        </Link>
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={16} aria-hidden /> Delete lesson
        </button>
      </div>
      <p className="muted small" id="status-help" style={{ margin: 0 }}>
        Students see a lesson only when it is published and the course is published again. "Opens on" unlocks the lesson on each student's device from that date.
      </p>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Lesson title</strong>
        <input value={lesson.title} onChange={(e) => set('title', e.target.value)} onFocus={(e) => lesson.title === 'Untitled lesson' && e.target.select()} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Introduction</strong>
        <textarea rows={3} value={lesson.intro} onChange={(e) => set('intro', e.target.value)} />
      </label>
      <LinesField label="Learning objectives (one per line)" value={lesson.objectives} onChange={(v) => set('objectives', v)} />
      <RefField label="Primary Scripture" value={lesson.primaryRef ? [lesson.primaryRef] : []} single onChange={(v) => set('primaryRef', v[0] ?? '')} />
      <RefField label="Supporting Scriptures" value={lesson.supportingRefs} onChange={(v) => set('supportingRefs', v)} />
      <section className="stack" aria-labelledby="content-h">
        <h2 id="content-h" style={{ marginBottom: 0 }}>Lesson content</h2>
        <p className="muted small" style={{ margin: 0 }}>Scripture is quoted exactly from the app's text. Sourced material keeps its citation. AI drafts stay labeled and must be reviewed before publishing.</p>
        <LessonBlocksEditor blocks={lesson.blocks} onChange={(b) => set('blocks', b)} />
      </section>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Historical and biblical context</strong>
        <textarea rows={4} value={lesson.context} onChange={(e) => set('context', e.target.value)} />
      </label>
      <LinesField label="Discussion questions (one per line)" value={lesson.discussion} onChange={(v) => set('discussion', v)} />
      <LinesField label="Reflection questions (one per line; students can write answers)" value={lesson.reflection} onChange={(v) => set('reflection', v)} />
      <LinesField label="Practical assignments (one per line)" value={lesson.assignments} onChange={(v) => set('assignments', v)} />
      <label className="stack" style={{ gap: 4 }}>
        <strong>Closing summary</strong>
        <textarea rows={3} value={lesson.summary} onChange={(e) => set('summary', e.target.value)} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Instructor notes (never shown to students)</strong>
        <textarea rows={3} value={lesson.instructorNotes} onChange={(e) => set('instructorNotes', e.target.value)} />
      </label>
      <QuizEditor quiz={lesson.quiz} onChange={(q) => set('quiz', q)} />
      <div>
        <Link className="btn" to={`/learn/courses/${course.id}/edit`}>
          Back to the course
        </Link>
      </div>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this lesson?">
        <p>This removes the lesson from the course on this device. Published versions already shared are not affected.</p>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              await flush()
              await deleteLesson(course, lesson.id)
              nav(`/learn/courses/${course.id}/edit`)
            }}
          >
            Delete lesson
          </button>
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            Keep it
          </button>
        </div>
      </Dialog>
    </div>
  )
}

/** Scripture references typed as text, checked against the Bible, stored as OSIS. */
function RefField({ label, value, onChange, single }: { label: string; value: string[]; onChange: (v: string[]) => void; single?: boolean }) {
  const [text, setText] = useState(value.map(refLabel).join('; '))
  const [bad, setBad] = useState<string[]>([])
  const commit = (t: string) => {
    const parts = t.split(';').map((x) => x.trim()).filter(Boolean)
    const good: string[] = []
    const wrong: string[] = []
    for (const p of parts) {
      const r = parseRef(p)
      if (r && isValidRef(r)) good.push(toOsis(r))
      else wrong.push(p)
    }
    setBad(wrong)
    if (!wrong.length) onChange(single ? good.slice(0, 1) : good)
  }
  return (
    <label className="stack" style={{ gap: 4 }}>
      <strong>{label}</strong>
      <input value={text} placeholder={single ? 'e.g. Romans 8:28-39' : 'e.g. John 15:1-8; Gal 5:22-23'} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} aria-invalid={bad.length > 0} />
      {bad.length > 0 && (
        <span className="notice error small" role="alert">
          Not found in the Bible: {bad.join(', ')}. Nothing was saved for this field until it is fixed.
        </span>
      )}
    </label>
  )
}

function LessonBlocksEditor({ blocks, onChange }: { blocks: LessonBlock[]; onChange: (b: LessonBlock[]) => void }) {
  const [scripture, setScripture] = useState(false)
  const [video, setVideo] = useState(false)
  const [vUrl, setVUrl] = useState('')
  const [vTitle, setVTitle] = useState('')
  const [fileErr, setFileErr] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const upd = (i: number, b: LessonBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= blocks.length) return
    const next = blocks.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const addFile = async (f: File) => {
    setFileErr('')
    if (!ATTACHMENT_TYPES.includes(f.type)) return setFileErr('That kind of file is not supported. Use PDF, Word, PowerPoint, plain text, PNG, JPEG, or MP3.')
    if (f.size > 8 * 1024 * 1024) return setFileErr('Files must be 8 MB or smaller. Large videos and recordings work best as a link.')
    const buf = new Uint8Array(await f.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    onChange([...blocks, { id: uid(), kind: 'file', name: f.name, type: f.type, size: f.size, data: btoa(bin) }])
  }
  return (
    <div className="stack">
      {blocks.map((b, i) => {
        const tools = (
          <div className="block-tools">
            <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              <ArrowUp size={14} />
            </button>
            <button className="iconbtn" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down">
              <ArrowDown size={14} />
            </button>
            <button className="iconbtn" onClick={() => onChange(blocks.filter((_, j) => j !== i))} aria-label="Remove block">
              <Trash2 size={14} />
            </button>
          </div>
        )
        if (b.kind === 'text')
          return (
            <div key={b.id} className="block lesson-text">
              <div className="block-label">
                {b.heading ? 'Section heading' : 'Lesson text (your words)'} {tools}
              </div>
              {b.heading ? <input aria-label="Section heading" value={b.text} onChange={(e) => upd(i, { ...b, text: e.target.value })} /> : <textarea aria-label="Lesson text" rows={4} value={b.text} onChange={(e) => upd(i, { ...b, text: e.target.value })} />}
            </div>
          )
        if (b.kind === 'video')
          return (
            <div key={b.id} className="block">
              <div className="block-label">Video link {tools}</div>
              <a href={b.url} target="_blank" rel="noopener noreferrer nofollow">
                {b.title || b.url}
              </a>
            </div>
          )
        if (b.kind === 'file')
          return (
            <div key={b.id} className="block">
              <div className="block-label">Downloadable file {tools}</div>
              <FileText size={14} aria-hidden /> {b.name} ({Math.max(1, Math.round(b.size / 1024))} KB)
            </div>
          )
        if (b.kind === 'ai')
          return (
            <div key={b.id} className="block ai">
              <div className="block-label">AI-generated draft {tools}</div>
              <textarea aria-label="AI draft text" rows={4} value={b.text} onChange={(e) => upd(i, { ...b, text: e.target.value })} />
              <label className="row small">
                <input type="checkbox" checked={!!b.reviewed} onChange={(e) => upd(i, { ...b, reviewed: e.target.checked })} /> I have checked this draft against Scripture and my sources
              </label>
            </div>
          )
        return <BlockView key={b.id} block={b} onChange={(nb) => upd(i, nb)} tools={tools} />
      })}
      <div className="add-row">
        <button className="btn sm" onClick={() => onChange([...blocks, { id: uid(), kind: 'text', text: '', heading: true }])}>
          <Heading size={14} aria-hidden /> Heading
        </button>
        <button className="btn sm" onClick={() => onChange([...blocks, { id: uid(), kind: 'text', text: '' }])}>
          <Type size={14} aria-hidden /> Text
        </button>
        <button className="btn sm" onClick={() => setScripture(true)}>
          <BookOpen size={14} aria-hidden /> Scripture
        </button>
        <button className="btn sm" onClick={() => setVideo(true)}>
          <Video size={14} aria-hidden /> Video link
        </button>
        <button className="btn sm" onClick={() => fileInput.current?.click()}>
          <FileText size={14} aria-hidden /> File
        </button>
        <input ref={fileInput} type="file" hidden accept={ATTACHMENT_TYPES.join(',')} onChange={(e) => e.target.files?.[0] && addFile(e.target.files[0])} />
      </div>
      {fileErr && (
        <div className="notice error small" role="alert">
          {fileErr}
        </div>
      )}
      <InsertScriptureDialog
        open={scripture}
        title="Insert Scripture (exact KJV text)"
        onClose={() => setScripture(false)}
        onInsert={(osis, text) => {
          onChange([...blocks, { id: uid(), kind: 'scripture', ref: osis, text, tr: 'KJV' }])
          setScripture(false)
        }}
      />
      <Dialog open={video} onClose={() => setVideo(false)} title="Add a video link">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (!/^https?:\/\/\S+$/i.test(vUrl.trim())) return
            onChange([...blocks, { id: uid(), kind: 'video', url: vUrl.trim(), title: vTitle.trim() }])
            setVUrl('')
            setVTitle('')
            setVideo(false)
          }}
        >
          <label className="stack" style={{ gap: 4 }}>
            <strong>Video address</strong>
            <input type="url" required value={vUrl} placeholder="https://www.youtube.com/watch?v=..." onChange={(e) => setVUrl(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Title</strong>
            <input value={vTitle} onChange={(e) => setVTitle(e.target.value)} />
          </label>
          <p className="muted small" style={{ margin: 0 }}>Students open the video on the video site in a new tab.</p>
          <div>
            <button className="btn primary" type="submit">
              Add video
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}

/* ---------------- quiz editor ---------------- */

const TYPE_LABEL: Record<QuestionType, string> = {
  choice: 'Multiple choice',
  truefalse: 'True or false',
  blank: 'Fill in the blank',
  reference: 'Identify the Scripture reference',
  short: 'Short written answer (not auto-graded)',
  reflection: 'Reflection (not graded)',
  matching: 'Matching',
}

function QuizEditor({ quiz, onChange }: { quiz?: Quiz; onChange: (q: Quiz | undefined) => void }) {
  if (!quiz)
    return (
      <section className="stack">
        <h2 style={{ marginBottom: 0 }}>Quiz</h2>
        <div>
          <button className="btn" onClick={() => onChange(newQuiz())}>
            <Plus size={16} aria-hidden /> Add a quiz to this lesson
          </button>
        </div>
      </section>
    )
  const set = <K extends keyof Quiz>(k: K, v: Quiz[K]) => onChange({ ...quiz, [k]: v })
  const setQ = (i: number, q: Question) => set('questions', quiz.questions.map((x, j) => (j === i ? q : x)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= quiz.questions.length) return
    const next = quiz.questions.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    set('questions', next)
  }
  return (
    <section className="card stack" aria-labelledby="quiz-h" data-testid="quiz-editor">
      <div className="row">
        <h2 id="quiz-h" style={{ margin: 0 }}>Quiz</h2>
        <span className="spacer" />
        <button className="btn sm danger" onClick={() => onChange(undefined)}>
          Remove quiz
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Base every question on this lesson and the Scriptures it cites. Written answers are never marked right or wrong automatically.</p>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Quiz title</strong>
        <input value={quiz.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <div className="grid-2">
        <label className="row">
          Passing score (%)
          <input type="number" min={0} max={100} style={{ width: 80 }} value={quiz.passScore} onChange={(e) => set('passScore', Math.min(100, Math.max(0, +e.target.value || 0)))} />
        </label>
        <label className="row">
          Attempts allowed (0 = unlimited)
          <input type="number" min={0} max={20} style={{ width: 80 }} value={quiz.attempts} onChange={(e) => set('attempts', Math.max(0, +e.target.value || 0))} />
        </label>
        <label className="row">
          Time limit in minutes (0 = none)
          <input type="number" min={0} max={240} style={{ width: 80 }} value={quiz.timeLimit} onChange={(e) => set('timeLimit', Math.max(0, +e.target.value || 0))} />
        </label>
        <label className="row">
          Show correct answers
          <select value={quiz.showAnswers} onChange={(e) => set('showAnswers', e.target.value as Quiz['showAnswers'])}>
            <option value="after-submit">After each attempt</option>
            <option value="after-pass">Only after passing</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label className="row">
          <input type="checkbox" checked={quiz.required} onChange={(e) => set('required', e.target.checked)} /> Required to complete the course
        </label>
        <label className="row">
          <input type="checkbox" checked={quiz.shuffle} onChange={(e) => set('shuffle', e.target.checked)} /> Shuffle question order
        </label>
        <label className="row">
          <input type="checkbox" checked={quiz.allowRetake} onChange={(e) => set('allowRetake', e.target.checked)} /> Allow retakes
        </label>
      </div>
      {quiz.questions.map((q, i) => (
        <QuestionEditor key={q.id} n={i + 1} q={q} onChange={(nq) => setQ(i, nq)} onRemove={() => set('questions', quiz.questions.filter((_, j) => j !== i))} onMove={(d) => move(i, d)} first={i === 0} last={i === quiz.questions.length - 1} />
      ))}
      <div className="add-row">
        {(Object.keys(TYPE_LABEL) as QuestionType[]).map((t) => (
          <button
            key={t}
            className="btn sm"
            onClick={() =>
              set('questions', [
                ...quiz.questions,
                { id: uid(), type: t, prompt: '', refs: [], explanation: '', ...(t === 'choice' ? { options: ['', ''], answer: 0 } : t === 'truefalse' ? { answer: true } : t === 'blank' ? { answer: [''] } : t === 'matching' ? { pairs: [['', ''], ['', '']] } : {}) },
              ])
            }
          >
            <Plus size={14} aria-hidden /> {TYPE_LABEL[t].replace(/ \(.*\)$/, '')}
          </button>
        ))}
      </div>
    </section>
  )
}

function QuestionEditor({ n, q, onChange, onRemove, onMove, first, last }: { n: number; q: Question; onChange: (q: Question) => void; onRemove: () => void; onMove: (d: number) => void; first: boolean; last: boolean }) {
  const problem = questionProblem(q)
  return (
    <fieldset className="quiz-q stack" data-testid="question-editor">
      <legend>
        Question {n}: {TYPE_LABEL[q.type]}
      </legend>
      <div className="row">
        {q.aiDraft && (
          <label className="row small">
            <span className="badge ai">AI draft</span>
            <input type="checkbox" checked={!!q.reviewed} onChange={(e) => onChange({ ...q, reviewed: e.target.checked })} /> Reviewed
          </label>
        )}
        <span className="spacer" />
        <button className="iconbtn" onClick={() => onMove(-1)} disabled={first} aria-label={`Move question ${n} up`}>
          <ArrowUp size={14} />
        </button>
        <button className="iconbtn" onClick={() => onMove(1)} disabled={last} aria-label={`Move question ${n} down`}>
          <ArrowDown size={14} />
        </button>
        <button className="iconbtn" onClick={onRemove} aria-label={`Remove question ${n}`}>
          <Trash2 size={14} />
        </button>
      </div>
      <label className="stack" style={{ gap: 4 }}>
        <span>Question</span>
        <textarea rows={2} value={q.prompt} onChange={(e) => onChange({ ...q, prompt: e.target.value })} />
      </label>
      {q.type === 'choice' && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small">Choices (select the correct one)</span>
          {(q.options ?? []).map((o, i) => (
            <div key={i} className="row">
              <input type="radio" name={`ans-${q.id}`} checked={q.answer === i} onChange={() => onChange({ ...q, answer: i })} aria-label={`Choice ${i + 1} is correct`} />
              <input value={o} aria-label={`Choice ${i + 1}`} onChange={(e) => onChange({ ...q, options: q.options!.map((x, j) => (j === i ? e.target.value : x)) })} style={{ flex: 1 }} />
              <button className="iconbtn" disabled={(q.options ?? []).length <= 2} aria-label={`Remove choice ${i + 1}`} onClick={() => onChange({ ...q, options: q.options!.filter((_, j) => j !== i), answer: typeof q.answer === 'number' && q.answer >= i ? Math.max(0, q.answer - (q.answer > i ? 1 : 0)) : q.answer })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div>
            <button className="btn sm" onClick={() => onChange({ ...q, options: [...(q.options ?? []), ''] })}>
              Add choice
            </button>
          </div>
        </div>
      )}
      {q.type === 'truefalse' && (
        <div className="row">
          Correct answer:
          {[true, false].map((v) => (
            <label key={String(v)} className="row">
              <input type="radio" name={`tf-${q.id}`} checked={q.answer === v} onChange={() => onChange({ ...q, answer: v })} /> {v ? 'True' : 'False'}
            </label>
          ))}
        </div>
      )}
      {q.type === 'blank' && (
        <label className="stack" style={{ gap: 4 }}>
          <span>Accepted answers (one per line; capitals and punctuation are ignored)</span>
          <textarea rows={2} value={(q.answer as string[] | undefined)?.join('\n') ?? ''} onChange={(e) => onChange({ ...q, answer: e.target.value.split('\n') })} />
        </label>
      )}
      {q.type === 'reference' && (
        <label className="stack" style={{ gap: 4 }}>
          <span>Correct reference</span>
          <input
            defaultValue={typeof q.answer === 'string' && parseOsis(q.answer) ? formatRef(parseOsis(q.answer)!) : ''}
            placeholder="e.g. John 11:35"
            onBlur={(e) => {
              const r = parseRef(e.target.value)
              onChange({ ...q, answer: r && isValidRef(r) ? toOsis(r) : '' })
            }}
          />
        </label>
      )}
      {q.type === 'matching' && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small">Pairs (students match each left item to its right item)</span>
          {(q.pairs ?? []).map(([a, b], i) => (
            <div key={i} className="row">
              <input aria-label={`Left item ${i + 1}`} value={a} onChange={(e) => onChange({ ...q, pairs: q.pairs!.map((p, j) => (j === i ? [e.target.value, p[1]] : p)) })} />
              <input aria-label={`Right item ${i + 1}`} value={b} onChange={(e) => onChange({ ...q, pairs: q.pairs!.map((p, j) => (j === i ? [p[0], e.target.value] : p)) })} />
              <button className="iconbtn" disabled={(q.pairs ?? []).length <= 2} aria-label={`Remove pair ${i + 1}`} onClick={() => onChange({ ...q, pairs: q.pairs!.filter((_, j) => j !== i) })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div>
            <button className="btn sm" onClick={() => onChange({ ...q, pairs: [...(q.pairs ?? []), ['', '']] })}>
              Add pair
            </button>
          </div>
        </div>
      )}
      <RefField label="Scripture this question is based on" value={q.refs} onChange={(v) => onChange({ ...q, refs: v })} />
      <label className="stack" style={{ gap: 4 }}>
        <span>{q.type === 'short' || q.type === 'reflection' ? 'Things to consider (shown after submitting; not a model answer)' : 'Explanation (shown with the answer)'}</span>
        <textarea rows={2} value={q.explanation} onChange={(e) => onChange({ ...q, explanation: e.target.value })} />
      </label>
      {problem && <span className="notice warn small">To fix before publishing: {problem}</span>}
    </fieldset>
  )
}

/* ---------------- from Study This Passage ---------------- */

/** "Create lesson" from a study: choose a course (or start one), and the study becomes a draft lesson. */
export function CreateLessonDialog({ open, onClose, study }: { open: boolean; onClose: () => void; study: import('../db/db').Study }) {
  const nav = useNavigate()
  const courses = useLiveQuery(() => db.courses.filter((c) => c.role === 'instructor' && c.status !== 'archived').toArray(), []) ?? []
  const [courseId, setCourseId] = useState('__new')
  const go = async () => {
    const { createCourse, lessonFromStudy } = await import('../lib/courses')
    const course = courseId === '__new' ? await createCourse({ title: `${study.title} (course)` }) : (await db.courses.get(courseId))!
    const lesson = lessonFromStudy(study, course.id)
    await db.transaction('rw', db.courses, db.lessons, async () => {
      await db.lessons.add(lesson)
      const cur = (await db.courses.get(course.id))!
      const units = cur.units.length ? cur.units : [{ id: uid(), title: 'Unit 1', lessonIds: [] }]
      units[units.length - 1] = { ...units[units.length - 1], lessonIds: [...units[units.length - 1].lessonIds, lesson.id] }
      await db.courses.put({ ...cur, units, updatedAt: Date.now() })
    })
    onClose()
    toast('Draft lesson created from your study')
    nav(`/learn/courses/${course.id}/lessons/${lesson.id}/edit`)
  }
  return (
    <Dialog open={open} onClose={onClose} title="Create a lesson from this study">
      <div className="stack">
        <p style={{ margin: 0 }}>Your study is copied into a new draft lesson. The study itself is not changed. Your notes become the lesson text; Scripture and sourced excerpts keep their citations.</p>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Add it to</strong>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="__new">A new course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button className="btn primary" onClick={go}>
            Create lesson
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}
