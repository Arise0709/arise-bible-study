/**
 * Reading plans: built-in plans, custom plans, and the schedule.
 *
 * A plan is an ordered list of sessions (one sitting each). The schedule is never stored day by day:
 * it is worked out from an anchor (a date and the session expected on it), the reading weekdays, and
 * the pace (sessions per reading day). Pausing, changing days, or resetting the pace only moves the anchor,
 * so completion records are never rewritten and nothing is lost.
 */
import { BOOKS, BOOK_BY_ID, formatRef, parseOsis, parseRef, toOsis, verseCount, chapterCount, isValidRef, type Ref } from './refs'
import { db, uid, type PlanProgress, type PlanSession, type ReadingPlan } from '../db/db'
import { TOPICAL_PLANS } from './planTemplates'

/* ---------------- dates (local calendar days, YYYY-MM-DD) ---------------- */

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12) // noon avoids daylight-saving edges
}
export const today = () => toDay(new Date())
export function addDays(s: string, n: number): string {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return toDay(d)
}
export function formatDay(s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return parseDay(s).toLocaleDateString(undefined, opts)
}

const isReadingDay = (s: string, days: number[]) => days.includes(parseDay(s).getDay())

/** Reading days from `from` up to and including `to`. */
export function readingDaysThrough(from: string, to: string, days: number[]): number {
  if (!days.length || to < from) return 0
  const span = Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400000) + 1
  const weeks = Math.floor(span / 7)
  let n = weeks * days.length
  const start = parseDay(from).getDay()
  for (let i = 0; i < span % 7; i++) if (days.includes((start + weeks * 7 + i) % 7)) n++
  return n
}

/** The date of reading day number k (0 = the first reading day on or after `from`). */
export function nthReadingDay(from: string, k: number, days: number[]): string {
  if (!days.length) return from
  const perWeek = days.length
  let d = addDays(from, Math.floor(k / perWeek) * 7)
  let left = k % perWeek
  while (!isReadingDay(d, days)) d = addDays(d, 1)
  while (left > 0) {
    d = addDays(d, 1)
    if (isReadingDay(d, days)) left--
  }
  return d
}

/* ---------------- schedule ---------------- */

export interface PlanStatus {
  total: number
  done: number
  percent: number
  doneIds: Set<string>
  next?: { index: number; session: PlanSession }
  /** sessions scheduled for today that are not done yet */
  todays: number[]
  /** sessions from earlier days not done yet (shown kindly, never as a penalty) */
  earlier: number[]
  /** the next few scheduled sessions after today */
  upcoming: { index: number; date: string }[]
  finish?: string
}

export function sessionDate(plan: ReadingPlan, index: number): string | undefined {
  if (index < plan.anchorIndex) return undefined
  return nthReadingDay(plan.anchorDate, Math.floor((index - plan.anchorIndex) / plan.pace), plan.days)
}

export function planStatus(plan: ReadingPlan, progress: PlanProgress[], on = today(), upcomingCount = 7): PlanStatus {
  const total = plan.sessions.length
  const doneIds = new Set(progress.filter((p) => p.planId === plan.id && p.run === plan.run).map((p) => p.sessionId))
  const isDone = (i: number) => doneIds.has(plan.sessions[i].id)
  const done = plan.sessions.filter((s) => doneIds.has(s.id)).length
  const firstOpen = plan.sessions.findIndex((s) => !doneIds.has(s.id))
  const todays: number[] = []
  const earlier: number[] = []
  const upcoming: { index: number; date: string }[] = []
  if (plan.status === 'active') {
    // sessions due by the end of `on`
    const rd = on < plan.anchorDate ? 0 : readingDaysThrough(plan.anchorDate, on, plan.days)
    const dueBy = Math.min(total, plan.anchorIndex + Math.ceil(rd * plan.pace))
    for (let i = 0; i < dueBy; i++) {
      if (isDone(i)) continue
      if (sessionDate(plan, i) === on) todays.push(i)
      else earlier.push(i)
    }
    for (let i = dueBy; i < total && upcoming.length < upcomingCount; i++) if (!isDone(i)) upcoming.push({ index: i, date: sessionDate(plan, i)! })
  }
  let finish: string | undefined
  if (plan.status === 'active' && firstOpen >= 0) {
    let last = total - 1
    while (last >= 0 && isDone(last)) last--
    finish = last >= 0 ? (sessionDate(plan, last) ?? on) : undefined
    if (finish && finish < on) finish = on
  }
  return {
    total,
    done,
    percent: total ? Math.round((done / total) * 100) : 0,
    doneIds,
    next: firstOpen >= 0 ? { index: firstOpen, session: plan.sessions[firstOpen] } : undefined,
    todays,
    earlier,
    upcoming,
    finish,
  }
}

