import { db, TABLES } from './db'

export const BACKUP_FORMAT = 'arise-bible-study-backup'
export const BACKUP_VERSION = 1

/** Settings that describe this device only; never restored from a backup. */
const DEVICE_ONLY_SETTINGS = new Set(['lastBackupAt', 'backupSnoozeUntil'])

export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  const payload = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data }
  return new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
}

/* ---------------- validation ---------------- */

type Table = (typeof TABLES)[number]
type Row = Record<string, unknown>

const str = (v: unknown) => typeof v === 'string'
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const arr = (v: unknown) => Array.isArray(v)
const id = (r: Row) => str(r.id) && (r.id as string).length > 0

/** One check per table: the fields the app needs to show the item without errors. */
const VALID: Record<Table, (r: Row) => boolean> = {
  highlights: (r) => id(r) && str(r.key) && /^[1-3]?[A-Za-z]+\.\d+\.\d+$/.test(r.key as string) && str(r.book) && str(r.color),
  bookmarks: (r) => id(r) && str(r.key) && str(r.book) && str(r.label),
  notes: (r) => id(r) && str(r.ref) && str(r.book) && num(r.startKey) && num(r.endKey) && str(r.text) && arr(r.tags),
  dict: (r) => id(r) && str(r.term) && str(r.definition) && arr(r.strongs) && arr(r.refs) && arr(r.tags),
  studies: (r) => id(r) && str(r.title) && str(r.passage) && !!r.sections && typeof r.sections === 'object' && Object.values(r.sections as object).every(arr),
  sermons: (r) => id(r) && str(r.title) && arr(r.sections) && (r.sections as Row[]).every((s) => s && str(s.id) && arr(s.blocks)),
  folders: (r) => id(r) && str(r.name) && (r.kind === 'sermon' || r.kind === 'study'),
  settings: (r) => str(r.key) && !DEVICE_ONLY_SETTINGS.has(r.key as string),
  sessions: (r) => id(r) && str(r.path) && num(r.at),
  plans: (r) => id(r) && str(r.title) && arr(r.sessions) && (r.sessions as Row[]).every((x) => x && str(x.id) && arr(x.refs)) && arr(r.days) && str(r.startDate) && str(r.anchorDate) && num(r.anchorIndex) && num(r.pace) && (r.pace as number) > 0 && num(r.run),
  planProgress: (r) => id(r) && str(r.planId) && str(r.sessionId) && num(r.run) && num(r.completedAt),
  courses: (r) => id(r) && str(r.title) && arr(r.units) && (r.units as Row[]).every((u) => u && str(u.id) && arr(u.lessonIds)) && (r.status === 'draft' || r.status === 'published' || r.status === 'archived'),
  lessons: (r) => id(r) && str(r.courseId) && str(r.title) && arr(r.blocks),
  courseVersions: (r) => id(r) && str(r.courseId) && num(r.version) && !!r.course && typeof r.course === 'object' && arr(r.lessons),
  enrollments: (r) => id(r) && str(r.courseId) && !!r.lessonsDone && typeof r.lessonsDone === 'object',
  attempts: (r) => id(r) && str(r.courseId) && str(r.lessonId) && str(r.quizId) && !!r.answers && typeof r.answers === 'object',
  submissions: (r) => id(r) && str(r.courseId) && str(r.lessonId) && str(r.text),
  attendance: (r) => id(r) && str(r.courseId) && str(r.date) && str(r.name) && typeof r.present === 'boolean',
}

export const TABLE_LABELS: Record<Table, string> = {
  notes: 'Verse notes',
  highlights: 'Highlights',
  bookmarks: 'Bookmarks',
  studies: 'Studies',
  sermons: 'Sermons and lessons',
  folders: 'Folders',
  dict: 'My dictionary entries',
  settings: 'Settings',
  sessions: 'Recent places',
  plans: 'Reading plans',
  planProgress: 'Reading plan progress',
  courses: 'Courses',
  lessons: 'Lessons',
  courseVersions: 'Course versions',
  enrollments: 'Course enrollments',
  attempts: 'Quiz attempts',
  submissions: 'Reflections and written answers',
  attendance: 'Attendance records',
}

export interface BackupPreview {
  exportedAt: string | null
  version: number
  tables: { table: Table; valid: number; skipped: number }[]
  rows: Record<Table, Row[]>
  /** sections the backup actually contains; a backup made before a section existed never clears it */
  present: Table[]
  skippedTotal: number
  warnings: string[]
}

export class BackupError extends Error {}

