import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type PlanProgress, type ReadingPlan } from '../src/db/db'
import { applyBackup, exportBackup, parseBackup } from '../src/db/backup'
import { parseOsis, setChapterCounts, verseCount, chapterCount, toOsis } from '../src/lib/refs'
import {
  PLAN_TEMPLATES,
  createPlan,
  keepFinishDate,
  markSession,
  nthReadingDay,
  pausePlan,
  planStatus,
  planToIcs,
  readingDaysThrough,
  restartPlan,
  resumePlan,
  selectionUnits,
  sessionParts,
  changeDays,
  chunkedSessions,
} from '../src/lib/plans'

const DATA = path.join(__dirname, '..', 'public', 'data')
const index = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')) as { id: string; chapters: number[] }[]
beforeAll(() => setChapterCounts(Object.fromEntries(index.map((b) => [b.id, b.chapters]))))

const kjvChapter = (book: string, c: number) => JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', book, `${c}.json`), 'utf8'))

describe('built-in plans contain only real Scripture', () => {
  it('every reference in every plan exists in the KJV text (book, chapter, and verses)', () => {
    let refs = 0
    for (const t of PLAN_TEMPLATES) {
      const sessions = t.sessions()
      expect(sessions.length, t.id).toBeGreaterThan(0)
      expect(new Set(sessions.map((s) => s.id)).size, `${t.id} session ids unique`).toBe(sessions.length)
      for (const s of sessions) {
        expect(s.refs.length, `${t.id} ${s.id}`).toBeGreaterThan(0)
        for (const o of s.refs) {
          const r = parseOsis(o)
          expect(r, o).toBeTruthy()
          expect(toOsis(r!), 'round trip').toBe(o)
          for (const part of sessionParts({ id: 'x', refs: [o] })) {
            const ch = kjvChapter(part.ref.book, part.ref.chapter)
            const verses = Object.keys(ch.verses ?? ch.v ?? {}).length || verseCount(part.ref.book, part.ref.chapter)
            expect(verses, `${o} chapter exists`).toBeGreaterThan(0)
            if (part.ref.verse !== undefined) expect(part.ref.endVerse ?? part.ref.verse, `${o} verses exist`).toBeLessThanOrEqual(verseCount(part.ref.book, part.ref.chapter))
          }
          refs++
        }
      }
    }
    expect(refs).toBeGreaterThan(900)
  })
  it('Bible in One Year covers all 1,189 chapters exactly once, in order, in 365 readings', () => {
    const s = PLAN_TEMPLATES.find((t) => t.id === 'bible-year')!.sessions()
    expect(s.length).toBe(365)
    const seen: string[] = []
    for (const x of s) for (const p of sessionParts(x)) seen.push(`${p.ref.book}.${p.ref.chapter}`)
    expect(seen.length).toBe(1189)
    expect(new Set(seen).size).toBe(1189)
    expect(seen[0]).toBe('Gen.1')
    expect(seen.at(-1)).toBe('Rev.22')
    // readings are of similar length: none more than about three times the average
    const lens = s.map((x) => sessionParts(x).reduce((n, p) => n + verseCount(p.ref.book, p.ref.chapter), 0))
    expect(Math.max(...lens)).toBeLessThan(3 * (31102 / 365))
  })
  it('New Testament in 90 Days covers all 260 NT chapters; Gospels 89; Psalms 150; Proverbs 31', () => {
    const count = (id: string) => PLAN_TEMPLATES.find((t) => t.id === id)!.sessions().flatMap((x) => sessionParts(x)).length
    expect(PLAN_TEMPLATES.find((t) => t.id === 'nt-90')!.sessions().length).toBe(90)
    expect(count('nt-90')).toBe(260)
    expect(count('gospels')).toBe(89)
    expect(count('psalms')).toBe(150)
    expect(PLAN_TEMPLATES.find((t) => t.id === 'proverbs-31')!.sessions().length).toBe(31)
  })
  it('topical plans are labeled as an editorial selection', () => {
    const topical = PLAN_TEMPLATES.filter((t) => t.editorial).map((t) => t.id)
    expect(topical).toEqual(['life-of-jesus', 'foundations', 'prayer-growth', 'leadership', 'faith-obedience'])
    expect(PLAN_TEMPLATES.length).toBe(10)
  })
})