/** Sessions per reading day needed to finish the open sessions by `target`, starting `from`. */
export function paceFor(openCount: number, from: string, target: string, days: number[]): number | undefined {
  const n = readingDaysThrough(from, target, days)
  if (n <= 0 || openCount <= 0) return undefined
  return openCount / n
}

/* ---------------- plan changes (each one moves the anchor, never the records) ---------------- */

function firstOpenIndex(plan: ReadingPlan, progress: PlanProgress[]): number {
  const done = new Set(progress.filter((p) => p.planId === plan.id && p.run === plan.run).map((p) => p.sessionId))
  const i = plan.sessions.findIndex((s) => !done.has(s.id))
  return i < 0 ? plan.sessions.length : i
}

async function progressFor(plan: ReadingPlan) {
  return db.planProgress.where('[planId+run]').equals([plan.id, plan.run]).toArray()
}

async function savePlan(plan: ReadingPlan, changes: Partial<ReadingPlan>) {
  const next = { ...plan, ...changes, updatedAt: Date.now() }
  await db.plans.put(next)
  return next
}

/** Start the schedule over from a day (today by default), keeping the pace; nothing already read is lost. */
export async function resetPace(plan: ReadingPlan, from = today()) {
  const prog = await progressFor(plan)
  return savePlan(plan, { anchorDate: from, anchorIndex: firstOpenIndex(plan, prog), targetDate: undefined })
}

/** Keep the chosen finish date: spread what is left over the reading days until then. */
export async function keepFinishDate(plan: ReadingPlan, target: string, from = today()) {
  const prog = await progressFor(plan)
  const idx = firstOpenIndex(plan, prog)
  const open = plan.sessions.length - prog.filter((p) => plan.sessions.some((s) => s.id === p.sessionId)).length
  const pace = paceFor(open, from, target, plan.days)
  if (!pace) throw new Error('There are no reading days between now and that date. Pick a later date or add reading days.')
  return savePlan(plan, { anchorDate: from, anchorIndex: idx, pace, targetDate: target })
}

export async function changeDays(plan: ReadingPlan, days: number[], from = today()) {
  if (!days.length) throw new Error('Choose at least one reading day.')
  const prog = await progressFor(plan)
  const changed = await savePlan(plan, { days: [...days].sort(), anchorDate: from, anchorIndex: firstOpenIndex(plan, prog) })
  return plan.targetDate && plan.targetDate >= from ? keepFinishDate(changed, plan.targetDate, from).catch(() => changed) : changed
}

export async function pausePlan(plan: ReadingPlan, on = today()) {
  return savePlan(plan, { status: 'paused', pausedOn: on })
}

/** Resume: the schedule continues from today, so paused days never count as missed. */
export async function resumePlan(plan: ReadingPlan, on = today()) {
  const prog = await progressFor(plan)
  return savePlan(plan, { status: 'active', pausedOn: undefined, anchorDate: on, anchorIndex: firstOpenIndex(plan, prog) })
}

/** Restart: a new time through. Earlier completion records stay in the history. */
export async function restartPlan(plan: ReadingPlan, from = today()) {
  return savePlan(plan, { status: 'active', run: plan.run + 1, anchorDate: from, anchorIndex: 0, completedAt: undefined, pausedOn: undefined })
}

