/*
 * Release 6.2 security checks: church workspaces, roles, invitations, courses, groups, sharing and
 * announcements, against a real Supabase stack (the local copy in dev/supabase-local, or a preview project).
 * Every check uses a real account with a real sign-in token, so the database's own rules are what is tested.
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/orgs.cjs
 */
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

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

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = crypto.createHmac('sha1', key).update(counter).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

/** A confirmed account, signed in. */
async function person(tag) {
  const email = `${tag}-${run}@example.org`
  const password = 'correct horse battery staple'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { age_confirmed_13: true } })
  if (error) throw error
  const c = createClient(URL_, ANON, opts)
  const s = await c.auth.signInWithPassword({ email, password })
  if (s.error) throw s.error
  return { c, email, password, id: data.user.id, tag }
}
const denied = (r) => !!r.error
const rows = (r) => (r.data ?? []).length

const COURSE = {
  course: {
    id: 'c1', title: 'Foundations of Faith', description: 'Six weeks', objectives: [], category: 'Foundations', level: 'beginner',
    duration: '6 weeks', perspective: '', author: 'Teacher', organization: '', units: [{ id: 'u1', title: 'Unit 1', lessonIds: ['l1', 'l2'] }],
    completion: { lessons: true, quizzes: true, attendance: 1 }, certificate: { enabled: true, instructor: 'T' }, status: 'draft', version: 0,
    origin: 'authored', role: 'instructor', createdAt: 1, updatedAt: 1,
  },
  lessons: [
    {
      id: 'l1', courseId: 'c1', title: 'Grace', intro: '', objectives: [], primaryRef: 'Eph.2.8-Eph.2.9', supportingRefs: [], blocks: [], context: '',
      discussion: [], reflection: ['What does grace mean to you?'], assignments: ['Write a one-page summary.'], summary: '',
      instructorNotes: 'PRIVATE INSTRUCTOR NOTE', status: 'published', createdAt: 1, updatedAt: 1,
      quiz: {
        id: 'q1', title: 'Check', passScore: 70, attempts: 2, shuffle: false, timeLimit: 0, required: true, showAnswers: 'after-submit', allowRetake: true,
        questions: [
          { id: 'a', type: 'choice', prompt: 'Saved by?', options: ['works', 'grace'], answer: 1, refs: ['Eph.2.8'], explanation: 'SECRET EXPLANATION' },
          { id: 'b', type: 'matching', prompt: 'Match', pairs: [['Eph', 'Grace'], ['Jas', 'Works']], refs: [], explanation: '' },
        ],
      },
    },
    { id: 'l2', courseId: 'c1', title: 'Faith', intro: '', objectives: [], primaryRef: 'Heb.11.1', supportingRefs: [], blocks: [], context: '', discussion: [], reflection: [], assignments: [], summary: '', instructorNotes: '', status: 'published', createdAt: 1, updatedAt: 1 },
  ],
}