describe('custom selections', () => {
  it('books, chapter ranges, and passages become reading units; anything unclear is reported, not dropped', () => {
    const { units, problems } = selectionUnits('Jude; Rom 1-3; John 3:1-21\nPs 151; Hezekiah 4; Gen 51')
    expect(units).toEqual(['Jude.1', 'Rom.1', 'Rom.2', 'Rom.3', 'John.3.1-John.3.21'])
    expect(problems).toEqual(['Ps 151', 'Hezekiah 4', 'Gen 51'])
    expect(chunkedSessions(units, 2).map((s) => s.refs)).toEqual([['Jude.1', 'Rom.1'], ['Rom.2', 'Rom.3'], ['John.3.1-John.3.21']])
  })
  it('reader parts for a session spanning chapters', () => {
    expect(sessionParts({ id: 'x', refs: ['Mark.8.27-Mark.9.13'] }).map((p) => p.path)).toEqual(['/bible/Mark/8/27-38', '/bible/Mark/9/1-13'])
    expect(sessionParts({ id: 'x', refs: ['Gen.1-Gen.3'] }).map((p) => p.label)).toEqual(['Genesis 1', 'Genesis 2', 'Genesis 3'])
  })
})

describe('calendar math', () => {
  it('counts reading days and finds the nth one', () => {
    // 2026-11-01 is a Sunday
    expect(readingDaysThrough('2026-11-01', '2026-11-07', [0, 1, 2, 3, 4, 5, 6])).toBe(7)
    expect(readingDaysThrough('2026-11-01', '2026-11-14', [1, 3, 5])).toBe(6)
    expect(readingDaysThrough('2026-11-05', '2026-11-04', [1])).toBe(0)
    expect(nthReadingDay('2026-11-01', 0, [1, 3, 5])).toBe('2026-11-02')
    expect(nthReadingDay('2026-11-01', 3, [1, 3, 5])).toBe('2026-11-09')
    for (let k = 0; k < 40; k++) {
      const d = nthReadingDay('2026-11-01', k, [2, 6])
      expect(readingDaysThrough('2026-11-01', d, [2, 6])).toBe(k + 1)
    }
  })
})

const clear = async () => {
  await db.plans.clear()
  await db.planProgress.clear()
}
const prog = (p: ReadingPlan) => db.planProgress.where('planId').equals(p.id).toArray()
const fresh = async (p: ReadingPlan) => (await db.plans.get(p.id))!

