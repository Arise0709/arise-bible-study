/**
 * Church courses (Release 6.2, Stage C): the workspace course library, editing, publishing, enrollment, progress,
 * written answers, quizzes (graded on the server), sessions and attendance. The database decides every permission;
 * this module only calls it. Personal courses on this device are never changed: copying one into a workspace is a
 * separate, explicit step that makes a new workspace course.
 */
import type { Course, Lesson } from '../../db/types'
import { newLesson } from '../courses'
import type { QuestionResult } from '../grading'
import type { Quiz } from '../../db/types'
import { cloud } from './manager'
import { OrgError } from './orgs'

export interface CourseContent {
  course: Course
  lessons: Lesson[]
}
export interface OrgCourse {
  id: string
  org_id: string
  title: string
  description: string
  status: 'draft' | 'review' | 'published' | 'archived'
  published_version: number
  catalog: boolean
  enroll_deadline: string | null
  source_course_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}
export interface OrgEnrollment {
  id: string
  org_id: string
  course_id: string
  user_id: string | null
  version: number
  status: 'active' | 'withdrawn' | 'completed'
  enrolled_at: string
  deadline: string | null
  last_lesson_id: string | null
  withdrawn_at: string | null
  completed_at: string | null
  certificate_at: string | null
}
export interface OrgAttempt {
  id: string
  enrollment_id: string
  lesson_id: string
  quiz_id: string
  version: number
  answers: Record<string, unknown>
  score: number
  passed: boolean
  results: QuestionResult[]
  submitted_at: string
  manual: Record<string, number>
  feedback: string
  reviewed_at: string | null
}
export interface WrittenAnswer {
  id: string
  course_id: string
  enrollment_id: string
  lesson_id: string
  kind: 'reflection' | 'assignment'
  prompt: string
  body: string
  submitted_at: string
  updated_at: string
  grade: 'complete' | 'needs_revision' | 'incomplete' | null
  points: number | null
  feedback: string
  graded_at: string | null
}
export interface OrgSession {
  id: string
  course_id: string
  held_on: string
  title: string
}
export type AttendanceStatus = 'present' | 'absent' | 'excused' | 'late'
export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', excused: 'Excused', late: 'Late' }
export const GRADE_LABEL = { complete: 'Complete', needs_revision: 'Needs revision', incomplete: 'Incomplete' } as const
export const STATUS_LABEL = { draft: 'Draft', review: 'Waiting for review', published: 'Published', archived: 'Archived' } as const

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) {
    const m = r.error.message || ''
    if (/Failed to fetch|NetworkError|fetch failed/i.test(m)) throw new OrgError('Could not reach the server. Check your connection and try again.')
    if (/permission denied|row-level security/i.test(m)) throw new OrgError('You do not have permission to do that.')
    throw new OrgError(m.length < 300 ? m : 'Something went wrong. Try again.')
  }
  return r.data as T
}
const myId = async () => (await cloud().auth.getSession()).data.session?.user.id ?? ''

/* ---------------- library ---------------- */

export async function orgCourses(orgId: string): Promise<OrgCourse[]> {
  return must(await cloud().from('org_courses').select('*').eq('org_id', orgId).order('title'))
}
export async function orgCourse(id: string): Promise<OrgCourse | null> {
  return (must(await cloud().from('org_courses').select('*').eq('id', id).limit(1)) as OrgCourse[])[0] ?? null
}
/** Course ids the caller teaches (assigned as instructor). */
export async function myTeaching(orgId: string): Promise<Set<string>> {
  const rows = must(await cloud().from('org_course_instructors').select('course_id').eq('org_id', orgId).eq('user_id', await myId())) as { course_id: string }[]
  return new Set(rows.map((r) => r.course_id))
}
export async function courseInstructors(courseId: string): Promise<string[]> {
  return (must(await cloud().from('org_course_instructors').select('user_id').eq('course_id', courseId)) as { user_id: string }[]).map((r) => r.user_id)
}
export async function myOrgEnrollments(orgId: string): Promise<OrgEnrollment[]> {
  return must(await cloud().from('org_enrollments').select('*').eq('org_id', orgId).eq('user_id', await myId()))
}

