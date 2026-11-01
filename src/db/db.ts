import Dexie, { type EntityTable } from 'dexie'

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

/* ---------- Block model shared by studies and sermons ----------
 * Kinds keep Scripture, sourced material and the reader's own words structurally separate.
 */
export type Block =
  | { id: string; kind: 'scripture'; ref: string; text: string; tr?: string } // exact text in translation tr (KJV when absent), ref is OSIS
  | { id: string; kind: 'source'; source: string; title: string; text: string; citation: string } // quoted reference work
  | { id: string; kind: 'word'; strongs: string; english: string; ref: string; original: string; gloss: string; note: string }
  | { id: string; kind: 'xref'; from: string; to: string; explanation: string }
  | { id: string; kind: 'note'; text: string; uncertain?: boolean } // the reader's own words
  | { id: string; kind: 'ai'; text: string; citations: string[]; warnings: string[]; createdAt: number; sources?: AiSource[]; reviewed?: boolean } // labeled AI draft; in lessons it must be reviewed before publishing

/** A study resource an AI draft relied on, checked to be one the app gave it. */
export interface AiSource {
  id: string // e.g. COMM:JFB:Rom.8.28-28 or LEX:G4903
  label: string
  kind: 'comm' | 'lex'
  work?: string
  book: string
  chapter: number
  verse: number
  index?: number // position of the word in the Hebrew/Greek verse
  strongs?: string
}
export type BlockKind = Block['kind']

export interface Highlight {
  id: string
  key: string // OSIS verse id, e.g. John.3.16
  book: string
  color: string
  createdAt: number
}

export interface Bookmark {
  id: string
  key: string
  book: string
  label: string
  createdAt: number
}

