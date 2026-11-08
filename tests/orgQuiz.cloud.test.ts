/**
 * Server grading of church-course quizzes (api/org-quiz.ts) against a real Supabase stack.
 * Skipped unless SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set.
 */
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const run = !!(URL_ && ANON && SERVICE)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

async function person(tag: string) {
  const admin = createClient(URL_!, SERVICE!, opts)
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.org`
  const password = 'correct horse battery staple'
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  const c = createClient(URL_!, ANON!, opts)
  const s = await c.auth.signInWithPassword({ email, password })
  return { c, email, id: data.user!.id, token: s.data.session!.access_token }
}

const quiz = (showAnswers: string, attempts = 2) => ({
  id: 'q1', title: 'Check', passScore: 70, attempts, shuffle: false, timeLimit: 0, required: true, showAnswers, allowRetake: true,
  questions: [
    { id: 'a', type: 'choice', prompt: 'Saved by?', options: ['works', 'grace'], answer: 1, refs: ['Eph.2.8'], explanation: 'By grace through faith.' },
    { id: 'b', type: 'reference', prompt: 'Where is "the just shall live by faith"?', answer: 'Rom.1.17', refs: [], explanation: '' },
    { id: 'c', type: 'matching', prompt: 'Match', pairs: [['Eph', 'Grace'], ['Jas', 'Works']], refs: [], explanation: '' },
    { id: 'd', type: 'short', prompt: 'In your words', refs: [], explanation: '' },
  ],
})
const content = (q: object) => ({
  course: { id: 'c', title: 'Romans', description: '', objectives: [], category: 'Foundations', level: 'beginner', duration: '', perspective: '', author: '', organization: '', units: [{ id: 'u', title: 'U', lessonIds: ['l1'] }], completion: { lessons: false, quizzes: true, attendance: 0 }, certificate: { enabled: false, instructor: '' }, status: 'draft', version: 0, origin: 'authored', role: 'instructor', createdAt: 1, updatedAt: 1 },
  lessons: [{ id: 'l1', courseId: 'c', title: 'L1', intro: '', objectives: [], primaryRef: '', supportingRefs: [], blocks: [], context: '', discussion: [], reflection: [], assignments: [], summary: '', instructorNotes: '', status: 'published', createdAt: 1, updatedAt: 1, quiz: q }],
})
const post = (token: string, body: unknown) =>
  new Request('https://www.carterstudybible.app/api/org-quiz', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'https://www.carterstudybible.app', host: 'www.carterstudybible.app' },
    body: JSON.stringify(body),
  })

describe.skipIf(!run)('server grading of church quizzes', () => {
  it('grades with the app\'s grader, records the attempt, enforces tries, and reveals answers only as allowed', async () => {
    Object.assign(process.env, { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE })
    const { POST } = await import('../api/org-quiz')
    const owner = await person('q-owner')
    const student = await person('q-student')
    const outsider = await person('q-out')
    const org = (await owner.c.rpc('create_org', { p: { name: 'Quiz Church', kind: 'church', contact_email: 'q@example.org', display_name: 'P', adult: true } })).data as string
    const cid = (await owner.c.rpc('create_org_course', { o: org, content: content(quiz('never')) })).data as string
    await owner.c.rpc('publish_org_course', { cid })
    await owner.c.rpc('set_org_course_options', { cid, p: { catalog: true } })
    const inv = await owner.c.rpc('create_invitation', { o: org, p: { email: student.email, role: 'member', course_ids: [cid] } })
    await student.c.rpc('accept_invitation', { token: inv.data.token, display_name: 'S', adult: true })

    const wrong = await POST(post(student.token, { course: cid, lesson: 'l1', answers: { a: 0, b: 'John 3:16', c: { 0: 'Works', 1: 'Grace' }, d: 'faith' } }))
    const w = await wrong.json()
    expect(wrong.status).toBe(200)
    expect(w.score).toBe(0)
    expect(w.passed).toBe(false)
    expect(w.reveal).toBe(false)
    expect(w.quiz).toBeUndefined() // "never": no answers sent back
    expect(w.written).toBe(1)

    const right = await POST(post(student.token, { course: cid, lesson: 'l1', answers: { a: 1, b: 'Romans 1:17', c: { 0: 'Grace', 1: 'Works' }, d: 'grace', score: 100, extra: 'ignored' } }))
    const r = await right.json()
    expect(r.score).toBe(100)
    expect(r.passed).toBe(true)

    const third = await POST(post(student.token, { course: cid, lesson: 'l1', answers: {} }))
    expect(third.status).toBe(400)
    expect((await third.json()).error).toMatch(/No tries left/)

    const rows = (await student.c.from('org_quiz_attempts').select('score, passed, answers').eq('course_id', cid).order('submitted_at')).data!
    expect(rows.map((x) => x.score)).toEqual([0, 100])
    expect(Object.keys(rows[1].answers).sort()).toEqual(['a', 'b', 'c', 'd']) // only real question ids are kept
    const enr = (await student.c.from('org_enrollments').select('status').eq('course_id', cid).single()).data
    expect(enr?.status).toBe('completed') // the required quiz was the only rule

    expect((await POST(post(outsider.token, { course: cid, lesson: 'l1', answers: { a: 1 } }))).status).toBe(403)
    expect((await POST(post(owner.token, { course: cid, lesson: 'l1', answers: { a: 1 } }))).status).toBe(403) // staff are not enrolled

    // "after-submit": the answer key comes back with the result
    const cid2 = (await owner.c.rpc('create_org_course', { o: org, content: content(quiz('after-submit', 0)) })).data as string
    await owner.c.rpc('publish_org_course', { cid: cid2 })
    await owner.c.rpc('enroll_members', { cid: cid2, users: [student.id] })
    const shown = await (await POST(post(student.token, { course: cid2, lesson: 'l1', answers: { a: 0 } }))).json()
    expect(shown.reveal).toBe(true)
    expect(shown.quiz.questions[0].answer).toBe(1)
  }, 60000)
})
