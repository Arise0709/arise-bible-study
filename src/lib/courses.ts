/**
 * Courses, lessons, quizzes, progress, certificates, and course files.
 *
 * Everything is stored in this browser. A published course reaches students as a course file they import;
 * nothing is uploaded anywhere. Drafts never leave the device: course files are made only from a published
 * snapshot, and only lessons marked published are in it.
 */
import { db, uid, WORKSHEET_SECTIONS, type Attempt, type Block, type Course, type CourseVersion, type Enrollment, type Lesson, type LessonBlock, type Question, type Quiz, type Study } from '../db/db'
import { isValidRef, parseOsis, parseRef, toOsis } from './refs'

export const TRACKS = ['Foundations', 'Spiritual Maturity', 'Leadership and Ministry', 'Discipleship', 'Other'] as const
export const TRACK_TOPICS: Record<string, string[]> = {
  Foundations: ['Salvation', 'Christian Identity', 'Understanding Scripture', 'Prayer', 'Discipleship', 'The Church', 'Spiritual Growth'],
  'Spiritual Maturity': ['Biblical Doctrine', 'Spiritual Disciplines', 'Evangelism', 'Stewardship', 'Spiritual Gifts', 'Christian Character', 'Spiritual Warfare'],
  'Leadership and Ministry': ['Biblical Leadership', 'Servanthood', 'Character and Integrity', 'Teaching Scripture', 'Ministry Responsibility', 'Developing Others', 'Church Leadership'],
}

/* ---------------- creating and editing ---------------- */