/** Reads and checks a backup file without changing anything. */
export function parseBackup(text: string): BackupPreview {
  let parsed: { format?: unknown; version?: unknown; exportedAt?: unknown; data?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError('That file is not a valid backup (it is not JSON).')
  }
  if (!parsed || parsed.format !== BACKUP_FORMAT || !parsed.data || typeof parsed.data !== 'object') {
    throw new BackupError('That file is not an Arise Bible Study backup.')
  }
  const version = typeof parsed.version === 'number' ? parsed.version : 1
  if (version > BACKUP_VERSION) throw new BackupError('This backup was made by a newer version of the app. Update the app, then try again.')
  const data = parsed.data as Record<string, unknown>
  const warnings: string[] = []
  const unknown = Object.keys(data).filter((k) => !(TABLES as readonly string[]).includes(k))
  if (unknown.length) warnings.push(`Ignored unknown sections: ${unknown.join(', ')}.`)
  const rows = {} as Record<Table, Row[]>
  const tables: BackupPreview['tables'] = []
  const present: Table[] = []
  let skippedTotal = 0
  for (const t of TABLES) {
    const list = data[t]
    if (Array.isArray(list)) present.push(t)
    if (list !== undefined && !Array.isArray(list)) warnings.push(`${TABLE_LABELS[t]} were not in the expected form and were skipped.`)
    const all = Array.isArray(list) ? list : []
    const good = all.filter((r): r is Row => !!r && typeof r === 'object' && VALID[t](r as Row))
    // device-only settings are expected to be skipped quietly
    const quiet = t === 'settings' ? all.filter((r) => DEVICE_ONLY_SETTINGS.has((r as Row)?.key as string)).length : 0
    const skipped = all.length - good.length - quiet
    skippedTotal += skipped
    rows[t] = good
    tables.push({ table: t, valid: good.length, skipped })
  }
  if (skippedTotal) warnings.push(`${skippedTotal} damaged or incomplete item${skippedTotal === 1 ? '' : 's'} will be skipped.`)
  return { exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null, version, tables, rows, present, skippedTotal, warnings }
}

export async function currentCounts(): Promise<Record<Table, number>> {
  const out = {} as Record<Table, number>
  for (const t of TABLES) out[t] = t === 'settings' ? await db.settings.filter((s) => !DEVICE_ONLY_SETTINGS.has(s.key)).count() : await db.table(t).count()
  return out
}

export interface RestoreResult {
  added: number
  updated: number
  kept: number
  removed: number
}

/**
 * Applies a checked backup in one transaction (all or nothing).
 * - merge: adds items that are missing; for items in both places keeps the more recently edited one;
 *   a highlight or bookmark on a verse that already has one keeps the current one.
 * - replace: removes current notes, highlights, bookmarks, studies, sermons, folders, dictionary
 *   entries, settings and recent places, then restores the backup. Device-only settings are kept.
 *   Reading plans and learning records are replaced only when the backup contains them.
 */
export async function applyBackup(preview: BackupPreview, mode: 'merge' | 'replace'): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, updated: 0, kept: 0, removed: 0 }
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      const table = db.table(t)
      const incoming = preview.rows[t]
      if (mode === 'replace') {
        // A backup made before reading plans and courses existed has no such sections: keep what is here.
        if (!(preview.present ?? TABLES).includes(t)) continue
        if (t === 'settings') {
          const keys = (await table.toArray()).map((s: Row) => s.key as string).filter((k) => !DEVICE_ONLY_SETTINGS.has(k))
          result.removed += keys.length
          await table.bulkDelete(keys)
        } else {
          result.removed += await table.count()
          await table.clear()
        }
        if (incoming.length) await table.bulkPut(incoming)
        result.added += incoming.length
        continue
      }
      for (const row of incoming) {
        const pk = t === 'settings' ? (row.key as string) : (row.id as string)
        const existing = (await table.get(pk)) as Row | undefined
        if (!existing) {
          // one highlight / bookmark per verse key: keep the current one if the verse already has one
          if ((t === 'highlights' || t === 'bookmarks') && (await table.where('key').equals(row.key as string).count())) {
            result.kept++
            continue
          }
          await table.put(row)
          result.added++
        } else if (num(row.updatedAt) && num(existing.updatedAt) && (row.updatedAt as number) <= (existing.updatedAt as number)) {
          result.kept++
        } else if (t === 'settings' || t === 'sessions' || t === 'folders' || t === 'highlights' || t === 'bookmarks' || t === 'courseVersions') {
          result.kept++ // same item already here; nothing newer to compare, keep current
        } else {
          await table.put(row)
          result.updated++
        }
      }
    }
  })
  return result
}

/** Older entry point kept for compatibility: validate, then merge. */
export async function importBackup(file: File): Promise<number> {
  const r = await applyBackup(parseBackup(await file.text()), 'merge')
  return r.added + r.updated
}