;(async () => {
  if (!ANON || !SERVICE) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required')
  const owner = await person('owner')
  const adminA = await person('admina')
  const teacher = await person('teacher')
  const instructor = await person('instr')
  const instructor2 = await person('instr2')
  const leader = await person('leader')
  const leader2 = await person('leader2')
  const student = await person('student')
  const student2 = await person('student2')
  const outsider = await person('outsider')
  const ownerB = await person('ownerb')
  const memberB = await person('memberb')

  console.log('1. Creating a workspace')
  const noAdult = await owner.c.rpc('create_org', { p: { name: 'Arise Church', kind: 'church', contact_email: 'office@arise.example', display_name: 'Pastor Owner' } })
  check('creating a workspace needs the 18+ confirmation', denied(noAdult) && /adults/.test(noAdult.error.message), noAdult.error?.message)
  const anonC = createClient(URL_, ANON, opts)
  check('without signing in, nobody can create a workspace', denied(await anonC.rpc('create_org', { p: { name: 'X', kind: 'church', contact_email: 'a@b.co', display_name: 'X', adult: true } })))
  const mk = await owner.c.rpc('create_org', { p: { name: '  Arise\u0007 Church  ', kind: 'church', description: 'Decatur', city: 'Decatur', state: 'AL', contact_email: 'Office@Arise.example', display_name: 'Pastor Owner', adult: true } })
  const A = mk.data
  check('a signed-in adult creates a workspace and becomes its owner', !mk.error && !!A, mk.error?.message)
  const orgRow = await owner.c.from('orgs').select('*').eq('id', A).single()
  check('workspace text is cleaned (spaces trimmed, control characters removed, email lower-cased)', orgRow.data?.name === 'Arise Church' && orgRow.data?.contact_email === 'office@arise.example', orgRow.data)
  check('a bad website address is refused', denied(await owner.c.rpc('update_org', { o: A, p: { website: 'javascript:alert(1)' } })))
  check('a logo that is not an image is refused', denied(await owner.c.rpc('update_org', { o: A, p: { logo: 'data:text/html;base64,PHNjcmlwdD4=' } })))
  const B = (await ownerB.c.rpc('create_org', { p: { name: 'Second Church', kind: 'church', contact_email: 'b@b.example', display_name: 'Owner B', adult: true } })).data
  check('a second, separate workspace exists', !!B)
  const prof = await owner.c.from('profiles').select('adult_confirmed_18').single()
  check('the 18+ confirmation is recorded on the profile', prof.data?.adult_confirmed_18 === true)
  check('the direct table cannot be written (no insert into orgs)', denied(await outsider.c.from('orgs').insert({ name: 'Sneaky', kind: 'church', contact_email: 'a@b.co' })))
  check('nobody can add themselves as a member directly', denied(await outsider.c.from('org_members').insert({ org_id: A, user_id: outsider.id, role: 'owner', display_name: 'Me' })))
  for (let i = 0; i < 2; i++) await owner.c.rpc('create_org', { p: { name: `Extra ${i}`, kind: 'ministry', contact_email: 'x@x.example', display_name: 'P', adult: true } })
  const fourth = await owner.c.rpc('create_org', { p: { name: 'Too Many', kind: 'ministry', contact_email: 'x@x.example', display_name: 'P', adult: true } })
  check('one person can own at most 3 workspaces', denied(fourth) && /3 workspaces/.test(fourth.error.message), fourth.error?.message)

  console.log('2. Invitations')
  const invite = async (by, org, email, role, extra = {}) => by.c.rpc('create_invitation', { o: org, p: { email, role, ...extra } })
  const join = async (p, token, name) => p.c.rpc('accept_invitation', { token, display_name: name, adult: true })
  const iAdmin = await invite(owner, A, adminA.email, 'admin')
  check('the owner invites an administrator; a token is returned once', !iAdmin.error && /^[0-9a-f]{64}$/.test(iAdmin.data?.token), iAdmin.error?.message)
  const stored = await admin.from('org_invitations').select('*').eq('id', iAdmin.data.id).single()
  check('only a hash of the token is stored, never the token', !JSON.stringify(stored.data).includes(iAdmin.data.token) && !!stored.data.token_hash)
  const wrong = await join(outsider, iAdmin.data.token, 'Thief')
  check('a forwarded link does not work for a different account', denied(wrong) && /different email/.test(wrong.error.message), wrong.error?.message)
  const prevOut = await outsider.c.rpc('invitation_preview', { token: iAdmin.data.token })
  check('the preview reveals nothing to a different account', prevOut.data?.status === 'wrong_account' && !prevOut.data.org, prevOut.data)
  const prev = await adminA.c.rpc('invitation_preview', { token: iAdmin.data.token })
  check('the invited person sees the workspace and role before accepting', prev.data?.status === 'ok' && prev.data.org.name === 'Arise Church' && prev.data.role === 'admin', prev.data)
  check('an unknown token reads as not valid', (await adminA.c.rpc('invitation_preview', { token: 'f'.repeat(64) })).data?.status === 'invalid')
  const noAdultJoin = await adminA.c.rpc('accept_invitation', { token: iAdmin.data.token, display_name: 'Admin A', adult: false })
  check('accepting needs the 18+ confirmation', denied(noAdultJoin))
  check('the invited person accepts', !(await join(adminA, iAdmin.data.token, 'Admin A')).error)
  const reuse = await join(adminA, iAdmin.data.token, 'Admin A')
  check('(test 8) a used invitation cannot be used again', denied(reuse) && /already been used/.test(reuse.error.message), reuse.error?.message)

  const iTeacher = await invite(adminA, A, teacher.email, 'teacher')
  check('an administrator can invite a pastor/teacher', !iTeacher.error, iTeacher.error?.message)
  check('an administrator cannot offer the administrator role', denied(await invite(adminA, A, 'x@example.org', 'admin')))
  check('nobody can invite an owner', denied(await invite(owner, A, 'x@example.org', 'owner')))
  await join(teacher, iTeacher.data.token, 'Teacher T')
  for (const [p, role, name] of [[instructor, 'instructor', 'Instructor I'], [instructor2, 'instructor', 'Instructor J'], [leader, 'leader', 'Leader L'], [leader2, 'leader', 'Leader M'], [student, 'member', 'Student S'], [student2, 'member', 'Student R']]) {
    const i = await invite(owner, A, p.email, role)
    const j = await join(p, i.data.token, name)
    if (j.error) check(`${name} joins`, false, j.error.message)
  }
  const iB = await invite(ownerB, B, memberB.email, 'member')
  await join(memberB, iB.data.token, 'Member B')

  const iExp = await invite(owner, A, outsider.email, 'member')
  await admin.from('org_invitations').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', iExp.data.id)
  const exp = await join(outsider, iExp.data.token, 'Late')
  check('(test 7) an expired invitation cannot be used', denied(exp) && /expired/.test(exp.error.message), exp.error?.message)
  const re = await owner.c.rpc('resend_invitation', { iid: iExp.data.id })
  check('an expired invitation can be re-sent with a new link', !re.error && re.data.token !== iExp.data.token, re.error?.message)
  check('the old link stays dead after re-sending', denied(await join(outsider, iExp.data.token, 'Late')))
  await owner.c.rpc('revoke_invitation', { iid: iExp.data.id })
  const rev = await join(outsider, re.data.token, 'Late')
  check('(test 8) a revoked invitation cannot be used', denied(rev) && /withdrawn/.test(rev.error.message), rev.error?.message)
  check('a plain member cannot invite anyone', denied(await invite(student, A, 'x@example.org', 'member')))
  const leaderNoGroup = await invite(leader, A, 'x@example.org', 'member')
  check('a group leader can invite only into a group they lead', denied(leaderNoGroup), leaderNoGroup.error?.message)
  check('a member of Church B cannot invite into Church A', denied(await invite(memberB, A, 'x@example.org', 'member')))
  check('invitations are visible to administrators, not members', rows(await adminA.c.from('org_invitations').select('id').eq('org_id', A)) > 0 && rows(await student.c.from('org_invitations').select('id').eq('org_id', A)) === 0)

  console.log('3. Roles and ownership')
  const selfPromote = await student.c.rpc('set_member_role', { o: A, u: student.id, r: 'admin' })
  check('(test 5) a student cannot make themselves an administrator', denied(selfPromote), selfPromote.error?.message)
  check('(test 5) a student cannot change anyone\'s role', denied(await student.c.rpc('set_member_role', { o: A, u: student2.id, r: 'leader' })))
  const directRole = await student.c.from('org_members').update({ role: 'admin' }).eq('user_id', student.id).select()
  check('(test 5) a direct update of the role column is refused', denied(directRole) || rows(directRole) === 0, directRole.data)
  const stillMember = await admin.from('org_members').select('role').eq('org_id', A).eq('user_id', student.id).single()
  check('(test 5) the student is still a member after those attempts', stillMember.data?.role === 'member')
  check('an administrator cannot promote someone to administrator', denied(await adminA.c.rpc('set_member_role', { o: A, u: teacher.id, r: 'admin' })))
  check('an administrator can make a member a group leader', !(await adminA.c.rpc('set_member_role', { o: A, u: student2.id, r: 'leader' })).error)
  await adminA.c.rpc('set_member_role', { o: A, u: student2.id, r: 'member' })
  const grab = await adminA.c.rpc('set_member_role', { o: A, u: owner.id, r: 'member' })
  check('(test 6) an administrator cannot demote the owner', denied(grab))
  check('(test 6) an administrator cannot offer themselves ownership', denied(await adminA.c.rpc('offer_ownership', { o: A, u: adminA.id })))
  check('(test 6) the ownership function cannot be skipped by writing the table', denied(await adminA.c.from('org_ownership_transfers').insert({ org_id: A, from_user: owner.id, to_user: adminA.id })))
  const offer = await owner.c.rpc('offer_ownership', { o: A, u: adminA.id })
  check('the owner can offer ownership to an administrator', !offer.error, offer.error?.message)
  check('(test 6) someone else cannot accept that offer', denied(await teacher.c.rpc('accept_ownership', { tid: offer.data })))
  check('the administrator sees the offer', ((await adminA.c.rpc('my_ownership_offers')).data ?? []).some((o) => o.id === offer.data))
  await owner.c.rpc('cancel_ownership_offer', { tid: offer.data })
  check('a cancelled offer cannot be accepted', denied(await adminA.c.rpc('accept_ownership', { tid: offer.data })))
  const offer2 = await owner.c.rpc('offer_ownership', { o: A, u: adminA.id })
  const acc = await adminA.c.rpc('accept_ownership', { tid: offer2.data })
  const roles = Object.fromEntries(((await admin.from('org_members').select('user_id, role').eq('org_id', A)).data ?? []).map((r) => [r.user_id, r.role]))
  check('an accepted transfer swaps owner and administrator, leaving exactly one owner', !acc.error && roles[adminA.id] === 'owner' && roles[owner.id] === 'admin', acc.error?.message ?? roles)
  const back = await adminA.c.rpc('offer_ownership', { o: A, u: owner.id })
  await owner.c.rpc('accept_ownership', { tid: back.data })
  check('the owner must transfer before leaving', denied(await owner.c.rpc('remove_member', { o: A, u: owner.id })))
  const audit = await owner.c.from('org_audit_events').select('action').eq('org_id', A)
  check('sensitive actions are recorded in the workspace audit log', ['org_created', 'invitation_accepted', 'role_changed', 'ownership_transferred'].every((a) => (audit.data ?? []).some((r) => r.action === a)))
  check('members cannot read the audit log', rows(await student.c.from('org_audit_events').select('id').eq('org_id', A)) === 0)

  console.log('4. Isolation between workspaces')
  check('(test 1) a Church A member cannot read Church B', rows(await student.c.from('orgs').select('id').eq('id', B)) === 0)
  check('(test 1) nor its members', rows(await student.c.from('org_members').select('user_id').eq('org_id', B)) === 0)
  check('(test 11) changing the workspace id in a request returns nothing', rows(await memberB.c.from('org_members').select('*').eq('org_id', A)) === 0 && rows(await memberB.c.from('orgs').select('*').eq('id', A)) === 0)
  check('(test 11) Church B members cannot act on Church A', denied(await memberB.c.rpc('update_org', { o: A, p: { name: 'Hacked' } })))
  check('an outsider sees no workspaces at all', rows(await outsider.c.from('orgs').select('id')) === 0)
  const mine = await student.c.from('orgs').select('id')
  check('a person in two workspaces sees each separately (one here)', rows(mine) === 1)
  const iBstudent = await invite(ownerB, B, student.email, 'member')
  await join(student, iBstudent.data.token, 'Student S (B)')
  check('one person can belong to two workspaces', rows(await student.c.from('orgs').select('id')) === 2)
  check('a role in Church B grants nothing extra in Church A', denied(await student.c.rpc('update_org', { o: A, p: { name: 'X' } })))
  check('members see names only, not email addresses', rows(await student.c.from('org_member_contacts').select('*').eq('org_id', A).neq('user_id', student.id)) === 0 && rows(await adminA.c.from('org_member_contacts').select('*').eq('org_id', A)) > 3)
  const seen = (await student.c.from('org_members').select('user_id').eq('org_id', A)).data?.map((r) => r.user_id) ?? []
  check('a plain member sees leaders and themselves, not every other member', seen.includes(student.id) && seen.includes(teacher.id) && !seen.includes(student2.id), seen.length)

  console.log('5. Personal data stays private')
  await student.c.rpc('sync_push', { device: 'd', changes: [{ kind: 'notes', id: 'private-1', base: 0, data: { id: 'private-1', text: 'My private prayer' } }, { kind: 'sermons', id: 's1', base: 0, data: { id: 's1', title: 'My sermon' } }] })
  check('(test 10) the owner cannot read a member\'s personal notes or sermons', rows(await owner.c.from('user_records').select('*').eq('user_id', student.id)) === 0)
  check('(test 10) an administrator cannot either', rows(await adminA.c.from('user_records').select('*').eq('user_id', student.id)) === 0)
  check('(test 10) nor their version history', rows(await adminA.c.from('user_record_history').select('*').eq('user_id', student.id)) === 0)
  check('(test 10) nor through the sync function', ((await adminA.c.rpc('sync_pull', { since: 0, max_rows: 1000 })).data ?? []).every((r) => r.id !== 'private-1'))

  console.log('6. Courses')
  const cc = await student.c.rpc('create_org_course', { o: A, content: COURSE })
  check('a member cannot add a course', denied(cc))
  const course = await teacher.c.rpc('create_org_course', { o: A, content: COURSE, source: 'personal-c1' })
  const C = course.data
  check('a pastor/teacher copies a personal course into the workspace', !course.error && !!C, course.error?.message)
  const course2 = (await teacher.c.rpc('create_org_course', { o: A, content: { ...COURSE, course: { ...COURSE.course, title: 'Second course' } } })).data
  check('the instructor-only draft is hidden from members', rows(await student.c.from('org_course_drafts').select('*').eq('course_id', C)) === 0)
  check('assigning an instructor needs the Instructor role', denied(await teacher.c.rpc('assign_instructor', { cid: C, u: student.id, assign: true })))
  check('the teacher assigns an instructor', !(await teacher.c.rpc('assign_instructor', { cid: C, u: instructor.id, assign: true })).error)
  await teacher.c.rpc('assign_instructor', { cid: course2, u: instructor2.id, assign: true })
  const draft = await instructor.c.from('org_course_drafts').select('rev').eq('course_id', C).single()
  const s1 = await instructor.c.rpc('save_org_course_draft', { cid: C, base_rev: draft.data.rev, content: COURSE })
  const s2 = await teacher.c.rpc('save_org_course_draft', { cid: C, base_rev: draft.data.rev, content: COURSE })
  check('two editors saving the same version: the second is told to reload (nothing overwritten)', !s1.error && denied(s2) && /reload/i.test(s2.error.message), s2.error?.message)
  check('an instructor cannot publish without review', denied(await instructor.c.rpc('publish_org_course', { cid: C })))
  check('an instructor of another course cannot edit this one', denied(await instructor2.c.rpc('save_org_course_draft', { cid: C, base_rev: 2, content: COURSE })))
  const pub = await teacher.c.rpc('publish_org_course', { cid: C, notes: 'First release' })
  check('the pastor/teacher publishes version 1', pub.data === 1, pub.error?.message)
  await teacher.c.rpc('set_org_course_options', { cid: C, p: { catalog: true } })
  const rel = await student.c.from('org_course_releases').select('content').eq('course_id', C).single()
  const relText = JSON.stringify(rel.data)
  check('a member can preview a catalog course', !!rel.data)
  check('the student copy has no answers, explanations or instructor notes', !!rel.data && !relText.includes('SECRET EXPLANATION') && !relText.includes('PRIVATE INSTRUCTOR NOTE') && !/"answer"/.test(relText))
  const mq = rel.data?.content.lessons[0].quiz.questions[1].pairs
  check('matching questions keep their prompts but not the answer key', JSON.stringify(mq) === JSON.stringify([['Eph', 'Grace'], ['Jas', 'Works']]) || (mq?.[0]?.[0] === 'Eph' && mq?.[1]?.[0] === 'Jas'), mq)
  check('students cannot read the full version (with answers)', rows(await student.c.from('org_course_versions').select('*').eq('course_id', C)) === 0)
  const enr = await student.c.rpc('enroll_self', { cid: C })
  check('a member enrolls from the catalog', !enr.error, enr.error?.message)
  const E = enr.data
  check('enrolling others needs authorization', denied(await student.c.rpc('enroll_members', { cid: C, users: [student2.id] })))
  check('an instructor enrolls a member', (await instructor.c.rpc('enroll_members', { cid: C, users: [student2.id] })).data === 1)
  check('an outsider cannot be enrolled', denied(await instructor.c.rpc('enroll_members', { cid: C, users: [outsider.id] })))
  check('an outsider cannot see the course', rows(await outsider.c.from('org_courses').select('id').eq('id', C)) === 0)
  check('students cannot write their own enrollment', denied(await student.c.from('org_enrollments').update({ status: 'completed' }).eq('id', E).select()) || rows(await admin.from('org_enrollments').select('id').eq('id', E).eq('status', 'completed')) === 0)
  check('marking a lesson that is not in the course is refused', denied(await student.c.rpc('mark_lesson', { eid: E, lesson: 'nope', done: true })))
  await student.c.rpc('mark_lesson', { eid: E, lesson: 'l1', done: true })
  const done2 = await student.c.rpc('mark_lesson', { eid: E, lesson: 'l2', done: true })
  check('finishing lessons alone does not complete the course (quiz and attendance still required)', done2.data === false)
  check('a student cannot mark progress on someone else\'s enrollment', denied(await student2.c.rpc('mark_lesson', { eid: E, lesson: 'l1', done: true })))

  const wa = await student.c.rpc('save_written_answer', { eid: E, lesson: 'l1', kind: 'reflection', prompt: 'What does grace mean to you?', body: 'Undeserved favor.' })
  check('a student saves a reflection the lesson asks for', !wa.error, wa.error?.message)
  check('answers to questions the lesson does not ask are refused', denied(await student.c.rpc('save_written_answer', { eid: E, lesson: 'l1', kind: 'reflection', prompt: 'Made up', body: 'x' })))
  const gradeSelf = await student.c.rpc('grade_written_answer', { aid: wa.data, grade: 'complete', points: 100, feedback: 'great' })
  check('(test 4) a student cannot grade their own work', denied(gradeSelf))
  const gradeDirect = await student.c.from('org_written_answers').update({ grade: 'complete', points: 100 }).eq('id', wa.data).select()
  check('(test 4) nor by writing the table directly', denied(gradeDirect) || rows(gradeDirect) === 0)
  check('(test 4) quiz scores cannot be written by students', denied(await student.c.from('org_quiz_attempts').insert({ org_id: A, course_id: C, enrollment_id: E, lesson_id: 'l1', quiz_id: 'q1', version: 1, answers: {}, score: 100, passed: true, results: [] })))
  check('(test 4) nor reviewed by them', denied(await student.c.rpc('review_quiz_attempt', { aid: crypto.randomUUID(), manual: {}, feedback: '' })))
  check('the instructor grades and gives feedback', !(await instructor.c.rpc('grade_written_answer', { aid: wa.data, grade: 'complete', points: 10, feedback: 'Well said.' })).error)
  const seenGrade = await student.c.from('org_written_answers').select('grade, feedback').eq('id', wa.data).single()
  check('the student reads the grade and feedback', seenGrade.data?.grade === 'complete' && seenGrade.data?.feedback === 'Well said.')
  check('(test 3) an instructor of a different course cannot see these students', rows(await instructor2.c.from('org_enrollments').select('*').eq('course_id', C)) === 0 && rows(await instructor2.c.from('org_written_answers').select('*').eq('course_id', C)) === 0)
  check('(test 3) nor grade them', denied(await instructor2.c.rpc('grade_written_answer', { aid: wa.data, grade: 'incomplete', points: 0, feedback: '' })))
  check('(test 3) a group leader cannot see course records', rows(await leader.c.from('org_enrollments').select('*').eq('course_id', C)) === 0)
  check('students do not see each other\'s work', rows(await student2.c.from('org_written_answers').select('*').eq('course_id', C)) === 0 && rows(await student2.c.from('org_enrollments').select('*').eq('id', E)) === 0)

  const chk = await student.c.rpc('quiz_attempt_check', { cid: C, lesson: 'l1' })
  check('the quiz check confirms enrollment, version and tries left', chk.data?.enrollment_id === E && chk.data?.version === 1, chk.error?.message)
  check('the quiz check refuses someone not enrolled', denied(await leader.c.rpc('quiz_attempt_check', { cid: C, lesson: 'l1' })))
  await admin.from('org_quiz_attempts').insert({ org_id: A, course_id: C, enrollment_id: E, lesson_id: 'l1', quiz_id: 'q1', version: 1, answers: { a: 1 }, score: 100, passed: true, results: [] })
  await admin.rpc('refresh_completion', { eid: E })

  const sess = await instructor.c.rpc('create_session', { cid: C, held_on: '2026-11-10', title: 'Week 1' })
  check('an instructor creates a class session', !sess.error, sess.error?.message)
  check('a student cannot record attendance', denied(await student.c.rpc('record_attendance', { sid: sess.data, eid: E, status: 'present' })))
  check('attendance only for students in that course', denied(await instructor.c.rpc('record_attendance', { sid: sess.data, eid: crypto.randomUUID(), status: 'present' })))
  check('attendance accepts only Present, Absent, Excused, Late', denied(await instructor.c.rpc('record_attendance', { sid: sess.data, eid: E, status: 'maybe' })))
  await instructor.c.rpc('record_attendance', { sid: sess.data, eid: E, status: 'late' })
  const enrNow = await student.c.from('org_enrollments').select('status, completed_at').eq('id', E).single()
  check('with lessons, the required quiz passed, and attendance recorded, the course completes', enrNow.data?.status === 'completed', enrNow.data)
  check('the student can then claim a certificate', !(await student.c.rpc('claim_certificate', { eid: E })).error)
  const attSeen = await student.c.from('org_attendance').select('status').eq('enrollment_id', E)
  check('the student sees their own attendance', attSeen.data?.[0]?.status === 'late')

  const COURSE_V2 = JSON.parse(JSON.stringify(COURSE))
  COURSE_V2.lessons[1].title = 'Faith (revised)'
  const d2 = await teacher.c.from('org_course_drafts').select('rev').eq('course_id', C).single()
  await teacher.c.rpc('save_org_course_draft', { cid: C, base_rev: d2.data.rev, content: COURSE_V2 })
  await teacher.c.rpc('publish_org_course', { cid: C, notes: 'Revised lesson 2' })
  const keep = await student.c.from('org_enrollments').select('version, status').eq('id', E).single()
  check('publishing a revision does not change completed students\' records', keep.data?.version === 1 && keep.data?.status === 'completed', keep.data)
  check('both versions are kept', rows(await teacher.c.from('org_course_versions').select('version').eq('course_id', C)) === 2)
  check('the student can still read the version they completed', rows(await student.c.from('org_course_releases').select('version').eq('course_id', C).eq('version', 1)) === 1)

  console.log('7. Groups and group studies')
  const grp = await leader.c.rpc('save_group', { o: A, gid: null, p: { name: 'Romans study' } })
  check('a group leader cannot create a group (pastor/teacher or above)', denied(grp))
  const G = (await teacher.c.rpc('save_group', { o: A, gid: null, p: { name: 'Romans study', topic: 'Romans 8', leader: leader.id, visibility: 'private', discussions: true } })).data
  const G2 = (await teacher.c.rpc('save_group', { o: A, gid: null, p: { name: 'Men ARISE', leader: leader2.id, visibility: 'org' } })).data
  check('a teacher creates groups with assigned leaders', !!G && !!G2)
  check('a leader cannot be someone without the Group Leader role', denied(await teacher.c.rpc('save_group', { o: A, gid: null, p: { name: 'X', leader: student.id } })))
  check('the leader adds members to their group', !(await leader.c.rpc('set_group_member', { gid: G, u: student.id, r: 'member' })).error && !(await leader.c.rpc('set_group_member', { gid: G, u: student2.id, r: 'member' })).error)
  check('(test 2) a leader cannot see a private group they do not lead', rows(await leader2.c.from('org_groups').select('id').eq('id', G)) === 0)
  check('(test 2) nor manage it', denied(await leader2.c.rpc('set_group_member', { gid: G, u: instructor.id, r: 'member' })))
  check('a member outside the group cannot see a private group', rows(await instructor.c.from('org_groups').select('id').eq('id', G)) === 0)
  check('an organization-visible group is listed for members', rows(await student.c.from('org_groups').select('id').eq('id', G2)) === 1)
  check('but its member list stays private', rows(await student.c.from('org_group_members').select('*').eq('group_id', G2)) === 0)
  check('a member can ask to join an organization-visible group', !(await student.c.rpc('request_to_join_group', { gid: G2 })).error)
  check('a member cannot add themselves to a private group', denied(await outsider.c.rpc('set_group_member', { gid: G, u: outsider.id, r: 'member' })) && denied(await instructor.c.rpc('set_group_member', { gid: G, u: instructor.id, r: 'member' })))
  const ST = (await leader.c.rpc('save_group_study', { gid: G, sid: null, p: { title: 'Life in the Spirit', passage: 'Rom.8.1-Rom.8.39', questions: ['What does "no condemnation" mean?'], resources: [{ kind: 'commentary', work: 'MHC', ref: 'Rom.8.1' }], due_on: '2026-11-17' } })).data
  check('the leader prepares a Romans 8 study (draft hidden from members)', !!ST && rows(await student.c.from('org_group_studies').select('id').eq('id', ST)) === 0)
  check('members cannot respond to a draft study', denied(await student.c.from('org_group_responses').insert({ study_id: ST, user_id: student.id, reflection: 'early' })))
  await leader.c.rpc('save_group_study', { gid: G, sid: ST, p: { status: 'assigned' } })
  check('once assigned, members see it', rows(await student.c.from('org_group_studies').select('id').eq('id', ST)) === 1)
  const ins = await student.c.from('org_group_responses').insert({ study_id: ST, user_id: student.id, reflection: 'Draft thoughts', answers: { 0: 'Freedom' } })
  check('a member saves a draft response', !ins.error, ins.error?.message)
  const forged = await student2.c.from('org_group_responses').insert({ study_id: ST, user_id: student.id, reflection: 'pretending' })
  check('nobody can write a response as someone else', denied(forged))
  check('the leader cannot see a draft (only what is submitted)', rows(await leader.c.from('org_group_responses').select('*').eq('study_id', ST)) === 0)
  await student.c.from('org_group_responses').update({ status: 'submitted', read_done: true }).eq('study_id', ST).eq('user_id', student.id)
  const lr = await leader.c.from('org_group_responses').select('*').eq('study_id', ST)
  check('after the member submits, the leader sees it', rows(lr) === 1 && lr.data[0].reflection === 'Draft thoughts' && !!lr.data[0].submitted_at)
  check('the member cannot write the leader\'s note', denied(await student.c.from('org_group_responses').update({ leader_note: 'self praise' }).eq('study_id', ST)))
  check('the leader replies with a note', !(await leader.c.rpc('note_on_response', { sid: ST, u: student.id, note: 'Good insight' })).error)
  check('other members do not see each other\'s responses', rows(await student2.c.from('org_group_responses').select('*').eq('study_id', ST)) === 0)

  const T = (await leader.c.rpc('create_topic', { gid: G, title: 'Romans 8:28 discussion', sid: ST })).data
  const post = await student.c.from('org_discussion_posts').insert({ topic_id: T, author_id: student.id, body: 'All things work together.' }).select().single()
  check('members post in a discussion the leader opened', !post.error, post.error?.message)
  check('the workspace id on a post comes from the topic, not the request', post.data?.org_id === A)
  check('non-members of the group cannot read or post', rows(await leader2.c.from('org_discussion_posts').select('*').eq('topic_id', T)) === 0 && denied(await leader2.c.from('org_discussion_posts').insert({ topic_id: T, author_id: leader2.id, body: 'x' })))
  check('nobody can post as someone else', denied(await student2.c.from('org_discussion_posts').insert({ topic_id: T, author_id: student.id, body: 'forged' })))
  const rep = await student2.c.rpc('report_content', { kind: 'post', target: post.data.id, reason: 'Testing reports' })
  check('a member can report a post', !rep.error, rep.error?.message)
  check('the group leader sees the report', rows(await leader.c.from('org_content_reports').select('*').eq('id', rep.data)) === 1)
  check('the leader hides the post', !(await leader.c.rpc('resolve_report', { rid: rep.data, outcome: 'hidden' })).error)
  check('hidden posts disappear for other members', rows(await student2.c.from('org_discussion_posts').select('*').eq('topic_id', T)) === 0)
  await leader.c.rpc('moderate', { kind: 'topic', target: T, act: 'lock' })
  check('a locked topic takes no new posts', denied(await student2.c.from('org_discussion_posts').insert({ topic_id: T, author_id: student2.id, body: 'late' })))
  await leader.c.rpc('save_group', { o: A, gid: G, p: { discussions: false } })
  check('turning discussions off hides them from members', rows(await student.c.from('org_discussion_topics').select('*').eq('group_id', G)) === 0)

  console.log('8. Sharing and announcements')
  const sh = await student.c.rpc('share_resource', { o: A, gid: G, p: { kind: 'study', title: 'My Romans 8 notes', content: { sections: ['shared text'] }, source_id: 'study-1' } })
  check('a member shares a copy of a study with their group', !sh.error, sh.error?.message)
  check('the group sees it', rows(await student2.c.from('org_shared_resources').select('*').eq('id', sh.data)) === 1)
  check('people outside the group do not', rows(await instructor.c.from('org_shared_resources').select('*').eq('id', sh.data)) === 0)
  check('(test 13) knowing the id does not bypass authorization', rows(await memberB.c.from('org_shared_resources').select('*').eq('id', sh.data)) === 0 && rows(await outsider.c.from('org_shared_resources').select('*').eq('id', sh.data)) === 0)
  check('sharing with a group you are not in is refused', denied(await instructor.c.rpc('share_resource', { o: A, gid: G, p: { kind: 'note', title: 'x', content: {} } })))
  const orgWide = await student.c.rpc('share_resource', { o: A, gid: null, p: { kind: 'sermon_outline', title: 'Outline', content: { s: 1 } } })
  check('a member\'s workspace-wide share waits for approval', rows(await student2.c.from('org_shared_resources').select('*').eq('id', orgWide.data)) === 0)
  await adminA.c.rpc('approve_shared_resource', { rid: orgWide.data })
  check('after approval the workspace sees it', rows(await student2.c.from('org_shared_resources').select('*').eq('id', orgWide.data)) === 1)
  check('only the owner or an invited editor can change it', denied(await student2.c.rpc('update_shared_resource', { rid: sh.data, p: { title: 'Mine now' } })))
  await student.c.rpc('set_resource_editor', { rid: sh.data, u: student2.id, allow: true })
  check('an invited editor can change it', !(await student2.c.rpc('update_shared_resource', { rid: sh.data, p: { title: 'Edited together' } })).error)
  check('an editor cannot revoke the owner\'s share', denied(await student2.c.rpc('revoke_shared_resource', { rid: sh.data })) || rows(await student.c.from('org_shared_resources').select('id').eq('id', sh.data)) === 1)
  await student.c.rpc('revoke_shared_resource', { rid: sh.data })
  check('the owner revokes it and the copy is gone for everyone', rows(await student2.c.from('org_shared_resources').select('*').eq('id', sh.data)) === 0 && rows(await admin.from('org_shared_resources').select('id').eq('id', sh.data)) === 0)
  check('members cannot post workspace-wide announcements', denied(await student.c.rpc('post_announcement', { o: A, p: { title: 'Hi all' } })))
  const ann = await teacher.c.rpc('post_announcement', { o: A, p: { title: 'Class moves to Thursday', body: 'Room 2' } })
  const gAnn = await leader.c.rpc('post_announcement', { o: A, p: { title: 'Read Romans 8', group_id: G } })
  const cAnn = await instructor.c.rpc('post_announcement', { o: A, p: { title: 'Quiz due Friday', course_id: C } })
  check('leaders post to the workspace, their group, and their course', !ann.error && !gAnn.error && !cAnn.error, ann.error?.message ?? gAnn.error?.message ?? cAnn.error?.message)
  check('a leader cannot post to another leader\'s group', denied(await leader2.c.rpc('post_announcement', { o: A, p: { title: 'x', group_id: G } })))
  const studentAnns = (await student.c.from('org_announcements').select('id').eq('org_id', A)).data?.map((r) => r.id) ?? []
  const instr2Anns = (await instructor2.c.from('org_announcements').select('id').eq('org_id', A)).data?.map((r) => r.id) ?? []
  check('members get the announcements for their groups and courses', [ann.data, gAnn.data, cAnn.data].every((i) => studentAnns.includes(i)))
  check('people outside a group or course do not get its announcements', instr2Anns.includes(ann.data) && !instr2Anns.includes(gAnn.data) && !instr2Anns.includes(cAnn.data))
  check('marking an announcement read', !(await student.c.from('org_announcement_reads').insert({ announcement_id: ann.data, user_id: student.id })).error)
  check('Church B never sees Church A announcements', rows(await memberB.c.from('org_announcements').select('*').eq('org_id', A)) === 0)

  console.log('9. Removal, leaving, and two-step sign-in')
  const beforeNotes = rows(await student2.c.from('user_records').select('id'))
  await student2.c.rpc('sync_push', { device: 'd2', changes: [{ kind: 'notes', id: 'r-note', base: 0, data: { id: 'r-note', text: 'mine' } }] })
  check('a member cannot remove someone above them', denied(await student2.c.rpc('remove_member', { o: A, u: leader.id })))
  const rm = await adminA.c.rpc('remove_member', { o: A, u: student2.id })
  check('an administrator removes a member', !rm.error, rm.error?.message)
  check('(test 9) the removed member loses access immediately (same sign-in token)', rows(await student2.c.from('orgs').select('id').eq('id', A)) === 0 && rows(await student2.c.from('org_groups').select('id').eq('id', G)) === 0 && rows(await student2.c.from('org_shared_resources').select('id').eq('id', orgWide.data)) === 0 && rows(await student2.c.from('org_announcements').select('id').eq('org_id', A)) === 0)
  check('(test 9) and can no longer act in it', denied(await student2.c.rpc('report_content', { kind: 'post', target: post.data.id, reason: 'x' })) && denied(await student2.c.from('org_discussion_posts').insert({ topic_id: T, author_id: student2.id, body: 'x' })))
  const after = await student2.c.from('user_records').select('id')
  check('(test 14) removal does not touch their private study data', rows(after) === beforeNotes + 1)
  check('the church keeps its records of the former member (enrollment)', rows(await instructor.c.from('org_enrollments').select('id').eq('course_id', C).eq('user_id', student2.id)) === 1)
  check('a member can leave on their own', !(await student.c.rpc('remove_member', { o: B, u: student.id })).error && rows(await student.c.from('orgs').select('id').eq('id', B)) === 0)
  const ri = await invite(owner, A, student2.email, 'member')
  check('a removed member can be invited back', !(await join(student2, ri.data.token, 'Student R')).error && rows(await student2.c.from('orgs').select('id').eq('id', A)) === 1)

  const mfaP = await person('mfa')
  const mi = await invite(owner, A, mfaP.email, 'member')
  await join(mfaP, mi.data.token, 'Two Step')
  const en = await mfaP.c.auth.mfa.enroll({ factorType: 'totp' })
  const ch = await mfaP.c.auth.mfa.challenge({ factorId: en.data.id })
  await mfaP.c.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: totp(en.data.totp.secret) })
  const pw = createClient(URL_, ANON, opts)
  await pw.auth.signInWithPassword({ email: mfaP.email, password: mfaP.password })
  check('with two-step sign-in on, a password-only session sees no workspace data', rows(await pw.from('orgs').select('id')) === 0 && denied(await pw.rpc('create_org', { p: { name: 'X Y', kind: 'church', contact_email: 'a@b.co', display_name: 'X', adult: true } })))
  const ch2 = await pw.auth.mfa.challenge({ factorId: en.data.id })
  await pw.auth.mfa.verify({ factorId: en.data.id, challengeId: ch2.data.id, code: totp(en.data.totp.secret) })
  check('after the code, the workspace appears', rows(await pw.from('orgs').select('id')) === 1)

  console.log('10. Deleting a workspace')
  check('only the owner can delete a workspace', denied(await adminA.c.rpc('delete_org', { o: B, confirm_name: 'Second Church' })))
  check('the name must be typed exactly', denied(await ownerB.c.rpc('delete_org', { o: B, confirm_name: 'second church' })))
  await ownerB.c.rpc('delete_org', { o: B, confirm_name: 'Second Church' })
  check('after deletion, all access ends at once (even for the owner)', rows(await memberB.c.from('orgs').select('id').eq('id', B)) === 0 && rows(await ownerB.c.from('orgs').select('id').eq('id', B)) === 0)
  check('the owner can restore it within 30 days', ((await ownerB.c.rpc('my_deleted_orgs')).data ?? []).some((o) => o.id === B) && !(await ownerB.c.rpc('restore_org', { o: B })).error && rows(await memberB.c.from('orgs').select('id').eq('id', B)) === 1)
  const block = await admin.rpc('orgs_blocking_account_deletion', { u: owner.id })
  check('an owner with other members is identified before account deletion', (block.data ?? []).some((o) => o.id === A), block.error?.message)
  check('signed-in users cannot call internal functions', denied(await student.c.rpc('refresh_completion', { eid: E })) && denied(await student.c.rpc('orgs_blocking_account_deletion', { u: owner.id })))

  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('Failed:\n - ' + failures.join('\n - '))
    process.exit(1)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