export function newCourse(partial: Partial<Course> = {}): Course {
  const now = Date.now()
  return {
    id: uid(),
    title: 'Untitled course',
    description: '',
    objectives: [],
    category: 'Foundations',
    level: 'beginner',
    duration: '',
    perspective: '',
    author: '',
    organization: '',
    units: [{ id: uid(), title: 'Unit 1', lessonIds: [] }],
    completion: { lessons: true, quizzes: true, attendance: 0 },
    certificate: { enabled: false, instructor: '' },
    status: 'draft',
    version: 0,
    origin: 'authored',
    role: 'instructor',
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export function newLesson(courseId: string, partial: Partial<Lesson> = {}): Lesson {
  const now = Date.now()
  return {
    id: uid(),
    courseId,
    title: 'Untitled lesson',
    intro: '',
    objectives: [],
    primaryRef: '',
    supportingRefs: [],
    blocks: [],
    context: '',
    discussion: [],
    reflection: [],
    assignments: [],
    summary: '',
    instructorNotes: '',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...partial,
  }
}

export function newQuiz(): Quiz {
  return { id: uid(), title: 'Lesson quiz', questions: [], passScore: 70, attempts: 0, shuffle: false, timeLimit: 0, required: true, showAnswers: 'after-submit', allowRetake: true }
}

export async function createCourse(partial: Partial<Course> = {}) {
  const c = newCourse(partial)
  await db.courses.add(c)
  return c
}

export async function addLesson(course: Course, unitId: string, partial: Partial<Lesson> = {}) {
  const lesson = newLesson(course.id, partial)
  await db.transaction('rw', db.courses, db.lessons, async () => {
    await db.lessons.add(lesson)
    const cur = (await db.courses.get(course.id))!
    await db.courses.put({ ...cur, units: cur.units.map((u) => (u.id === unitId ? { ...u, lessonIds: [...u.lessonIds, lesson.id] } : u)), updatedAt: Date.now() })
  })
  return lesson
}

export async function deleteLesson(course: Course, lessonId: string) {
  await db.transaction('rw', db.courses, db.lessons, async () => {
    await db.lessons.delete(lessonId)
    const cur = (await db.courses.get(course.id))!
    await db.courses.put({ ...cur, units: cur.units.map((u) => ({ ...u, lessonIds: u.lessonIds.filter((x) => x !== lessonId) })), updatedAt: Date.now() })
  })
}

/** Lessons in course order (unit by unit). */
export async function courseLessons(course: Course): Promise<Lesson[]> {
  const all = await db.lessons.where('courseId').equals(course.id).toArray()
  const byId = new Map(all.map((l) => [l.id, l]))
  return course.units.flatMap((u) => u.lessonIds.map((id) => byId.get(id)).filter((l): l is Lesson => !!l))
}

/* ---------------- publishing ---------------- */

/** Reasons a course can't be published yet; empty when it can. */
export function publishProblems(course: Course, lessons: Lesson[]): string[] {
  const out: string[] = []
  const pub = lessons.filter((l) => l.status === 'published')
  if (!course.title.trim() || course.title === 'Untitled course') out.push('Give the course a title.')
  if (!pub.length) out.push('Publish at least one lesson (lessons start as drafts).')
  for (const l of pub) {
    if (l.blocks.some((b) => b.kind === 'ai' && !b.reviewed)) out.push(`"${l.title}" has an AI draft that has not been reviewed.`)
    if (l.quiz?.questions.some((q) => q.aiDraft && !q.reviewed)) out.push(`"${l.title}" has AI-drafted quiz questions that have not been reviewed.`)
    for (const q of l.quiz?.questions ?? []) {
      const p = questionProblem(q)
      if (p) out.push(`"${l.title}": ${p}`)
    }
    for (const r of [l.primaryRef, ...l.supportingRefs].filter(Boolean)) if (!parseOsis(r) || !isValidRef(parseOsis(r)!)) out.push(`"${l.title}" refers to a passage that does not exist: ${r}`)
  }
  if (course.certificate.enabled && !course.organization.trim() && !course.certificate.instructor.trim()) out.push('Certificates need an organization or instructor name.')
  return out
}

export function questionProblem(q: Question): string | undefined {
  if (!q.prompt.trim()) return 'a quiz question has no wording.'
  switch (q.type) {
    case 'choice':
      if ((q.options ?? []).filter((o) => o.trim()).length < 2) return `"${q.prompt}" needs at least two choices.`
      if (typeof q.answer !== 'number' || !q.options?.[q.answer]?.trim()) return `"${q.prompt}" has no correct choice selected.`
      return
    case 'truefalse':
      if (typeof q.answer !== 'boolean') return `"${q.prompt}" needs True or False selected as the answer.`
      return
    case 'blank':
      if (!Array.isArray(q.answer) || !q.answer.some((a) => a.trim())) return `"${q.prompt}" needs at least one accepted answer.`
      return
    case 'reference': {
      const r = typeof q.answer === 'string' ? parseOsis(q.answer) : undefined
      if (!r || !isValidRef(r)) return `"${q.prompt}" needs a real Scripture reference as its answer.`
      return
    }
    case 'matching':
      if ((q.pairs ?? []).filter(([a, b]) => a.trim() && b.trim()).length < 2) return `"${q.prompt}" needs at least two pairs.`
      return
  }
}

/** Publish: freeze a snapshot of the course and its published lessons. Earlier snapshots stay as version history. */
export async function publishCourse(course: Course): Promise<CourseVersion> {
  const lessons = await courseLessons(course)
  const problems = publishProblems(course, lessons)
  if (problems.length) throw new Error(problems.join(' '))
  const version = course.version + 1
  const published = { ...course, status: 'published' as const, version, updatedAt: Date.now() }
  const snap: CourseVersion = { id: uid(), courseId: course.id, version, publishedAt: Date.now(), course: published, lessons: lessons.filter((l) => l.status === 'published') }
  await db.transaction('rw', db.courses, db.courseVersions, async () => {
    await db.courses.put(published)
    await db.courseVersions.add(snap)
  })
  return snap
}

export async function setCourseStatus(course: Course, status: Course['status']) {
  await db.courses.update(course.id, { status, updatedAt: Date.now() })
}

/** Copy a course (or one of its published versions) as a new draft. */
export async function duplicateCourse(course: Course, lessons: Lesson[], title = `${course.title} (copy)`): Promise<Course> {
  const ids = new Map(lessons.map((l) => [l.id, uid()]))
  const now = Date.now()
  const copy: Course = {
    ...structuredClone(course),
    id: uid(),
    title,
    status: 'draft',
    version: 0,
    origin: 'authored',
    role: 'instructor',
    units: course.units.map((u) => ({ id: uid(), title: u.title, lessonIds: u.lessonIds.filter((x) => ids.has(x)).map((x) => ids.get(x)!) })),
    createdAt: now,
    updatedAt: now,
  }
  const copies = lessons.map((l) => ({ ...structuredClone(l), id: ids.get(l.id)!, courseId: copy.id, status: 'draft' as const, createdAt: now, updatedAt: now }))
  await db.transaction('rw', db.courses, db.lessons, async () => {
    await db.courses.add(copy)
    await db.lessons.bulkAdd(copies)
  })
  return copy
}

/* ---------------- from a study ---------------- */

/** Turn a saved study into a draft lesson. The study is not changed; the reader's notes become the lesson author's text. */
export function lessonFromStudy(study: Study, courseId: string): Lesson {
  const blocks: LessonBlock[] = []
  for (const sec of WORKSHEET_SECTIONS) {
    const list = study.sections[sec.key]
    if (!list.length) continue
    blocks.push({ id: uid(), kind: 'text', text: sec.title, heading: true })
    for (const b of list) blocks.push(b.kind === 'note' ? { id: uid(), kind: 'text', text: b.text } : { ...structuredClone(b), id: uid() })
  }
  return newLesson(courseId, { title: study.title, primaryRef: study.passage, blocks })
}

/* ---------------- grading ---------------- */

export const isAutoGraded = (q: Question) => q.type !== 'short' && q.type !== 'reflection'

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export interface QuestionResult {
  id: string
  auto: boolean
  credit: number // 0 to 1 for auto-graded questions
  answered: boolean
}

export function gradeQuestion(q: Question, given: unknown): QuestionResult {
  const auto = isAutoGraded(q)
  const answered = given !== undefined && given !== null && given !== '' && !(Array.isArray(given) && !given.length)
  let credit = 0
  if (auto && answered) {
    switch (q.type) {
      case 'choice':
        credit = given === q.answer ? 1 : 0
        break
      case 'truefalse':
        credit = given === q.answer ? 1 : 0
        break
      case 'blank':
        credit = (q.answer as string[]).some((a) => norm(a) === norm(String(given))) ? 1 : 0
        break
      case 'reference': {
        const r = parseRef(String(given))
        const want = parseOsis(String(q.answer))
        credit = r && want && toOsis(r) === toOsis(want) ? 1 : 0
        break
      }
      case 'matching': {
        const pairs = q.pairs ?? []
        const g = given as Record<string, string>
        const right = pairs.filter(([a, b], i) => g?.[String(i)] === b || g?.[a] === b).length
        credit = pairs.length ? right / pairs.length : 0
        break
      }
    }
  }
  return { id: q.id, auto, credit, answered }
}

export interface QuizResult {
  score: number // percent of auto-graded points; 100 when nothing is auto-graded
  passed: boolean
  results: QuestionResult[]
  /** Scripture to revisit: references of questions not fully correct */
  review: string[]
  written: number
}

export function gradeQuiz(quiz: Quiz, answers: Record<string, unknown>): QuizResult {
  const results = quiz.questions.map((q) => gradeQuestion(q, answers[q.id]))
  const auto = results.filter((r) => r.auto)
  const score = auto.length ? Math.round((auto.reduce((a, r) => a + r.credit, 0) / auto.length) * 100) : 100
  const review = [...new Set(quiz.questions.filter((_, i) => results[i].auto && results[i].credit < 1).flatMap((q) => q.refs))]
  return { score, passed: score >= quiz.passScore, results, review, written: results.filter((r) => !r.auto).length }
}

/** How many more tries are allowed (Infinity when unlimited). */
export function attemptsLeft(quiz: Quiz, attempts: Attempt[]): number {
  const used = attempts.filter((a) => a.quizId === quiz.id && a.submittedAt).length
  if (used > 0 && !quiz.allowRetake) return 0
  return quiz.attempts > 0 ? Math.max(0, quiz.attempts - used) : Infinity
}

/** Seeded order so a student sees the same shuffled order through one attempt. */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const j = Math.abs(h) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ---------------- progress and certificates ---------------- */

export const isReleased = (l: Lesson, on = new Date()) => !l.releaseOn || l.releaseOn <= `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(on.getDate()).padStart(2, '0')}`

export interface CourseProgress {
  lessonsDone: number
  lessonsTotal: number
  quizzesPassed: number
  quizzesRequired: number
  percent: number
  complete: boolean
  missing: string[]
  /** completion needs attendance taken by the instructor, which this device can't see */
  needsInstructor: boolean
}

export function courseProgress(course: Course, lessons: Lesson[], enrollment: Enrollment | undefined, attempts: Attempt[]): CourseProgress {
  const visible = lessons.filter((l) => l.status === 'published')
  const done = visible.filter((l) => enrollment?.lessonsDone[l.id])
  const required = visible.filter((l) => l.quiz && l.quiz.required && l.quiz.questions.length)
  const passed = required.filter((l) => attempts.some((a) => a.lessonId === l.id && a.quizId === l.quiz!.id && a.passed))
  const missing: string[] = []
  if (course.completion.lessons && done.length < visible.length) missing.push(`${visible.length - done.length} lesson${visible.length - done.length === 1 ? '' : 's'} to complete`)
  if (course.completion.quizzes && passed.length < required.length) missing.push(`${required.length - passed.length} required quiz${required.length - passed.length === 1 ? '' : 'zes'} to pass`)
  const needsInstructor = course.completion.attendance > 0
  const steps = (course.completion.lessons ? visible.length : 0) + (course.completion.quizzes ? required.length : 0)
  const stepsDone = (course.completion.lessons ? done.length : 0) + (course.completion.quizzes ? passed.length : 0)
  return {
    lessonsDone: done.length,
    lessonsTotal: visible.length,
    quizzesPassed: passed.length,
    quizzesRequired: required.length,
    percent: steps ? Math.round((stepsDone / steps) * 100) : 0,
    complete: visible.length > 0 && missing.length === 0 && !needsInstructor,
    missing,
    needsInstructor,
  }
}

/** A certificate is issued only when the course's own requirements are met. */
export function certificateEligible(course: Course, progress: CourseProgress, studentName: string): { ok: boolean; reason?: string } {
  if (!course.certificate.enabled) return { ok: false, reason: 'This course does not offer a certificate.' }
  if (progress.needsInstructor) return { ok: false, reason: 'This course requires attendance, which your instructor records. Your instructor issues the certificate.' }
  if (!progress.complete) return { ok: false, reason: `Not yet: ${progress.missing.join(', ')}.` }
  if (!studentName.trim()) return { ok: false, reason: 'Enter your name as it should appear on the certificate.' }
  return { ok: true }
}

export async function enroll(course: Course, studentName: string): Promise<Enrollment> {
  const existing = await db.enrollments.where('courseId').equals(course.id).first()
  if (existing) return existing
  const e: Enrollment = { id: uid(), courseId: course.id, version: course.version, studentName: studentName.trim(), enrolledAt: Date.now(), lessonsDone: {}, updatedAt: Date.now() }
  await db.enrollments.add(e)
  return e
}

export async function setLessonDone(enrollment: Enrollment, lessonId: string, done: boolean) {
  const lessonsDone = { ...enrollment.lessonsDone }
  if (done) lessonsDone[lessonId] = Date.now()
  else delete lessonsDone[lessonId]
  await db.enrollments.update(enrollment.id, { lessonsDone, lastLessonId: lessonId, updatedAt: Date.now() })
}

/* ---------------- course files ---------------- */

export const COURSE_FORMAT = 'carter-study-bible-course'
export const COURSE_FILE_VERSION = 1
const MAX_FILE = 40 * 1024 * 1024
const MAX_ATTACHMENT = 8 * 1024 * 1024
export const ATTACHMENT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'text/plain', 'image/png', 'image/jpeg', 'audio/mpeg']

export interface CourseFile {
  format: typeof COURSE_FORMAT
  version: number
  exportedAt: string
  audience: 'students' | 'instructors'
  course: Course
  lessons: Lesson[]
}

/** A course file made from a published snapshot. Student files leave out instructor notes. */
export function courseFileFrom(snap: CourseVersion, audience: CourseFile['audience']): string {
  const lessons = snap.lessons.map((l) => (audience === 'students' ? { ...l, instructorNotes: '' } : l))
  const file: CourseFile = { format: COURSE_FORMAT, version: COURSE_FILE_VERSION, exportedAt: new Date().toISOString(), audience, course: snap.course, lessons }
  return JSON.stringify(file)
}

export class CourseFileError extends Error {}

const s = (v: unknown, max = 20000) => typeof v === 'string' && v.length <= max
const sa = (v: unknown, max = 2000) => Array.isArray(v) && v.length <= 200 && v.every((x) => s(x, max))
const httpUrl = (u: unknown) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) && u.length < 2000

