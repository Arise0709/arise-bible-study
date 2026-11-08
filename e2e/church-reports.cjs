/*
 * Workspace reports in the real app (Release 6.2, Stage F): exact numbers from saved activity, spreadsheet export,
 * and each role sees only what it may (administrator: everything; instructor: own courses; group leader: own groups;
 * member: no reports).
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/church-reports.cjs http://127.0.0.1:5173
 */
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const URL_ = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log('  ok  ' + name)
  } else {
    failures.push(name)
    console.log('  FAIL ' + name + (detail ? ' :: ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400) : ''))
  }
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
const run = Date.now().toString(36)
const PASSWORD = 'grace and truth forever'
async function person(tag) {
  const email = `${tag}-${run}@example.org`
  const { data } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { age_confirmed_13: true } })
  const c = createClient(URL_, ANON, opts)
  await c.auth.signInWithPassword({ email, password: PASSWORD })
  return { email, password: PASSWORD, c, id: data.user.id }
}
async function signIn(page, p) {
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(p.email)
  await page.getByLabel('Password').fill(p.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByTestId('church-card').waitFor({ timeout: 20000 })
}
const lesson = (id, extra = {}) => ({ id, courseId: 'c', title: id, intro: '', objectives: [], primaryRef: '', supportingRefs: [], blocks: [], context: '', discussion: [], reflection: ['Why?'], assignments: [], summary: '', instructorNotes: '', status: 'published', createdAt: 1, updatedAt: 1, ...extra })
const content = (title) => ({
  course: { id: 'c', title, description: '', objectives: [], category: 'Foundations', level: 'beginner', duration: '', perspective: '', author: '', organization: '', units: [{ id: 'u', title: 'U', lessonIds: ['l1', 'l2'] }], completion: { lessons: true, quizzes: false, attendance: 0 }, certificate: { enabled: false, instructor: '' }, status: 'draft', version: 0, origin: 'authored', role: 'instructor', createdAt: 1, updatedAt: 1 },
  lessons: [lesson('l1'), lesson('l2')],
})

;(async () => {
  const owner = await person('rowner')
  const teacher = await person('rteach')
  const instr = await person('rinstr')
  const leader = await person('rlead')
  const s = await Promise.all([1, 2, 3, 4].map((i) => person(`rs${i}`)))
  const org = (await owner.c.rpc('create_org', { p: { name: 'Report Church', kind: 'church', contact_email: 'r@example.org', display_name: 'Owner', adult: true } })).data
  const join = async (p, role, name) => {
    const inv = await owner.c.rpc('create_invitation', { o: org, p: { email: p.email, role } })
    await p.c.rpc('accept_invitation', { token: inv.data.token, display_name: name, adult: true })
  }
  await join(teacher, 'teacher', 'Teacher')
  await join(instr, 'instructor', 'Instructor')
  await join(leader, 'leader', 'Leader')
  for (let i = 0; i < s.length; i++) await join(s[i], 'member', `Student ${i + 1}`)
  // course A taught by the instructor: 4 enrolled, 1 withdraws, 1 completes, attendance 2 present of 3 recorded
  const A = (await teacher.c.rpc('create_org_course', { o: org, content: content('Course A') })).data
  await teacher.c.rpc('publish_org_course', { cid: A })
  await teacher.c.rpc('assign_instructor', { cid: A, u: instr.id, assign: true })
  await instr.c.rpc('enroll_members', { cid: A, users: s.map((x) => x.id) })
  const eid = async (p, cid) => (await p.c.from('org_enrollments').select('id').eq('course_id', cid).single()).data.id
  const e = await Promise.all(s.map((x) => eid(x, A)))
  await s[0].c.rpc('mark_lesson', { eid: e[0], lesson: 'l1', done: true })
  await s[0].c.rpc('mark_lesson', { eid: e[0], lesson: 'l2', done: true }) // completes
  await s[1].c.rpc('mark_lesson', { eid: e[1], lesson: 'l1', done: true })
  await s[3].c.rpc('withdraw_enrollment', { eid: e[3] })
  const w1 = (await s[0].c.rpc('save_written_answer', { eid: e[0], lesson: 'l1', kind: 'reflection', prompt: 'Why?', body: 'Because.' })).data
  await s[1].c.rpc('save_written_answer', { eid: e[1], lesson: 'l1', kind: 'reflection', prompt: 'Why?', body: 'Grace.' })
  await instr.c.rpc('grade_written_answer', { aid: w1, grade: 'complete', points: null, feedback: '' })
  const sess = (await instr.c.rpc('create_session', { cid: A, held_on: '2026-11-10', title: 'Week 1' })).data
  await instr.c.rpc('record_attendance', { sid: sess, eid: e[0], status: 'present' })
  await instr.c.rpc('record_attendance', { sid: sess, eid: e[1], status: 'late' })
  await instr.c.rpc('record_attendance', { sid: sess, eid: e[2], status: 'absent' })
  // course B, not taught by the instructor
  const B = (await teacher.c.rpc('create_org_course', { o: org, content: content('Course B') })).data
  await teacher.c.rpc('publish_org_course', { cid: B })
  await teacher.c.rpc('enroll_members', { cid: B, users: [s[0].id] })
  // a group led by the leader: 2 members, 1 study, 1 submission, 1 post; another group they do not lead
  const G = (await owner.c.rpc('save_group', { o: org, gid: null, p: { name: 'Romans study', leader: leader.id, discussions: true } })).data
  await leader.c.rpc('set_group_member', { gid: G, u: s[0].id, r: 'member' })
  await leader.c.rpc('set_group_member', { gid: G, u: s[1].id, r: 'member' })
  const st = (await leader.c.rpc('save_group_study', { gid: G, sid: null, p: { title: 'Romans 8', passage: 'Rom.8.1-Rom.8.39', status: 'assigned' } })).data
  await s[0].c.from('org_group_responses').insert({ study_id: st, user_id: s[0].id, reflection: 'x', status: 'submitted' })
  await s[1].c.from('org_group_responses').insert({ study_id: st, user_id: s[1].id, reflection: 'draft only', status: 'draft' })
  const T = (await leader.c.rpc('create_topic', { gid: G, title: 'Talk' })).data
  await s[0].c.from('org_discussion_posts').insert({ topic_id: T, author_id: s[0].id, body: 'Hello' })
  await owner.c.rpc('save_group', { o: org, gid: null, p: { name: 'Elders' } })
  // private personal data that must never appear
  await s[0].c.rpc('sync_push', { device: 'd', changes: [{ kind: 'notes', id: 'n', base: 0, data: { id: 'n', text: 'SECRET PERSONAL NOTE' } }] })

  const browser = await chromium.launch()
  const errors = []
  const open = async (p) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true })
    const pg = await ctx.newPage()
    pg.on('pageerror', (x) => errors.push(x.message))
    await signIn(pg, p)
    await pg.goto(`${BASE}/church/${org}?tab=reports`, { waitUntil: 'networkidle' })
    return pg
  }

  console.log('1. The owner sees the whole workspace')
  const op = await open(owner)
  await op.getByTestId('course-report').waitFor()
  const rowA = await op.getByTestId('course-report').locator('tr', { hasText: 'Course A' }).innerText()
  check('Course A: 4 enrolled (1 withdrew), 1 completed of 3 (33%)', /4\s*\(1 withdrew\)/.test(rowA) && /1\s*\(33%\)/.test(rowA), rowA)
  check('Course A: average lessons done 1 of 2, written 2 (1 graded), attendance 67% over 1 session', /1 of 2/.test(rowA) && /2 \(1\)/.test(rowA) && /67%/.test(rowA) && /over 1 session/.test(rowA), rowA)
  check('the owner sees both courses', /Course B/.test(await op.getByTestId('course-report').innerText()))
  const rowG = await op.getByTestId('group-report').locator('tr', { hasText: 'Romans study' }).innerText()
  check('group participation counts only submitted responses: 1 of 2 (50%), 1 post', /\b2\b[\s\S]*\b1\b[\s\S]*\b1\b[\s\S]*50%[\s\S]*\b1\b/.test(rowG), rowG)
  const [dl] = await Promise.all([op.waitForEvent('download'), op.getByTestId('courses-csv').click()])
  const text = fs.readFileSync(await dl.path(), 'utf8')
  check('the course spreadsheet downloads with headers and both courses', /^﻿"Course","Status"/.test(text) && /"Course A","published","1","4","2","1","1","33"/.test(text) && /"Course B"/.test(text), text.slice(0, 300))
  const [dl2] = await Promise.all([op.waitForEvent('download'), op.getByTestId('groups-csv').click()])
  check('the group spreadsheet downloads', /"Romans study","2","1","1","50","1"/.test(fs.readFileSync(await dl2.path(), 'utf8')))
  check('reports contain no personal notes or drafts', !/SECRET PERSONAL NOTE|draft only/.test(text + (await op.locator('main').innerText())))

  console.log('2. An instructor sees only their course; a group leader only their group')
  const ip = await open(instr)
  await ip.getByTestId('course-report').waitFor()
  const it = await ip.locator('main').innerText()
  check('the instructor sees Course A only', /Course A/.test(it) && !/Course B/.test(it), it.slice(0, 300))
  check('and no groups', /No groups to report on/.test(it))
  const lp = await open(leader)
  await lp.getByTestId('group-report').waitFor()
  const lt = await lp.locator('main').innerText()
  check('the leader sees their group only', /Romans study/.test(lt) && !/Elders/.test(lt) && /No courses to report on/.test(lt), lt.slice(0, 300))

  console.log('3. Members have no reports')
  const mp = await open(s[2])
  check('a member has no Reports section', (await mp.getByRole('tab', { name: 'Reports' }).count()) === 0)
  check('no script errors', !errors.length, errors.join(' | '))
  await browser.close()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('Failed:\n - ' + failures.join('\n - '))
    process.exit(1)
  }
})().catch((x) => {
  console.error(x)
  process.exit(1)
})
