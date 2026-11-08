/*
 * Church courses in the real app (Release 6.2, Stage C): a pastor copies a personal course into the workspace,
 * edits it with the same builder, publishes it, and invites a student into it; the student takes it on a phone
 * (reflection, server-graded quiz, lessons); the instructor grades and takes attendance; the course completes.
 * The server functions run for real (bundled from api/), with a stand-in email service.
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/church-courses.cjs http://127.0.0.1:5173
 */
const { chromium, devices } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const esbuild = require('esbuild')
const http = require('http')
const path = require('path')
const fs = require('fs')
const os = require('os')

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
    console.log('  FAIL ' + name + (detail ? ' :: ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300) : ''))
  }
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
const run = Date.now().toString(36)

async function person(tag) {
  const email = `${tag}-${run}@example.org`
  const password = 'grace and truth forever'
  await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { age_confirmed_13: true } })
  return { email, password }
}
async function bundle(name) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-api-')), `${name}.cjs`)
  await esbuild.build({ entryPoints: [path.join(__dirname, `../api/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' })
  return require(out)
}
async function signIn(page, p) {
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(p.email)
  await page.getByLabel('Password').fill(p.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByTestId('church-card').waitFor({ timeout: 20000 })
}
async function a11y(page, label) {
  const r = await page.evaluate(() => {
    const unnamed = []
    for (const el of document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button, main a[href]')) {
      if (el.type === 'file') continue
      const name = (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.closest('label')?.innerText || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim()
      if (!name) unnamed.push(el.outerHTML.slice(0, 80))
    }
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    return { unnamed, dup: ids.filter((id, i) => ids.indexOf(id) !== i), scroll: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  check(`${label}: controls are named, ids unique, no sideways scrolling`, !r.unnamed.length && !r.dup.length && !r.scroll, r)
}

const now = Date.now()
const COURSE = {
  id: 'personal-romans', title: 'Romans Foundations', description: 'Six weeks in Romans.', objectives: ['Explain justification by faith'], category: 'Foundations', level: 'beginner',
  duration: '6 weeks', perspective: '', author: 'Pastor Carter', organization: 'Arise Church', units: [{ id: 'u1', title: 'Unit 1', lessonIds: ['pl1', 'pl2'] }],
  completion: { lessons: true, quizzes: true, attendance: 1 }, certificate: { enabled: true, instructor: 'Pastor Carter' }, status: 'draft', version: 0, origin: 'authored', role: 'instructor', createdAt: now, updatedAt: now,
}
const LESSONS = [
  {
    id: 'pl1', courseId: 'personal-romans', title: 'Justified by Faith', intro: 'Romans 5 opens with peace.', objectives: [], primaryRef: 'Rom.5.1', supportingRefs: ['Rom.1.17'], blocks: [{ id: 'b1', kind: 'text', text: 'Peace with God is a settled fact.' }],
    context: '', discussion: ['What does peace with God change?'], reflection: ['What does "justified" mean to you?'], assignments: [], summary: '', instructorNotes: 'SECRET NOTE FOR TEACHERS', status: 'published', createdAt: now, updatedAt: now,
    quiz: { id: 'q1', title: 'Check your understanding', passScore: 70, attempts: 0, shuffle: false, timeLimit: 0, required: true, showAnswers: 'after-submit', allowRetake: true,
      questions: [{ id: 'qa', type: 'choice', prompt: 'We are justified by', options: ['works', 'faith'], answer: 1, refs: ['Rom.5.1'], explanation: 'Romans 5:1.' }, { id: 'qb', type: 'short', prompt: 'Explain peace with God', refs: [], explanation: '' }] },
  },
  { id: 'pl2', courseId: 'personal-romans', title: 'Life in the Spirit', intro: '', objectives: [], primaryRef: 'Rom.8.1', supportingRefs: [], blocks: [], context: '', discussion: [], reflection: [], assignments: [], summary: '', instructorNotes: '', status: 'published', createdAt: now, updatedAt: now },
]
const idbPut = (page, store, rows) =>
  page.evaluate(({ store, rows }) => new Promise((res, rej) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); for (const x of rows) tx.objectStore(store).put(x); tx.oncomplete = () => { r.result.close(); res() }; tx.onerror = () => rej(tx.error) } }), { store, rows })
const idbGet = (page, store, key) =>
  page.evaluate(({ store, key }) => new Promise((res) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const g = r.result.transaction(store).objectStore(store).get(key); g.onsuccess = () => { r.result.close(); res(g.result) } } }), { store, key })

;(async () => {
  const mail = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"m"}'))
  })
  await new Promise((ok) => mail.listen(0, '127.0.0.1', ok))
  Object.assign(process.env, { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, RESEND_API_KEY: 're_local_test', RESEND_API_URL: `http://127.0.0.1:${mail.address().port}/emails` })
  const apis = { 'org-invite': await bundle('org-invite'), 'org-quiz': await bundle('org-quiz') }
  const route = (ctx) =>
    ctx.route(/\/api\/(org-invite|org-quiz)$/, async (r) => {
      const req = r.request()
      const name = new URL(req.url()).pathname.split('/').pop()
      const res = await apis[name].POST(new Request(BASE + '/api/' + name, { method: 'POST', headers: { ...req.headers(), host: new URL(BASE).host }, body: req.postData() }))
      await r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
    })

  const pastor = await person('cpastor')
  const student = await person('cstudent')
  const browser = await chromium.launch()
  const errors = []

  console.log('1. Copy a personal course into a workspace')
  const lc = await browser.newContext({ serviceWorkers: 'block' })
  await route(lc)
  const laptop = await lc.newPage()
  laptop.on('pageerror', (e) => errors.push('laptop: ' + e.message))
  await laptop.goto(BASE + '/learn', { waitUntil: 'networkidle' })
  await idbPut(laptop, 'courses', [COURSE])
  await idbPut(laptop, 'lessons', LESSONS)
  await signIn(laptop, pastor)
  await laptop.goto(BASE + '/church', { waitUntil: 'networkidle' })
  await laptop.getByTestId('create-org').click()
  await laptop.getByLabel('Workspace name').fill('Arise Church')
  await laptop.getByLabel('Your name as members will see it').fill('Pastor Carter')
  await laptop.getByLabel(/I am 18 or older/).check()
  await laptop.getByRole('button', { name: 'Create workspace' }).click()
  await laptop.getByRole('heading', { name: 'Arise Church' }).waitFor()
  await laptop.getByRole('tab', { name: 'Courses' }).click()
  await laptop.getByTestId('add-org-course').click()
  await laptop.getByLabel(/A copy of my course/).first().waitFor({ timeout: 10000 }).catch(() => {})
  check('the pastor can start from their own course on this device', (await laptop.getByLabel(/A copy of my course "Romans Foundations"/).count()) === 1)
  check('the dialog explains that a copy is separate from the personal course', /stays yours and is not changed or\s+linked/.test(await laptop.getByRole('dialog').innerText()))
  await laptop.getByLabel(/A copy of my course "Romans Foundations"/).check()
  await laptop.getByRole('button', { name: 'Add course' }).click()
  await laptop.getByRole('heading', { name: 'Edit course' }).waitFor({ timeout: 15000 })
  check('the same course builder opens on the workspace copy', (await laptop.getByLabel('Title', { exact: true }).inputValue()) === 'Romans Foundations')
  await laptop.getByLabel('Title', { exact: true }).fill('Romans Foundations (Arise)')
  await laptop.getByText('All changes saved to the workspace').waitFor({ timeout: 10000 })
  check('edits save to the workspace', ((await admin.from('org_course_drafts').select('content').order('updated_at', { ascending: false }).limit(1)).data?.[0]?.content.course.title) === 'Romans Foundations (Arise)')
  await a11y(laptop, 'Workspace course editor')
  await laptop.getByRole('link', { name: 'Justified by Faith' }).click()
  await laptop.getByRole('heading', { name: 'Edit lesson' }).waitFor()
  await laptop.getByLabel('Introduction').fill('Romans 5 opens with peace with God.')
  await laptop.locator('[data-status="saved"]').waitFor({ timeout: 10000 })
  check('lessons are edited with the same lesson editor', true)
  const personal = await idbGet(laptop, 'courses', 'personal-romans')
  const personalLesson = await idbGet(laptop, 'lessons', 'pl1')
  check('the personal course on the device is unchanged', personal.title === 'Romans Foundations' && personalLesson.intro === 'Romans 5 opens with peace.')
  await laptop.getByRole('link', { name: 'Back to the course' }).click()
  await laptop.getByTestId('org-publish').click()
  await laptop.getByText(/Published version 1/).waitFor({ timeout: 15000 })
  check('the pastor publishes version 1 to the workspace', /Published, version 1/.test(await laptop.getByTestId('org-course-status').innerText()))
  const courseUrl = laptop.url().replace(/\/edit$/, '')

  console.log('2. Invite a student straight into the course')
  await laptop.goto(courseUrl.replace(/\/courses\/.*/, '') + '?tab=invitations', { waitUntil: 'networkidle' })
  await laptop.getByLabel('Email address').fill(student.email)
  await laptop.getByLabel(/Course: Romans Foundations \(Arise\)/).check()
  await laptop.getByRole('button', { name: 'Send invitation' }).click()
  await laptop.getByTestId('invite-result').waitFor()
  const link = (await laptop.getByTestId('invite-link').inputValue()).replace(/^https?:\/\/[^/]+/, BASE)

  console.log('3. The student takes the course on a phone')
  const pc = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' })
  await route(pc)
  const phone = await pc.newPage()
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message))
  await phone.goto(link, { waitUntil: 'networkidle' })
  await signIn(phone, student)
  await phone.goto(BASE + '/church/join', { waitUntil: 'networkidle' })
  check('the invitation says the course is included', /the course "Romans Foundations \(Arise\)"/.test(await phone.getByTestId('join-page').innerText()))
  await phone.getByLabel('Your name as members will see it').fill('Student Sam')
  await phone.getByLabel(/I am 18 or older/).check()
  await phone.getByTestId('accept-invite').click()
  await phone.getByRole('heading', { name: 'Arise Church' }).waitFor()
  await phone.getByRole('tab', { name: 'Courses' }).click()
  await phone.getByTestId('my-org-courses').waitFor()
  check('the student is already enrolled', /Romans Foundations \(Arise\)/.test(await phone.getByTestId('my-org-courses').innerText()))
  await phone.getByRole('link', { name: 'Romans Foundations (Arise)' }).click()
  await phone.getByTestId('org-enrollment').waitFor()
  await a11y(phone, 'Course page (phone)')
  await phone.getByRole('link', { name: 'Start the first lesson' }).click()
  await phone.getByRole('heading', { name: 'Justified by Faith' }).waitFor({ timeout: 15000 })
  const lessonText = await phone.locator('main').innerText()
  check('the lesson shows the edited text and the Scripture', /peace with God\./.test(lessonText) && /Primary Scripture/.test(lessonText))
  check('students never see instructor notes', !lessonText.includes('SECRET NOTE FOR TEACHERS'))
  const html = await phone.content()
  check('the answer key is not in the page before submitting', !/"answer":1/.test(html))
  await phone.getByLabel(/What does "justified" mean to you\?/).fill('Declared righteous by God through faith.')
  await phone.locator('main [aria-live=polite]', { hasText: /^Saved$/ }).first().waitFor({ timeout: 10000 })
  check('the reflection saves to the course', true)
  await phone.getByLabel(/What does "justified" mean to you\?/).fill('Declared righteous by God through faith, freely.')
  await phone.getByRole('link', { name: 'Next' }).click() // leave at once, before the autosave delay
  await phone.getByRole('heading', { name: 'Life in the Spirit' }).waitFor()
  await phone.waitForTimeout(1500)
  check('leaving a lesson right after typing still saves the reflection', ((await admin.from('org_written_answers').select('body').eq('prompt', 'What does "justified" mean to you?').order('updated_at', { ascending: false }).limit(1)).data?.[0]?.body) === 'Declared righteous by God through faith, freely.')
  await phone.getByRole('link', { name: 'Previous' }).click()
  await phone.getByRole('heading', { name: 'Justified by Faith' }).waitFor()
  await phone.getByRole('button', { name: 'Start the quiz' }).click()
  await phone.getByRole('radio', { name: 'works' }).check()
  await phone.getByLabel('Your answer').fill('Reconciled to God.')
  await phone.getByRole('button', { name: 'Submit answers' }).click()
  await phone.getByTestId('quiz-result').waitFor({ timeout: 15000 })
  const r1 = await phone.getByTestId('quiz-result').innerText()
  check('the server grades the quiz (0% for the wrong choice) and shows the answer as allowed', /Score: 0%/.test(r1) && /Answer: faith/.test(r1), r1.slice(0, 200))
  await phone.getByRole('button', { name: 'Take the quiz again' }).click()
  await phone.getByRole('radio', { name: 'faith' }).check()
  await phone.getByLabel('Your answer').fill('Reconciled to God.')
  await phone.getByRole('button', { name: 'Submit answers' }).click()
  await phone.getByText(/Score: 100%/).waitFor({ timeout: 15000 })
  check('a second try passes', true)
  await phone.getByTestId('org-mark-done').click()
  await phone.getByRole('heading', { name: 'Life in the Spirit' }).waitFor()
  await phone.getByTestId('org-mark-done').click()
  await phone.getByTestId('org-enrollment').waitFor()
  check('with lessons and the quiz done, the course still waits for attendance', /100% complete/.test(await phone.getByTestId('org-enrollment').innerText()) && !/Completed/.test(await phone.getByTestId('org-enrollment').innerText()))

  console.log('4. The instructor grades and takes attendance')
  await laptop.goto(courseUrl + '/manage', { waitUntil: 'networkidle' })
  await laptop.getByTestId('students-table').waitFor()
  const st = await laptop.getByTestId('students-table').innerText()
  check('Manage lists the student with progress and best score', /Student Sam/.test(st) && /2 of 2 lessons/.test(st) && /100%/.test(st), st)
  await a11y(laptop, 'Manage: students')
  await laptop.getByRole('tab', { name: 'Grading' }).click()
  await laptop.getByTestId('grade-written').first().waitFor({ timeout: 15000 })
  check('the reflection waits for review', /Declared righteous by God through faith/.test(await laptop.getByTestId('grade-written').first().innerText()))
  await laptop.getByLabel('Feedback to the student').first().fill('Well said. See also Romans 4.')
  await laptop.getByRole('button', { name: 'Save grade' }).first().click()
  await laptop.getByText('Saved.').waitFor()
  check('the instructor grades the reflection with feedback', true)
  await laptop.getByRole('tab', { name: 'Attendance' }).click()
  await laptop.getByLabel('Session title').fill('Week 1')
  await laptop.getByRole('button', { name: 'Add session' }).click()
  await laptop.getByTestId('attendance-table').waitFor()
  await laptop.getByLabel(/Student Sam, /).selectOption('late')
  await laptop.waitForTimeout(1500)
  check('attendance offers Present, Absent, Excused, and Late', (await laptop.getByLabel(/Student Sam, /).locator('option').allInnerTexts()).join(',') === 'Not recorded,Present,Absent,Excused,Late')
  await a11y(laptop, 'Manage: attendance')

  console.log('5. The student sees feedback, completion, and a certificate')
  await phone.goto(courseUrl, { waitUntil: 'networkidle' })
  await phone.getByTestId('org-enrollment').waitFor()
  check('attendance completes the course', /Completed/.test(await phone.getByTestId('org-enrollment').innerText()))
  await phone.getByRole('button', { name: 'Certificate' }).click()
  await phone.getByTestId('org-certificate').waitFor()
  check('the certificate names the student, course, and workspace', /Student Sam/.test(await phone.getByTestId('org-certificate').innerText()) && /Arise Church/.test(await phone.getByTestId('org-certificate').innerText()))
  await phone.keyboard.press('Escape')
  await phone.goto(courseUrl + '/lessons/pl1', { waitUntil: 'networkidle' })
  await phone.getByTestId('written-feedback').waitFor()
  check('the student reads the instructor feedback on their reflection', /Well said/.test(await phone.getByTestId('written-feedback').innerText()))

  console.log('6. A revision never changes finished work')
  await laptop.goto(courseUrl + '/edit', { waitUntil: 'networkidle' })
  await laptop.getByLabel('Description').fill('Six weeks in Romans (revised).')
  await laptop.locator('[data-status="saved"]').waitFor({ timeout: 10000 })
  await laptop.getByTestId('org-publish').click()
  await laptop.getByText(/Published version 2/).waitFor({ timeout: 15000 })
  await phone.goto(courseUrl, { waitUntil: 'networkidle' })
  await phone.getByTestId('org-enrollment').waitFor()
  check('the completed student stays completed on version 1', /Completed/.test(await phone.getByTestId('org-enrollment').innerText()) && !/(revised)/.test(await phone.locator('main').innerText()))
  check('no script errors', !errors.length, errors.join(' | '))
  await browser.close()
  mail.close()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('Failed:\n - ' + failures.join('\n - '))
    process.exit(1)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