function validBlock(b: unknown): b is LessonBlock {
  const x = b as Record<string, unknown>
  if (!x || typeof x !== 'object' || !s(x.id, 200)) return false
  switch (x.kind) {
    case 'text':
      return s(x.text)
    case 'video':
      return httpUrl(x.url) && s(x.title, 300)
    case 'file':
      return s(x.name, 300) && ATTACHMENT_TYPES.includes(String(x.type)) && typeof x.size === 'number' && x.size <= MAX_ATTACHMENT && s(x.data, MAX_ATTACHMENT * 1.4)
    case 'scripture':
      return s(x.ref, 200) && s(x.text, 100000)
    case 'source':
      return s(x.text, 100000) && s(x.citation, 2000) && s(x.title, 500) && s(x.source, 200)
    case 'word':
      return s(x.strongs, 20) && s(x.english, 300) && s(x.ref, 200) && s(x.original, 300) && s(x.gloss, 5000) && s(x.note)
    case 'xref':
      return s(x.from, 200) && s(x.to, 200) && s(x.explanation)
    case 'note':
      return s(x.text)
    case 'ai':
      return s(x.text, 100000) && sa(x.citations, 200) && sa(x.warnings)
    default:
      return false
  }
}

function validQuestion(q: unknown): q is Question {
  const x = q as Record<string, unknown>
  return !!x && s(x.id, 200) && ['choice', 'truefalse', 'blank', 'reference', 'short', 'reflection', 'matching'].includes(String(x.type)) && s(x.prompt, 5000) && sa(x.refs, 200) && s(x.explanation, 10000) && (x.options === undefined || sa(x.options, 2000))
}

