import 'fake-indexeddb/auto'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, emptyWorksheet, uid, type Attempt, type Question, type Quiz, type Study } from '../src/db/db'
import { setChapterCounts } from '../src/lib/refs'
import { applyBackup, exportBackup, parseBackup } from '../src/db/backup'
import {
  CourseFileError,
  addLesson,
  attemptsLeft,
  certificateEligible,
  checkScriptureQuotes,
  courseFileFrom,
  courseLessons,
  courseProgress,
  createCourse,
  deleteCourse,
  duplicateCourse,
  enroll,
  gradeQuiz,
  importCourse,
  lessonFromStudy,
  newQuiz,
  parseCourseFile,
  publishCourse,
  publishProblems,
  setLessonDone,
  shuffled,
} from '../src/lib/courses'

const DATA = path.join(__dirname, '..', 'public', 'data')
beforeAll(() => {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'kjv', 'index.json'), 'utf8')) as { id: string; chapters: number[] }[]
  setChapterCounts(Object.fromEntries(index.map((b) => [b.id, b.chapters])))
})

const q = (p: Partial<Question>): Question => ({ id: uid(), type: 'choice', prompt: 'Q', refs: [], explanation: '', ...p })
const quiz = (questions: Question[], extra: Partial<Quiz> = {}): Quiz => ({ ...newQuiz(), questions, ...extra })

describe('grading', () => {
  const choice = q({ type: 'choice', prompt: 'Who wrote Romans?', options: ['Peter', 'Paul'], answer: 1, refs: ['Rom.1.1'] })
  const tf = q({ type: 'truefalse', prompt: 'Jesus wept', answer: true, refs: ['John.11.35'] })
  const blank = q({ type: 'blank', prompt: 'For God so loved the ___', answer: ['world'], refs: ['John.3.16'] })
  const ref = q({ type: 'reference', prompt: 'Where is "Jesus wept"?', answer: 'John.11.35', refs: ['John.11.35'] })
  const match = q({ type: 'matching', prompt: 'Match', pairs: [['Moses', 'Law'], ['David', 'Psalms']], refs: ['Ps.23.1'] })
  const short = q({ type: 'short', prompt: 'What is faith?', refs: ['Heb.11.1'] })
  const qz = quiz([choice, tf, blank, ref, match, short], { passScore: 70 })

  it('grades each automatic question type', () => {
    const r = gradeQuiz(qz, { [choice.id]: 1, [tf.id]: true, [blank.id]: '  World! ', [ref.id]: 'Jn 11:35', [match.id]: { 0: 'Law', 1: 'Psalms' }, [short.id]: 'Trust' })
    expect(r.score).toBe(100)
    expect(r.passed).toBe(true)
    expect(r.written).toBe(1)
  })
  it('written answers are never marked right or wrong, and do not change the score', () => {
    const r = gradeQuiz(qz, { [choice.id]: 1, [tf.id]: true, [blank.id]: 'world', [ref.id]: 'John 11:35', [match.id]: { 0: 'Law', 1: 'Psalms' } })
    expect(r.score).toBe(100)
    expect(r.results.find((x) => x.id === short.id)).toMatchObject({ auto: false, credit: 0 })
  })
  it('wrong answers lower the score and list the Scripture to revisit', () => {
    const r = gradeQuiz(qz, { [choice.id]: 0, [tf.id]: false, [blank.id]: 'church', [ref.id]: 'John 11:34', [match.id]: { 0: 'Psalms', 1: 'Psalms' } })
    expect(r.score).toBe(10) // half credit on matching only: 0.5 of 5 points
    expect(r.passed).toBe(false)
    expect(r.review).toEqual(['Rom.1.1', 'John.11.35', 'John.3.16', 'Ps.23.1'])
  })
  it('attempt limits and retakes', () => {
    const a = (n: number): Attempt[] => Array.from({ length: n }, () => ({ id: uid(), courseId: 'c', lessonId: 'l', quizId: qz.id, startedAt: 1, submittedAt: 2, answers: {}, updatedAt: 2 }))
    expect(attemptsLeft({ ...qz, attempts: 2 }, a(1))).toBe(1)
    expect(attemptsLeft({ ...qz, attempts: 2 }, a(2))).toBe(0)
    expect(attemptsLeft({ ...qz, attempts: 0 }, a(9))).toBe(Infinity)
    expect(attemptsLeft({ ...qz, allowRetake: false }, a(1))).toBe(0)
  })
  it('shuffling is stable for one attempt and keeps every item', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(shuffled(items, 'a')).toEqual(shuffled(items, 'a'))
    expect([...shuffled(items, 'a')].sort()).toEqual(items)
  })
})

const clear = async () => {
  for (const t of ['courses', 'lessons', 'courseVersions', 'enrollments', 'attempts', 'submissions', 'attendance']) await db.table(t).clear()
}