export async function markSession(plan: ReadingPlan, sessionId: string, done: boolean) {
  const existing = await db.planProgress.where('[planId+run]').equals([plan.id, plan.run]).filter((p) => p.sessionId === sessionId).toArray()
  if (done && !existing.length) {
    await db.planProgress.add({ id: uid(), planId: plan.id, sessionId, run: plan.run, completedAt: Date.now(), updatedAt: Date.now() })
  } else if (!done) {
    await db.planProgress.bulkDelete(existing.map((p) => p.id))
  }
  const prog = await progressFor(plan)
  const all = plan.sessions.every((s) => prog.some((p) => p.sessionId === s.id))
  if (all && plan.status !== 'completed') return savePlan(plan, { status: 'completed', completedAt: Date.now() })
  if (!all && plan.status === 'completed') return savePlan(plan, { status: 'active', completedAt: undefined })
  return plan
}

export const reflectionKey = (run: number, sessionId: string) => `${run}:${sessionId}`

/** Save the reader's reflection on a reading. It does not mark the reading complete, and unmarking a reading keeps it. */
export async function saveReflection(plan: ReadingPlan, sessionId: string, text: string) {
  const current = (await db.plans.get(plan.id)) ?? plan
  const reflections = { ...(current.reflections ?? {}) }
  const key = reflectionKey(current.run, sessionId)
  if (text.trim()) reflections[key] = { text, at: Date.now() }
  else delete reflections[key]
  return savePlan(current, { reflections })
}

/* ---------------- building sessions ---------------- */

const chapterRef = (book: string, from: number, to: number): string => toOsis({ book, chapter: from, ...(to > from ? { endChapter: to } : {}) })

/** Every chapter of the given books, in Bible order, as [book, chapter]. */
function chaptersOf(books: string[]): [string, number][] {
  const out: [string, number][] = []
  for (const b of books) for (let c = 1; c <= chapterCount(b); c++) out.push([b, c])
  return out
}

/** Join consecutive chapters of the same book into one reference. */
function groupChapters(list: [string, number][]): string[] {
  const out: string[] = []
  let i = 0
  while (i < list.length) {
    const [b, c] = list[i]
    let j = i
    while (j + 1 < list.length && list[j + 1][0] === b && list[j + 1][1] === list[j][1] + 1) j++
    out.push(chapterRef(b, c, list[j][1]))
    i = j + 1
  }
  return out
}

/** Split chapters into `count` sessions of about the same number of verses (so Psalm 119 is not paired with three more). */
export function balancedSessions(chapters: [string, number][], count: number): PlanSession[] {
  const weights = chapters.map(([b, c]) => Math.max(1, verseCount(b, c)))
  const total = weights.reduce((a, b) => a + b, 0)
  const sessions: PlanSession[] = []
  let i = 0
  let acc = 0
  for (let s = 0; s < count && i < chapters.length; s++) {
    const remainingSessions = count - s
    const target = (total * (s + 1)) / count
    const part: [string, number][] = [chapters[i]]
    acc += weights[i]
    i++
    // add chapters while that moves the running total closer to this session's share, leaving one chapter per later session
    while (i < chapters.length && chapters.length - i > remainingSessions - 1 && Math.abs(acc + weights[i] - target) < Math.abs(acc - target)) {
      acc += weights[i]
      part.push(chapters[i])
      i++
    }
    if (remainingSessions === 1) while (i < chapters.length) part.push(chapters[i++])
    sessions.push({ id: `s${s + 1}`, refs: groupChapters(part) })
  }
  return sessions
}

/** Fixed number of chapters per session. */
export function chunkedSessions(units: string[], perSession: number): PlanSession[] {
  const out: PlanSession[] = []
  for (let i = 0; i < units.length; i += perSession) out.push({ id: `s${out.length + 1}`, refs: units.slice(i, i + perSession) })
  return out
}