export interface VerseNote {
  id: string
  ref: string // OSIS, verse or range: John.3.16 or John.3.16-John.3.18
  book: string
  startKey: number // numeric sortable key for lookups
  endKey: number
  text: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface DictEntry {
  id: string
  term: string
  definition: string // the reader's own words
  strongs: string[]
  refs: string[] // OSIS
  examples: string
  notes: string
  tags: string[]
  sources: string // where the reader got supporting information
  createdAt: number
  updatedAt: number
}

export const WORKSHEET_SECTIONS = [
  { key: 'context', title: 'Context', hint: 'Surrounding argument, literary genre, audience, historical background.' },
  { key: 'observation', title: 'Observation', hint: 'Repeated words, commands, promises, contrasts, questions, connections.' },
  { key: 'wordStudy', title: 'Word study', hint: "Important words, Strong's references, and meanings supported by this context." },
  { key: 'crossRefs', title: 'Cross-references', hint: 'Related passages and how each one connects.' },
  { key: 'interpretation', title: 'Interpretation', hint: 'The central meaning, the evidence for it, and unresolved questions.' },
  { key: 'application', title: 'Application', hint: 'Practical implications grounded in the passage.' },
  { key: 'summary', title: 'Summary', hint: 'The main idea in your own words.' },
] as const

export type WorksheetKey = (typeof WORKSHEET_SECTIONS)[number]['key']

export interface Study {
  id: string
  title: string
  passage: string // OSIS range
  translation?: string // translation for quotes (KJV when absent)
  sections: Record<WorksheetKey, Block[]>
  tags: string[]
  folderId?: string
  createdAt: number
  updatedAt: number
}

export interface SermonSection {
  id: string
  type: string // intro, point, subpoint, illustration, application, questions, conclusion, custom
  title: string
  level: 1 | 2
  collapsed?: boolean
  blocks: Block[]
}

export interface Sermon {
  id: string
  title: string
  subtitle?: string // secondary title under the main title
  series?: string // e.g. "The Anointing, Part 2 of 3"
  translation?: string // translation for quotes (KJV when absent)
  passage: string
  mainIdea: string
  objective: string
  audience: string
  length: string
  template: string
  status: 'draft' | 'ready'
  tags: string[]
  folderId?: string
  studyId?: string
  sections: SermonSection[]
  sources: string
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  kind: 'sermon' | 'study'
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export interface SessionEntry {
  id: string
  kind: 'bible' | 'study' | 'sermon' | 'dictionary'
  path: string
  label: string
  at: number
}

/* ---------- Reading plans and learning (added in database version 2) ----------
 * Every record carries an id and timestamps, and leaves room for an owner, so a future
 * account and sync system can adopt these records without converting them.
 */

/** One sitting of a reading plan: one or more passages, as OSIS ids (e.g. "Gen.1-Gen.3", "Ps.119.1-Ps.119.48"). */
export interface PlanSession {
  id: string
  refs: string[]
}

export interface ReadingPlan {
  id: string
  title: string
  description: string
  kind: 'builtin' | 'custom'
  templateId?: string // which built-in plan it was started from
  editorial?: boolean // passages chosen by the app's editors (not a published plan)
  sessions: PlanSession[]
  translation?: string // preferred translation for this plan
  days: number[] // reading weekdays, 0 = Sunday
  startDate: string // YYYY-MM-DD
  targetDate?: string // the reader's chosen finish date, if any
  pace: number // sessions per reading day (can be below 1)
  anchorDate: string // schedule is counted from this day...
  anchorIndex: number // ...starting with this session
  status: 'active' | 'paused' | 'completed'
  pausedOn?: string
  run: number // 1 for the first time through; restarting adds 1 and keeps earlier records
  reflection: string[] // optional questions shown after each reading
  notes: string
  remind: boolean // show today's reading in the app
  reflections?: Record<string, { text: string; at: number }> // "run:sessionId" -> the reader's reflection (kept even if a reading is unmarked)
  completedAt?: number
  ownerId?: string // reserved for future accounts
  createdAt: number
  updatedAt: number
}

export interface PlanProgress {
  id: string
  planId: string
  sessionId: string
  run: number
  completedAt: number
  updatedAt: number
}

/** A content block in a lesson. Reuses the study blocks so Scripture, sources, AI drafts, and the author's words stay distinct. */
export type LessonBlock = Block | { id: string; kind: 'text'; text: string; heading?: boolean } | { id: string; kind: 'video'; url: string; title: string } | { id: string; kind: 'file'; name: string; type: string; size: number; data: string }

export type QuestionType = 'choice' | 'truefalse' | 'blank' | 'reference' | 'short' | 'reflection' | 'matching'

export interface Question {
  id: string
  type: QuestionType
  prompt: string
  options?: string[] // choice
  answer?: string | number | boolean | string[] // index for choice, boolean for truefalse, accepted answers for blank, OSIS for reference
  pairs?: [string, string][] // matching
  refs: string[] // Scripture the question is based on (OSIS)
  explanation: string
  aiDraft?: boolean // drafted by AI: must be reviewed before publishing
  reviewed?: boolean
}

export interface Quiz {
  id: string
  title: string
  questions: Question[]
  passScore: number // percent of auto-graded points
  attempts: number // 0 = unlimited
  shuffle: boolean
  timeLimit: number // minutes, 0 = none
  required: boolean
  showAnswers: 'never' | 'after-submit' | 'after-pass'
  allowRetake: boolean
}

export interface Lesson {
  id: string
  courseId: string
  title: string
  intro: string
  objectives: string[]
  primaryRef: string // OSIS
  supportingRefs: string[]
  blocks: LessonBlock[] // lesson content
  context: string // historical and biblical context
  discussion: string[]
  reflection: string[]
  assignments: string[]
  summary: string
  instructorNotes: string // shown only in the instructor view
  quiz?: Quiz
  status: 'draft' | 'published' | 'archived'
  releaseOn?: string // YYYY-MM-DD: unlocks on this device from that date
  updatedAt: number
  createdAt: number
}

export interface CourseUnit {
  id: string
  title: string
  lessonIds: string[]
}

export interface Course {
  id: string
  title: string
  description: string
  objectives: string[]
  category: string // e.g. Foundations, Spiritual Maturity, Leadership and Ministry
  level: 'beginner' | 'intermediate' | 'advanced'
  duration: string
  perspective: string // the author's theological perspective, stated by the author
  author: string
  organization: string
  units: CourseUnit[]
  completion: { lessons: boolean; quizzes: boolean; attendance: number } // attendance: sessions required (0 = not tracked)
  certificate: { enabled: boolean; instructor: string }
  status: 'draft' | 'published' | 'archived'
  version: number // increases with each publish
  origin: 'authored' | 'imported'
  role: 'instructor' | 'student' // authored here, or imported to take
  ownerId?: string
  createdAt: number
  updatedAt: number
}

/** A frozen copy of a course at publish time, for version history and course files. */
export interface CourseVersion {
  id: string
  courseId: string
  version: number
  publishedAt: number
  course: Course
  lessons: Lesson[]
}

export interface Enrollment {
  id: string
  courseId: string
  version: number
  studentName: string
  enrolledAt: number
  lessonsDone: Record<string, number> // lessonId -> completed at
  lastLessonId?: string
  completedAt?: number
  certificateAt?: number
  updatedAt: number
}

export interface Attempt {
  id: string
  courseId: string
  lessonId: string
  quizId: string
  startedAt: number
  submittedAt?: number
  answers: Record<string, unknown>
  score?: number // percent of auto-graded points
  passed?: boolean
  updatedAt: number
}

/** A student's reflection or written answer (never auto-graded). */
export interface Submission {
  id: string
  courseId: string
  lessonId: string
  prompt: string
  text: string
  createdAt: number
  updatedAt: number
}

/** Attendance recorded by an instructor on their own device. */
export interface Attendance {
  id: string
  courseId: string
  date: string
  name: string
  present: boolean
  updatedAt: number
}

class StudyDB extends Dexie {
  highlights!: EntityTable<Highlight, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>
  notes!: EntityTable<VerseNote, 'id'>
  dict!: EntityTable<DictEntry, 'id'>
  studies!: EntityTable<Study, 'id'>
  sermons!: EntityTable<Sermon, 'id'>
  folders!: EntityTable<Folder, 'id'>
  settings!: EntityTable<Setting, 'key'>
  sessions!: EntityTable<SessionEntry, 'id'>
  plans!: EntityTable<ReadingPlan, 'id'>
  planProgress!: EntityTable<PlanProgress, 'id'>
  courses!: EntityTable<Course, 'id'>
  lessons!: EntityTable<Lesson, 'id'>
  courseVersions!: EntityTable<CourseVersion, 'id'>
  enrollments!: EntityTable<Enrollment, 'id'>
  attempts!: EntityTable<Attempt, 'id'>
  submissions!: EntityTable<Submission, 'id'>
  attendance!: EntityTable<Attendance, 'id'>