describe('courses: drafts, publishing, progress, certificates', () => {
  beforeEach(clear)

  it('drafts cannot be published until they are ready; AI drafts must be reviewed', async () => {
    const c0 = await createCourse({ title: 'Foundations 1' })
    const l = await addLesson(c0, c0.units[0].id, { title: 'Salvation', primaryRef: 'Eph.2.8-Eph.2.9' })
    const c = (await db.courses.get(c0.id))!
    expect(publishProblems(c, await courseLessons(c))).toContain('Publish at least one lesson (lessons start as drafts).')
    await db.lessons.update(l.id, { status: 'published', blocks: [{ id: 'a', kind: 'ai', text: 'x', citations: [], warnings: [], createdAt: 1 }] })
    expect(publishProblems(c, await courseLessons(c)).join(' ')).toMatch(/AI draft that has not been reviewed/)
    await db.lessons.update(l.id, { blocks: [{ id: 'a', kind: 'ai', text: 'x', citations: [], warnings: [], createdAt: 1, reviewed: true }], supportingRefs: ['Gen.51.1'] })
    expect(publishProblems(c, await courseLessons(c)).join(' ')).toMatch(/does not exist: Gen.51.1/)
    await db.lessons.update(l.id, { supportingRefs: ['Rom.10.9'] })
    const snap = await publishCourse(c)
    expect(snap.version).toBe(1)
    expect((await db.courses.get(c.id))?.status).toBe('published')
  })

  it('a course file holds only published lessons; student files leave out instructor notes', async () => {
    const c = await createCourse({ title: 'Prayer' })
    await addLesson(c, c.units[0].id, { title: 'Draft lesson' })
    const pub = await addLesson(c, c.units[0].id, { title: 'Our Father', status: 'published', instructorNotes: 'Leader only' })
    const snap = await publishCourse((await db.courses.get(c.id))!)
    const student = JSON.parse(courseFileFrom(snap, 'students'))
    expect(student.lessons.map((l: { title: string }) => l.title)).toEqual(['Our Father'])
    expect(student.lessons[0].instructorNotes).toBe('')
    const teacher = JSON.parse(courseFileFrom(snap, 'instructors'))
    expect(teacher.lessons[0].instructorNotes).toBe('Leader only')
    void pub
  })

  it('progress, completion, and certificate rules', async () => {
    const c = await createCourse({ title: 'Prayer', certificate: { enabled: true, instructor: 'Pastor' } })
    const l1 = await addLesson(c, c.units[0].id, { title: 'One', status: 'published' })
    const qz = quiz([q({ options: ['a', 'b'], answer: 0 })])
    const l2 = await addLesson(c, c.units[0].id, { title: 'Two', status: 'published', quiz: qz })
    const course = (await db.courses.get(c.id))!
    const lessons = await courseLessons(course)
    let e = await enroll(course, 'J. Davon Carter')
    let p = courseProgress(course, lessons, e, [])
    expect(p).toMatchObject({ lessonsDone: 0, lessonsTotal: 2, quizzesRequired: 1, complete: false })
    expect(certificateEligible(course, p, e.studentName).ok).toBe(false)
    await setLessonDone(e, l1.id, true)
    e = (await db.enrollments.get(e.id))!
    await setLessonDone(e, l2.id, true)
    e = (await db.enrollments.get(e.id))!
    p = courseProgress(course, lessons, e, [])
    expect(p.missing).toEqual(['1 required quiz to pass'])
    const passed: Attempt = { id: 'x', courseId: c.id, lessonId: l2.id, quizId: qz.id, startedAt: 1, submittedAt: 2, answers: {}, score: 100, passed: true, updatedAt: 2 }
    p = courseProgress(course, lessons, e, [passed])
    expect(p.complete).toBe(true)
    expect(p.percent).toBe(100)
    expect(certificateEligible(course, p, e.studentName)).toEqual({ ok: true })
    expect(certificateEligible(course, p, ' ').ok).toBe(false)
    expect(certificateEligible({ ...course, completion: { ...course.completion, attendance: 6 } }, courseProgress({ ...course, completion: { ...course.completion, attendance: 6 } }, lessons, e, [passed]), 'J').reason).toMatch(/instructor issues/)
    expect(certificateEligible({ ...course, certificate: { enabled: false, instructor: '' } }, p, 'J').ok).toBe(false)
  })

  it('importing to take a course: safe checks, and updates keep the enrollment', async () => {
    const c = await createCourse({ title: 'Identity' })
    const l = await addLesson(c, c.units[0].id, { title: 'In Christ', status: 'published', primaryRef: 'Eph.1.3-Eph.1.14', blocks: [{ id: 'v', kind: 'video', url: 'https://example.org/v', title: 'Intro' }] })
    const snap = await publishCourse((await db.courses.get(c.id))!)
    const text = courseFileFrom(snap, 'students')
    await deleteCourse(c.id)
    const imp = parseCourseFile(text)
    expect(imp.warnings).toEqual([])
    const taken = await importCourse(imp, 'student')
    expect(taken.role).toBe('student')
    const e = await enroll(taken, 'Me')
    await setLessonDone(e, l.id, true)
    // version 2 of the same course replaces the lessons and keeps progress
    const v2 = JSON.parse(text)
    v2.course.version = 2
    v2.lessons[0].title = 'In Christ (revised)'
    await importCourse(parseCourseFile(JSON.stringify(v2)), 'student')
    expect((await db.lessons.get(l.id))?.title).toBe('In Christ (revised)')
    expect((await db.enrollments.get(e.id))?.lessonsDone[l.id]).toBeTruthy()
    // an older file can't replace a newer copy
    await expect(importCourse(parseCourseFile(text), 'student')).rejects.toThrow(/newer version/)
  })

  it('rejects files that are not course files, and drops unsafe content', () => {
    expect(() => parseCourseFile('nope')).toThrow(CourseFileError)
    expect(() => parseCourseFile(JSON.stringify({ format: 'other' }))).toThrow(/not a Carter Study Bible course file/)
    expect(() => parseCourseFile(JSON.stringify({ format: 'carter-study-bible-course', version: 9 }))).toThrow(/newer version/)
    const course = { id: 'c1', title: 'T', units: [{ id: 'u', title: 'U', lessonIds: ['l1', 'l2'] }] }
    const base = { id: 'l1', courseId: 'c1', title: 'L', intro: '', context: '', summary: '', instructorNotes: '', primaryRef: '', objectives: [], supportingRefs: [], discussion: [], reflection: [], assignments: [] }
    const file = {
      format: 'carter-study-bible-course',
      version: 1,
      course,
      lessons: [
        { ...base, blocks: [{ id: 'b', kind: 'text', text: '<script>alert(1)</script>' }] },
        { ...base, id: 'l2', blocks: [{ id: 'v', kind: 'video', url: 'javascript:alert(1)', title: 'x' }] },
      ],
    }
    const imp = parseCourseFile(JSON.stringify(file))
    expect(imp.file.lessons.map((l) => l.id)).toEqual(['l1']) // text is kept as plain text; the javascript: link is refused
    expect(imp.file.course.units[0].lessonIds).toEqual(['l1'])
    expect(imp.warnings.join(' ')).toMatch(/1 damaged lesson/)
  })

  it('a quotation in a course file that differs from the app text is reported, not changed', async () => {
    const lessons = [{ title: 'L', blocks: [{ id: 'b', kind: 'scripture', ref: 'John.11.35', text: 'Jesus laughed.', tr: 'KJV' }] }] as never
    const out = await checkScriptureQuotes(lessons, async () => 'Jesus wept.')
    expect(out[0]).toMatch(/does not match the KJV text/)
    expect(await checkScriptureQuotes([{ title: 'L', blocks: [{ id: 'b', kind: 'scripture', ref: 'John.11.35', text: '35 Jesus wept.', tr: 'KJV' }] }] as never, async () => 'Jesus wept.')).toEqual([])
  })

  it('duplicating makes an independent draft', async () => {
    const c = await createCourse({ title: 'Original' })
    await addLesson(c, c.units[0].id, { title: 'A', status: 'published' })
    const course = (await db.courses.get(c.id))!
    const copy = await duplicateCourse(course, await courseLessons(course))
    const lessons = await courseLessons(copy)
    expect(copy.title).toBe('Original (copy)')
    expect(lessons.map((l) => [l.title, l.status])).toEqual([['A', 'draft']])
    expect(lessons[0].courseId).toBe(copy.id)
  })

  it('a study becomes a draft lesson; Scripture and sources keep their kinds, the reader\'s notes become lesson text', () => {
    const sections = emptyWorksheet()
    sections.context = [{ id: '1', kind: 'source', source: 'isbe', title: 'Romans', text: 'Written from Corinth', citation: 'ISBE' }]
    sections.interpretation = [{ id: '2', kind: 'note', text: 'God works all things for good' }]
    const study: Study = { id: 's', title: 'Romans 8:28', passage: 'Rom.8.28', sections, tags: [], createdAt: 1, updatedAt: 1 }
    const l = lessonFromStudy(study, 'c')
    expect(l.status).toBe('draft')
    expect(l.primaryRef).toBe('Rom.8.28')
    expect(l.blocks.map((b) => b.kind)).toEqual(['text', 'source', 'text', 'text'])
    expect(l.blocks[2]).toMatchObject({ kind: 'text', text: 'Interpretation', heading: true })
    expect(study.sections.interpretation[0].kind).toBe('note') // the study is untouched
  })

  it('courses and learning records are in backups', async () => {
    const c = await createCourse({ title: 'Backed up' })
    await addLesson(c, c.units[0].id, { title: 'L' })
    const text = await (await exportBackup()).text()
    await clear()
    await applyBackup(parseBackup(text), 'merge')
    expect((await db.courses.get(c.id))?.title).toBe('Backed up')
    expect(await db.lessons.where('courseId').equals(c.id).count()).toBe(1)
  })
})