describe('scheduling without penalties', () => {
  beforeEach(clear)
  const sessions = Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}`, refs: [`Ps.${i + 1}`] }))
  const make = (extra = {}) => createPlan({ title: 'Ten psalms', description: '', sessions, kind: 'custom', startDate: '2026-11-01', days: [0, 1, 2, 3, 4, 5, 6], ...extra })

  it('today and upcoming readings follow the start date', async () => {
    const p = await make()
    const st = planStatus(p, [], '2026-11-01')
    expect(st.todays).toEqual([0])
    expect(st.earlier).toEqual([])
    expect(st.upcoming.slice(0, 2)).toEqual([{ index: 1, date: '2026-11-02' }, { index: 2, date: '2026-11-03' }])
    expect(st.finish).toBe('2026-11-10')
  })
  it('missed readings are listed as earlier readings; catching up resets from today without losing anything', async () => {
    let p = await make()
    p = await markSession(p, 's1', true)
    const st = planStatus(p, await prog(p), '2026-11-04')
    expect(st.done).toBe(1)
    expect(st.earlier).toEqual([1, 2])
    expect(st.todays).toEqual([3])
    // reset the pace from today
    const { resetPace } = await import('../src/lib/plans')
    p = await resetPace(p, '2026-11-04')
    const after = planStatus(p, await prog(p), '2026-11-04')
    expect(after.earlier).toEqual([])
    expect(after.todays).toEqual([1])
    expect(after.done).toBe(1)
  })
  it('keeping a finish date spreads what is left over the days remaining', async () => {
    let p = await make()
    p = await keepFinishDate(p, '2026-11-05', '2026-11-01')
    expect(p.pace).toBe(2)
    expect(planStatus(p, [], '2026-11-01').todays).toEqual([0, 1])
    expect(planStatus(p, [], '2026-11-01').finish).toBe('2026-11-05')
    await expect(keepFinishDate(p, '2026-10-01', '2026-11-01')).rejects.toThrow(/no reading days/)
  })
  it('pausing stops readings from coming due; resuming continues from that day', async () => {
    let p = await make()
    p = await pausePlan(p, '2026-11-02')
    expect(planStatus(p, [], '2026-11-08').earlier).toEqual([])
    p = await resumePlan(p, '2026-11-08')
    const st = planStatus(p, await prog(p), '2026-11-08')
    expect(st.todays).toEqual([0])
    expect(st.earlier).toEqual([])
  })
  it('changing reading days keeps progress and moves the schedule', async () => {
    let p = await make()
    p = await markSession(p, 's1', true)
    p = await changeDays(p, [1, 3, 5], '2026-11-01')
    const st = planStatus(p, await prog(p), '2026-11-02')
    expect(st.done).toBe(1)
    expect(st.todays).toEqual([1])
    expect(st.upcoming[0]).toEqual({ index: 2, date: '2026-11-04' })
  })
  it('finishing marks the plan complete; restarting keeps the earlier record', async () => {
    let p = await make()
    for (const s of sessions) p = await markSession(p, s.id, true)
    expect(p.status).toBe('completed')
    p = await restartPlan(p, '2026-12-01')
    expect(p.run).toBe(2)
    expect(p.status).toBe('active')
    const all = await prog(p)
    expect(all.filter((x) => x.run === 1).length).toBe(10)
    expect(planStatus(p, all, '2026-12-01').done).toBe(0)
  })
  it('a reflection never marks a reading complete, and unmarking a reading keeps the reflection', async () => {
    const { saveReflection } = await import('../src/lib/plans')
    let p = await make()
    p = await saveReflection(p, 's1', 'Thoughts')
    expect(planStatus(p, await prog(p), '2026-11-01').done).toBe(0)
    p = await markSession(p, 's1', true)
    p = await markSession(p, 's1', false)
    expect((await fresh(p)).reflections?.['1:s1'].text).toBe('Thoughts')
  })
  it('undoing a reading reopens a completed plan', async () => {
    let p = await make()
    for (const s of sessions) p = await markSession(p, s.id, true)
    p = await markSession(p, 's4', false)
    expect(p.status).toBe('active')
    expect(planStatus(p, await prog(p), '2026-11-20').done).toBe(9)
  })
  it('several plans run side by side', async () => {
    const a = await make()
    const b = await make({ title: 'Second' })
    await markSession(a, 's1', true)
    const all = (await db.planProgress.toArray()) as PlanProgress[]
    expect(planStatus(await fresh(a), all, '2026-11-01').done).toBe(1)
    expect(planStatus(await fresh(b), all, '2026-11-01').done).toBe(0)
  })
  it('calendar file lists upcoming readings as all-day events', async () => {
    const p = await make()
    const ics = planToIcs(p, [], 'https://www.carterstudybible.app', 7)
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true)
    expect(ics).toContain('SUMMARY:Ten psalms: Psalms 1')
    expect(ics).toContain('BEGIN:VALARM')
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBeGreaterThan(0)
  })
})

describe('reading plans in backups', () => {
  beforeEach(clear)
  it('plans and progress are in the backup and restore exactly', async () => {
    let p = await createPlan({ title: 'Psalms', description: '', sessions: [{ id: 's1', refs: ['Ps.1'] }, { id: 's2', refs: ['Ps.2'] }], kind: 'custom', startDate: '2026-11-01', days: [1] })
    p = await markSession(p, 's1', true)
    const { saveReflection } = await import('../src/lib/plans')
    p = await saveReflection(p, 's2', 'Blessed is the man')
    const text = await (await exportBackup()).text()
    const json = JSON.parse(text)
    expect(json.version).toBe(1)
    expect(json.data.plans.length).toBe(1)
    await clear()
    await applyBackup(parseBackup(text), 'merge')
    expect((await db.plans.get(p.id))?.title).toBe('Psalms')
    expect((await db.plans.get(p.id))?.reflections?.['1:s2'].text).toBe('Blessed is the man')
    expect((await db.planProgress.toArray()).length).toBe(1)
  })
  it('replacing from a backup made before reading plans existed keeps the plans on this device', async () => {
    const p = await createPlan({ title: 'Keep me', description: '', sessions: [{ id: 's1', refs: ['Ps.1'] }], kind: 'custom', startDate: '2026-11-01', days: [1] })
    const old = JSON.stringify({ format: 'arise-bible-study-backup', version: 1, data: { notes: [], highlights: [], bookmarks: [], dict: [], studies: [], sermons: [], folders: [], settings: [], sessions: [] } })
    const preview = parseBackup(old)
    expect(preview.present).not.toContain('plans')
    await applyBackup(preview, 'replace')
    expect((await db.plans.get(p.id))?.title).toBe('Keep me')
  })
  it('damaged plan records are skipped and reported', () => {
    const preview = parseBackup(JSON.stringify({ format: 'arise-bible-study-backup', version: 1, data: { plans: [{ id: 'x', title: 'Broken' }] } }))
    expect(preview.tables.find((t) => t.table === 'plans')).toMatchObject({ valid: 0, skipped: 1 })
  })
})

describe('chapter counts used by plans', () => {
  it('match the KJV index', () => {
    expect(chapterCount('Ps')).toBe(150)
    expect(verseCount('Ps', 119)).toBe(176)
  })
})