function validLesson(l: unknown, courseId: string): l is Lesson {
  const x = l as Record<string, unknown>
  if (!x || x.courseId !== courseId || !s(x.id, 200) || !s(x.title, 500)) return false
  if (!Array.isArray(x.blocks) || x.blocks.length > 500 || !x.blocks.every(validBlock)) return false
  for (const k of ['intro', 'context', 'summary', 'instructorNotes', 'primaryRef']) if (!s(x[k], 100000)) return false
  for (const k of ['objectives', 'supportingRefs', 'discussion', 'reflection', 'assignments']) if (!sa(x[k], 5000)) return false
  if (x.quiz !== undefined) {
    const qz = x.quiz as Record<string, unknown>
    if (!qz || !s(qz.id, 200) || !Array.isArray(qz.questions) || qz.questions.length > 200 || !qz.questions.every(validQuestion)) return false
  }
  return true
}

export interface CourseImport {
  file: CourseFile
  warnings: string[]
}

/** Check a course file without changing anything. Text is shown as text (never as HTML), links only as http(s). */
export function parseCourseFile(text: string): CourseImport {
  if (text.length > MAX_FILE) throw new CourseFileError('This course file is too large.')
  let f: Record<string, unknown>
  try {
    f = JSON.parse(text)
  } catch {
    throw new CourseFileError('That file is not a course file (it is not JSON).')
  }
  if (f?.format !== COURSE_FORMAT) throw new CourseFileError('That file is not a Carter Study Bible course file.')
  if (typeof f.version !== 'number' || f.version > COURSE_FILE_VERSION) throw new CourseFileError('This course file was made by a newer version of the app. Update the app, then try again.')
  const c = f.course as Record<string, unknown>
  if (!c || !s(c.id, 200) || !s(c.title, 500) || !Array.isArray(c.units) || !c.units.every((u) => u && s(u.id, 200) && s(u.title, 500) && sa(u.lessonIds, 200))) throw new CourseFileError('The course details in this file are damaged.')
  if (!Array.isArray(f.lessons)) throw new CourseFileError('The lessons in this file are damaged.')
  const warnings: string[] = []
  const lessons = (f.lessons as unknown[]).filter((l) => validLesson(l, c.id as string)) as Lesson[]
  if (lessons.length < (f.lessons as unknown[]).length) warnings.push(`${(f.lessons as unknown[]).length - lessons.length} damaged lesson(s) will be left out.`)
  for (const l of lessons) {
    for (const r of [l.primaryRef, ...l.supportingRefs].filter(Boolean)) if (!parseOsis(r) || !isValidRef(parseOsis(r)!)) warnings.push(`"${l.title}" refers to a passage that does not exist (${r}).`)
    for (const b of l.blocks) if (b.kind === 'ai' && !b.reviewed) warnings.push(`"${l.title}" contains an AI draft the author did not mark as reviewed.`)
  }
  const ids = new Set(lessons.map((l) => l.id))
  const course: Course = {
    ...newCourse(),
    ...(c as unknown as Course),
    units: (c.units as Course['units']).map((u) => ({ ...u, lessonIds: u.lessonIds.filter((x) => ids.has(x)) })),
  }
  return { file: { format: COURSE_FORMAT, version: f.version as number, exportedAt: String(f.exportedAt ?? ''), audience: f.audience === 'instructors' ? 'instructors' : 'students', course, lessons }, warnings }
}