/** Copies a course into the workspace as a new draft. The personal course on this device is not changed or linked. */
export async function copyIntoWorkspace(orgId: string, content: CourseContent, sourceId?: string): Promise<string> {
  const clean: CourseContent = {
    course: { ...content.course, status: 'draft', version: 0, role: 'instructor', origin: 'authored', ownerId: undefined },
    lessons: content.lessons.map((l) => ({ ...l })),
  }
  return must(await cloud().rpc('create_org_course', { o: orgId, content: clean, source: sourceId ?? null })) as string
}

export async function setCourseOptions(courseId: string, p: { catalog?: boolean; enroll_deadline?: string; status?: OrgCourse['status'] }) {
  must(await cloud().rpc('set_org_course_options', { cid: courseId, p }))
}
export async function publishOrgCourse(courseId: string, notes = ''): Promise<number> {
  return must(await cloud().rpc('publish_org_course', { cid: courseId, notes })) as number
}
export async function assignInstructor(courseId: string, userId: string, assign: boolean) {
  must(await cloud().rpc('assign_instructor', { cid: courseId, u: userId, assign }))
}
export async function courseVersions(courseId: string): Promise<{ version: number; published_at: string; notes: string; published_by: string | null }[]> {
  return must(await cloud().from('org_course_versions').select('version, published_at, notes, published_by').eq('course_id', courseId).order('version', { ascending: false }))
}
/** The student copy of a version (no answers or instructor notes). */
export async function release(courseId: string, version: number): Promise<CourseContent | null> {
  const rows = must(await cloud().from('org_course_releases').select('content').eq('course_id', courseId).eq('version', version).limit(1)) as { content: CourseContent }[]
  return rows[0]?.content ?? null
}
/** The full published version (staff only, enforced by the database). */
export async function fullVersion(courseId: string, version: number): Promise<CourseContent | null> {
  const rows = must(await cloud().from('org_course_versions').select('content').eq('course_id', courseId).eq('version', version).limit(1)) as { content: CourseContent }[]
  return rows[0]?.content ?? null
}

/* ---------------- editing the working copy ---------------- */

type Listener = () => void
export type DraftState = 'saved' | 'saving' | 'conflict' | 'error'

/**
 * The workspace course being edited, shared by the course and lesson editors. Edits apply at once on screen and
 * are saved to the workspace a moment later. The database accepts a save only if nobody else saved since, so two
 * editors never overwrite each other silently.
 */
export class OrgCourseDraft {
  content: CourseContent
  rev: number
  state: DraftState = 'saved'
  error = ''
  private listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private dirty = false
  readonly courseId: string