/**
 * Turn what a reader typed ("Mark; Romans 1-8; Ps 23; John 3:1-21") into reading units:
 * whole books and chapter ranges become one unit per chapter, a verse passage stays one unit.
 * Returns the units and anything that could not be understood, so nothing is silently dropped.
 */
export function selectionUnits(input: string): { units: string[]; problems: string[] } {
  const units: string[] = []
  const problems: string[] = []
  for (const raw of input.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) {
    const bookOnly = BOOKS.find((b) => [b.id, b.name, ...b.abbr].some((n) => n.toLowerCase() === raw.toLowerCase().replace(/\.$/, '')))
    if (bookOnly) {
      for (let c = 1; c <= chapterCount(bookOnly.id); c++) units.push(chapterRef(bookOnly.id, c, c))
      continue
    }
    const r = parseRef(raw)
    if (!r || !isValidRef(r) || (r.endChapter !== undefined && r.endChapter > chapterCount(r.book)) || (r.endVerse !== undefined && r.endVerse > verseCount(r.book, r.endChapter ?? r.chapter))) {
      problems.push(raw)
      continue
    }
    if (r.verse === undefined) for (let c = r.chapter; c <= (r.endChapter ?? r.chapter); c++) units.push(chapterRef(r.book, c, c))
    else units.push(toOsis(r))
  }
  return { units, problems }
}

/* ---------------- built-in plans ---------------- */

export interface PlanTemplate {
  id: string
  title: string
  description: string
  editorial: boolean
  /** a suggested finish, in sessions of one per day */
  sessions: () => PlanSession[]
}

const ids = (t: string) => BOOKS.filter((b) => b.testament === t).map((b) => b.id)
const GOSPELS = ['Matt', 'Mark', 'Luke', 'John']

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    id: 'bible-year',
    title: 'Bible in One Year',
    description: 'Genesis to Revelation in 365 readings of about the same length (around 85 verses each).',
    editorial: false,
    sessions: () => balancedSessions(chaptersOf(BOOKS.map((b) => b.id)), 365),
  },
  {
    id: 'nt-90',
    title: 'New Testament in 90 Days',
    description: 'Matthew to Revelation in 90 readings of about the same length.',
    editorial: false,
    sessions: () => balancedSessions(chaptersOf(ids('NT')), 90),
  },
  {
    id: 'gospels',
    title: 'The Four Gospels',
    description: 'Matthew, Mark, Luke, and John, one chapter a day (89 readings).',
    editorial: false,
    sessions: () => chunkedSessions(chaptersOf(GOSPELS).map(([b, c]) => chapterRef(b, c, c)), 1),
  },
  {
    id: 'psalms',
    title: 'The Psalms',
    description: 'One psalm a day for 150 days.',
    editorial: false,
    sessions: () => chunkedSessions(chaptersOf(['Ps']).map(([b, c]) => chapterRef(b, c, c)), 1),
  },
  {
    id: 'proverbs-31',
    title: 'Proverbs in 31 Days',
    description: 'One chapter of Proverbs for each day of the month.',
    editorial: false,
    sessions: () => chunkedSessions(chaptersOf(['Prov']).map(([b, c]) => chapterRef(b, c, c)), 1),
  },
  ...TOPICAL_PLANS.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    editorial: true,
    sessions: () => t.readings.map((refs, i) => ({ id: `s${i + 1}`, refs: refs.map(textToOsis) })),
  })),
]

/** "Luke 11:1-13" -> "Luke.11.1-Luke.11.13". Throws on anything that is not a real passage. */
export function textToOsis(text: string): string {
  const r = parseRef(text)
  if (!r || !isValidRef(r)) throw new Error(`Not a valid passage: ${text}`)
  return toOsis(r)
}

/* ---------------- creating plans ---------------- */

export interface NewPlanOptions {
  title: string
  description: string
  sessions: PlanSession[]
  kind: ReadingPlan['kind']
  templateId?: string
  editorial?: boolean
  startDate: string
  days: number[]
  targetDate?: string
  translation?: string
  reflection?: string[]
  notes?: string
  remind?: boolean
}