  constructor() {
    super('arise-bible-study')
    this.version(1).stores({
      highlights: 'id, &key, book',
      bookmarks: 'id, &key, book, createdAt',
      notes: 'id, book, startKey, endKey, updatedAt, *tags',
      dict: 'id, term, updatedAt, *tags, *strongs',
      studies: 'id, updatedAt, folderId, *tags',
      sermons: 'id, updatedAt, folderId, status, *tags',
      folders: 'id, kind',
      settings: 'key',
      sessions: 'id, at, kind',
    })
    // Version 2 only adds tables. The version 1 tables and their data are not touched.
    this.version(2).stores({
      plans: 'id, status, updatedAt',
      planProgress: 'id, planId, [planId+run], completedAt',
      courses: 'id, status, updatedAt',
      lessons: 'id, courseId, updatedAt',
      courseVersions: 'id, courseId',
      enrollments: 'id, &courseId, updatedAt',
      attempts: 'id, courseId, lessonId',
      submissions: 'id, courseId, lessonId',
      attendance: 'id, courseId, date',
    })
  }
}

export const db = new StudyDB()

export const LEARNING_TABLES = ['plans', 'planProgress', 'courses', 'lessons', 'courseVersions', 'enrollments', 'attempts', 'submissions', 'attendance'] as const
export const TABLES = ['highlights', 'bookmarks', 'notes', 'dict', 'studies', 'sermons', 'folders', 'settings', 'sessions', ...LEARNING_TABLES] as const

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key)
  return (s?.value as T) ?? fallback
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value })
}

/** Remember where the reader was, newest first, de-duplicated by path. */
export async function recordSession(kind: SessionEntry['kind'], path: string, label: string) {
  await db.transaction('rw', db.sessions, async () => {
    const same = await db.sessions.filter((s) => s.path === path).toArray()
    await db.sessions.bulkDelete(same.map((s) => s.id))
    await db.sessions.add({ id: uid(), kind, path, label, at: Date.now() })
    const all = await db.sessions.orderBy('at').reverse().toArray()
    if (all.length > 40) await db.sessions.bulkDelete(all.slice(40).map((s) => s.id))
  })
}

export function emptyWorksheet(): Record<WorksheetKey, Block[]> {
  return Object.fromEntries(WORKSHEET_SECTIONS.map((s) => [s.key, []])) as unknown as Record<WorksheetKey, Block[]>
}