  constructor(courseId: string, content: CourseContent, rev: number) {
    this.courseId = courseId
    this.content = content
    this.rev = rev
  }
  subscribe(f: Listener) {
    this.listeners.add(f)
    return () => void this.listeners.delete(f)
  }
  private emit() {
    this.content = { ...this.content }
    this.listeners.forEach((f) => f())
  }
  get course() {
    return this.content.course
  }
  lessons() {
    return this.content.lessons.filter((l) => l.courseId === this.content.course.id)
  }
  lesson(id: string) {
    return this.content.lessons.find((l) => l.id === id)
  }
  saveCourse = async (c: Course) => {
    this.content.course = c
    this.schedule()
  }
  saveLesson = async (l: Lesson) => {
    this.content.lessons = this.content.lessons.some((x) => x.id === l.id) ? this.content.lessons.map((x) => (x.id === l.id ? l : x)) : [...this.content.lessons, l]
    this.schedule()
  }
  async addLesson(unitId: string): Promise<Lesson> {
    const l = newLesson(this.content.course.id)
    this.content.lessons = [...this.content.lessons, l]
    this.content.course = { ...this.content.course, units: this.content.course.units.map((u) => (u.id === unitId ? { ...u, lessonIds: [...u.lessonIds, l.id] } : u)), updatedAt: Date.now() }
    this.schedule()
    return l
  }
  async deleteLesson(id: string) {
    this.content.lessons = this.content.lessons.filter((l) => l.id !== id)
    this.content.course = { ...this.content.course, units: this.content.course.units.map((u) => ({ ...u, lessonIds: u.lessonIds.filter((x) => x !== id) })), updatedAt: Date.now() }
    this.schedule()
  }
  private schedule() {
    this.dirty = true
    this.state = 'saving'
    this.emit()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 700)
  }
  /** Saves any waiting edit now (before publishing, leaving, or reading the stored copy). */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.chain = this.chain.then(async () => {
      if (!this.dirty || this.state === 'conflict') return
      this.dirty = false
      const r = await cloud().rpc('save_org_course_draft', { cid: this.courseId, base_rev: this.rev, content: this.content })
      if (r.error) {
        this.dirty = true
        this.state = /saved this course a moment ago/.test(r.error.message) ? 'conflict' : 'error'
        this.error = this.state === 'conflict' ? 'Someone else saved this course a moment ago. Reload to see their changes (copy anything you typed first).' : r.error.message
      } else {
        this.rev = r.data as number
        this.state = this.dirty ? 'saving' : 'saved'
        this.error = ''
      }
      this.emit()
    })
    return this.chain.then(() => {
      if (this.state === 'error' || this.state === 'conflict') throw new OrgError(this.error)
    })
  }
}

const drafts = new Map<string, OrgCourseDraft>()
/** Loads (or reuses) the working copy of a workspace course; staff only. */
export async function openDraft(courseId: string, fresh = false): Promise<OrgCourseDraft> {
  const have = drafts.get(courseId)
  if (have && !fresh && have.state !== 'conflict') return have
  if (have && fresh) await have.flush().catch(() => {}) // a preview shows the latest edits
  const rows = must(await cloud().from('org_course_drafts').select('content, rev').eq('course_id', courseId).limit(1)) as { content: CourseContent; rev: number }[]
  if (!rows[0]) throw new OrgError('Only this course’s instructors can edit it.')
  const d = new OrgCourseDraft(courseId, rows[0].content, rows[0].rev)
  drafts.set(courseId, d)
  return d
}

/* ---------------- enrollment and progress ---------------- */

export async function enrollSelf(courseId: string): Promise<string> {
  return must(await cloud().rpc('enroll_self', { cid: courseId })) as string
}
export async function enrollMembers(courseId: string, users: string[], deadline?: string): Promise<number> {
  return must(await cloud().rpc('enroll_members', { cid: courseId, users, deadline: deadline || null })) as number
}
export async function withdraw(enrollmentId: string) {
  must(await cloud().rpc('withdraw_enrollment', { eid: enrollmentId }))
}
export async function moveToLatest(enrollmentId: string): Promise<number> {
  return must(await cloud().rpc('update_enrollment_version', { eid: enrollmentId })) as number
}
export async function courseEnrollments(courseId: string): Promise<OrgEnrollment[]> {
  return must(await cloud().from('org_enrollments').select('*').eq('course_id', courseId).order('enrolled_at'))
}
export async function myEnrollment(courseId: string): Promise<OrgEnrollment | null> {
  return (must(await cloud().from('org_enrollments').select('*').eq('course_id', courseId).eq('user_id', await myId()).limit(1)) as OrgEnrollment[])[0] ?? null
}
export async function progress(enrollmentIds: string[]): Promise<{ enrollment_id: string; lesson_id: string; done_at: string }[]> {
  if (!enrollmentIds.length) return []
  return must(await cloud().from('org_lesson_progress').select('enrollment_id, lesson_id, done_at').in('enrollment_id', enrollmentIds))
}
export async function markLesson(enrollmentId: string, lessonId: string, done: boolean): Promise<boolean> {
  return must(await cloud().rpc('mark_lesson', { eid: enrollmentId, lesson: lessonId, done })) as boolean
}
export async function setLastLesson(enrollmentId: string, lessonId: string) {
  await cloud().rpc('set_last_lesson', { eid: enrollmentId, lesson: lessonId })
}
export async function claimCertificate(enrollmentId: string): Promise<string> {
  return must(await cloud().rpc('claim_certificate', { eid: enrollmentId })) as string
}