export async function createPlan(o: NewPlanOptions): Promise<ReadingPlan> {
  if (!o.sessions.length) throw new Error('This plan has no readings.')
  if (!o.days.length) throw new Error('Choose at least one reading day.')
  let pace = 1
  if (o.targetDate) {
    const p = paceFor(o.sessions.length, o.startDate, o.targetDate, o.days)
    if (!p) throw new Error('The finish date must be on or after the start date, with at least one reading day between.')
    pace = p
  }
  const now = Date.now()
  const plan: ReadingPlan = {
    id: uid(),
    title: o.title.trim() || 'My reading plan',
    description: o.description.trim(),
    kind: o.kind,
    templateId: o.templateId,
    editorial: o.editorial,
    sessions: o.sessions,
    translation: o.translation || undefined,
    days: [...o.days].sort(),
    startDate: o.startDate,
    targetDate: o.targetDate || undefined,
    pace,
    anchorDate: o.startDate,
    anchorIndex: 0,
    status: 'active',
    run: 1,
    reflection: (o.reflection ?? []).map((q) => q.trim()).filter(Boolean),
    notes: o.notes ?? '',
    remind: o.remind ?? true,
    createdAt: now,
    updatedAt: now,
  }
  await db.plans.add(plan)
  return plan
}

/* ---------------- display helpers ---------------- */

export const sessionLabel = (s: PlanSession) => s.refs.map((r) => (parseOsis(r) ? formatRef(parseOsis(r)!) : r)).join('; ')

/** Each chapter a session touches, in order, for the reader's "part 1 of 3" links. */
export function sessionParts(s: PlanSession): { ref: Ref; label: string; path: string }[] {
  const out: { ref: Ref; label: string; path: string }[] = []
  for (const o of s.refs) {
    const r = parseOsis(o)
    if (!r) continue
    const endC = r.endChapter ?? r.chapter
    for (let c = r.chapter; c <= endC; c++) {
      let part: Ref = { book: r.book, chapter: c }
      if (r.verse !== undefined) {
        const from = c === r.chapter ? r.verse : 1
        const to = c === endC ? (r.endVerse ?? (r.endChapter === undefined ? r.verse : verseCount(r.book, c))) : verseCount(r.book, c)
        part = { book: r.book, chapter: c, verse: from, ...(to > from ? { endVerse: to } : {}) }
      }
      const v = part.verse !== undefined ? `/${part.verse}${part.endVerse ? '-' + part.endVerse : ''}` : ''
      out.push({ ref: part, label: formatRef(part), path: `/bible/${part.book}/${part.chapter}${v}` })
    }
  }
  return out
}

export const bookName = (id: string) => BOOK_BY_ID[id]?.name ?? id

/* ---------------- calendar reminders (.ics) ---------------- */

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

/** A calendar file with one all-day event per upcoming reading. The phone's calendar does the reminding. */
export function planToIcs(plan: ReadingPlan, progress: PlanProgress[], baseUrl: string, alarmHour?: number, limit = 400): string {
  const st = planStatus(plan, progress, today(), limit)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carter Study Bible//Reading plans//EN', 'CALSCALE:GREGORIAN']
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const items = [...st.todays.map((index) => ({ index, date: today() })), ...st.upcoming]
  for (const { index, date } of items) {
    const s = plan.sessions[index]
    const d = date.replace(/-/g, '')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${plan.id}-${plan.run}-${s.id}@carterstudybible.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${addDays(date, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(`${plan.title}: ${sessionLabel(s)}`)}`,
      `DESCRIPTION:${icsEscape(`Reading ${index + 1} of ${plan.sessions.length}. Open it here: ${baseUrl}/learn/plans/${plan.id}`)}`,
    )
    if (alarmHour !== undefined) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(sessionLabel(s))}`, `TRIGGER;RELATED=START:PT${alarmHour}H`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
