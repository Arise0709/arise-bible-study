import Dexie, { type EntityTable } from 'dexie'

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

export * from './types'
import type { Highlight, Bookmark, VerseNote, DictEntry, Study, Sermon, Folder, Setting, SessionEntry, ReadingPlan, PlanProgress, Course, Lesson, CourseVersion, Enrollment, Attempt, Submission, Attendance, RecordState, SyncConflict, LocalSnapshot, Block, WorksheetKey } from './types'
import { WORKSHEET_SECTIONS } from './types'

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
  recordState!: EntityTable<RecordState, 'key'>
  syncMeta!: EntityTable<Setting, 'key'>
  conflicts!: EntityTable<SyncConflict, 'id'>
  snapshots!: EntityTable<LocalSnapshot, 'id'>

  constructor(name = 'arise-bible-study') {
    super(name)
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
    // Version 3 only adds this device's sync bookkeeping. Nothing in versions 1 and 2 changes.
    this.version(3).stores({
      recordState: 'key, kind',
      syncMeta: 'key',
      conflicts: 'id, kind, recordId, at',
      snapshots: 'id, at',
    })
  }
}

export { StudyDB }
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