/* ---------------- written answers ---------------- */

export async function writtenAnswers(filter: { enrollment?: string; course?: string }): Promise<WrittenAnswer[]> {
  let q = cloud().from('org_written_answers').select('*').order('submitted_at', { ascending: false })
  if (filter.enrollment) q = q.eq('enrollment_id', filter.enrollment)
  if (filter.course) q = q.eq('course_id', filter.course)
  return must(await q)
}
export async function saveWritten(enrollmentId: string, lessonId: string, kind: 'reflection' | 'assignment', prompt: string, body: string): Promise<string> {
  return must(await cloud().rpc('save_written_answer', { eid: enrollmentId, lesson: lessonId, kind, prompt, body })) as string
}
export async function gradeWritten(id: string, grade: WrittenAnswer['grade'], points: number | null, feedback: string) {
  must(await cloud().rpc('grade_written_answer', { aid: id, grade, points, feedback }))
}

/* ---------------- quizzes ---------------- */

export interface QuizSubmitResult {
  id: string
  submitted_at: string
  score: number
  passed: boolean
  results: QuestionResult[]
  review: string[]
  written: number
  reveal: boolean
  quiz?: Quiz
}
/** Sends answers to the server, which grades them with the app's grading code and records the attempt. */
export async function submitQuiz(courseId: string, lessonId: string, answers: Record<string, unknown>): Promise<QuizSubmitResult> {
  const token = (await cloud().auth.getSession()).data.session?.access_token
  if (!token) throw new OrgError('Sign in first.')
  let r: Response
  try {
    r = await fetch('/api/org-quiz', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ course: courseId, lesson: lessonId, answers }) })
  } catch {
    throw new OrgError('Could not reach the server. Your answers are still on screen; try again.')
  }
  const j = (await r.json().catch(() => ({}))) as QuizSubmitResult & { error?: string }
  if (!r.ok) throw new OrgError(j.error ?? `The quiz could not be submitted (code ${r.status}).`)
  return j
}
export async function attempts(filter: { enrollment?: string; course?: string }): Promise<OrgAttempt[]> {
  let q = cloud().from('org_quiz_attempts').select('*').order('submitted_at', { ascending: false })
  if (filter.enrollment) q = q.eq('enrollment_id', filter.enrollment)
  if (filter.course) q = q.eq('course_id', filter.course)
  return must(await q)
}
export async function reviewAttempt(id: string, manual: Record<string, number>, feedback: string) {
  must(await cloud().rpc('review_quiz_attempt', { aid: id, manual, feedback }))
}

/* ---------------- sessions and attendance ---------------- */

export async function sessions(courseId: string): Promise<OrgSession[]> {
  return must(await cloud().from('org_sessions').select('id, course_id, held_on, title').eq('course_id', courseId).order('held_on'))
}
export async function addSession(courseId: string, heldOn: string, title: string): Promise<string> {
  return must(await cloud().rpc('create_session', { cid: courseId, held_on: heldOn, title })) as string
}
export async function deleteSession(id: string) {
  must(await cloud().rpc('delete_session', { sid: id }))
}
export async function attendance(sessionIds: string[]): Promise<{ session_id: string; enrollment_id: string; status: AttendanceStatus }[]> {
  if (!sessionIds.length) return []
  return must(await cloud().from('org_attendance').select('session_id, enrollment_id, status').in('session_id', sessionIds))
}
export async function recordAttendance(sessionId: string, enrollmentId: string, status: AttendanceStatus | null) {
  must(await cloud().rpc('record_attendance', { sid: sessionId, eid: enrollmentId, status }))
}

/** CSV with every cell quoted (and formula-looking cells neutralized for spreadsheet safety). */
export function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return `"${s.replace(/"/g, '""')}"`
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')
}