/**
 * Scripture quoted in a course file is compared with this app's own text. A quotation that differs is
 * reported, never silently changed (the author may have used another translation or edited it).
 */
export async function checkScriptureQuotes(lessons: Lesson[], getText: (osis: string, tr: string) => Promise<string | undefined>): Promise<string[]> {
  const out: string[] = []
  const clean = (t: string) => t.replace(/\s+/g, ' ').replace(/^\d+\s/, '').trim()
  for (const l of lessons)
    for (const b of l.blocks) {
      if (b.kind !== 'scripture') continue
      const ours = await getText(b.ref, b.tr ?? 'KJV').catch(() => undefined)
      if (ours === undefined) out.push(`"${l.title}": could not check the quotation of ${b.ref}.`)
      else if (clean(ours).replace(/\d+\s/g, '') !== clean(b.text).replace(/\d+\s/g, '')) out.push(`"${l.title}": the quotation of ${b.ref} does not match the ${b.tr ?? 'KJV'} text in this app.`)
    }
  return out
}

/**
 * Save an imported course. To take: stored as a student copy (an existing copy of the same course is
 * updated and its enrollment kept). To teach: stored as a new draft copy with new ids.
 */
export async function importCourse(imp: CourseImport, role: 'student' | 'instructor'): Promise<Course> {
  const { course, lessons } = imp.file
  if (role === 'instructor') return duplicateCourse({ ...course, origin: 'imported' }, lessons, course.title)
  const existing = await db.courses.get(course.id)
  if (existing && existing.role === 'instructor') throw new CourseFileError('This course was made on this device. Open it from "Courses I teach" and use Preview instead.')
  if (existing && existing.version > course.version) throw new CourseFileError(`You already have a newer version of this course (version ${existing.version}).`)
  const saved: Course = { ...course, role: 'student', origin: 'imported', status: 'published', updatedAt: Date.now() }
  await db.transaction('rw', db.courses, db.lessons, async () => {
    await db.lessons.where('courseId').equals(course.id).delete()
    await db.lessons.bulkPut(lessons.map((l) => ({ ...l, status: 'published' as const })))
    await db.courses.put(saved)
  })
  return saved
}

/** Remove a course and everything recorded for it on this device. */
export async function deleteCourse(courseId: string) {
  await db.transaction('rw', [db.courses, db.lessons, db.courseVersions, db.enrollments, db.attempts, db.submissions, db.attendance], async () => {
    await db.lessons.where('courseId').equals(courseId).delete()
    await db.courseVersions.where('courseId').equals(courseId).delete()
    await db.enrollments.where('courseId').equals(courseId).delete()
    await db.attempts.where('courseId').equals(courseId).delete()
    await db.submissions.where('courseId').equals(courseId).delete()
    await db.attendance.where('courseId').equals(courseId).delete()
    await db.courses.delete(courseId)
  })
}

export type { Block }
