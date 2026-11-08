/*
 * Church workspaces in the real app (Release 6.2, Stage B): create a workspace, invite by email, accept on a
 * phone, roles, switching, transfer of ownership, and leaving, against a Supabase stack. The invitation server
 * function runs for real (bundled from api/org-invite.ts) with a stand-in email service that captures messages.
 *   (build and preview as for e2e/account.cjs, then)
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/church.cjs http://127.0.0.1:5173
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(URL_, SERVICE, opts)
const run = Date.now().toString(36)

async function person(tag) {
  const email = `${tag}-${run}@example.org`
  const password = 'grace and truth forever'
  await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { age_confirmed_13: true } })
  return { email, password }
}

/** The real server function, bundled, answering /api/org-invite for the browser. */
async function loadApi() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'csb-api-')), 'org-invite.cjs')
  await esbuild.build({ entryPoints: [path.join(__dirname, '../api/org-invite.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent' })
  return require(out)
}

async function signIn(page, p) {
  await page.goto(BASE + '/account', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').fill(p.email)
  await page.getByLabel('Password').fill(p.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.getByTestId('church-card').waitFor({ timeout: 20000 })
}

/** Light accessibility checks: every control has a name, images have text alternatives, no sideways scrolling. */
async function a11y(page, label) {
  const r = await page.evaluate(() => {
    const unnamed = []
    for (const el of document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button, main a[href]')) {
      if (el.closest('[hidden], .sr-only') && el.type !== 'file') continue
      const name = (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim()
      if (!name && !(el.type === 'file')) unnamed.push(el.outerHTML.slice(0, 80))
    }
    const imgs = [...document.querySelectorAll('main img')].filter((i) => !i.hasAttribute('alt')).length
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i)
    return { unnamed, imgs, dupIds, scroll: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  check(`${label}: every control has a name, images have alt text, ids are unique`, !r.unnamed.length && !r.imgs && !r.dupIds.length, r)
  check(`${label}: no sideways scrolling`, !r.scroll)
}

;(async () => {
  const sent = []
  const mail = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      sent.push(JSON.parse(b))
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"id":"m"}')
    })
  })
  await new Promise((ok) => mail.listen(0, '127.0.0.1', ok))
  Object.assign(process.env, { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, RESEND_API_KEY: 're_local_test', RESEND_API_URL: `http://127.0.0.1:${mail.address().port}/emails` })
  const api = await loadApi()
  const route = async (ctx) =>
    ctx.route('**/api/org-invite', async (r) => {
      const req = r.request()
      const res = await api.POST(new Request(BASE + '/api/org-invite', { method: 'POST', headers: { ...req.headers(), host: new URL(BASE).host }, body: req.postData() }))
      await r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
    })

  const pastor = await person('pastor')
  const teacher = await person('teacher')
  const stranger = await person('stranger')
  const browser = await chromium.launch()
  const errors = []

  console.log('1. A pastor creates a workspace')
  const lc = await browser.newContext({ serviceWorkers: 'block' })
  await route(lc)
  const laptop = await lc.newPage()
  laptop.on('pageerror', (e) => errors.push('laptop: ' + e.message))
  await laptop.goto(BASE + '/bible/John/3', { waitUntil: 'networkidle' })
  check('guests see no Church entry in the top bar', (await laptop.getByTestId('church-link').count()) === 0)
  const churchCode = []
  laptop.on('request', (r) => /ChurchPages/.test(r.url()) && churchCode.push(r.url()))
  await signIn(laptop, pastor)
  check('the Account page offers church workspaces', /Church workspaces/.test(await laptop.getByTestId('church-card').innerText()))
  check('the workspace code is not downloaded until a workspace page opens', churchCode.length === 0)
  await laptop.getByRole('link', { name: 'Open church workspaces' }).click()
  await laptop.getByText(/do not belong to a workspace yet/).waitFor()
  check('a new person sees how to join or create a workspace', true)
  await a11y(laptop, 'Church home')
  await laptop.getByTestId('create-org').click()
  await laptop.getByLabel('Workspace name').fill('Arise Church')
  await laptop.getByLabel('Description').fill('A church in Decatur, Alabama.')
  await laptop.getByLabel('City (optional)').fill('Decatur')
  await laptop.getByLabel('State (optional)').fill('AL')
  await laptop.getByLabel('Your name as members will see it').fill('Pastor Carter')
  await laptop.getByRole('button', { name: 'Create workspace' }).click()
  check('the 18+ confirmation is required', (await laptop.getByRole('heading', { name: 'Arise Church' }).count()) === 0)
  await laptop.getByLabel(/I am 18 or older/).check()
  await laptop.getByLabel('Website (optional)').fill('http://not-secure.example')
  await laptop.getByRole('button', { name: 'Create workspace' }).click()
  check('a website without https is refused with a clear message', /must start with https/.test(await laptop.getByRole('alert').innerText()))
  await laptop.getByLabel('Website (optional)').fill('')
  await laptop.getByRole('button', { name: 'Create workspace' }).click()
  await laptop.getByRole('heading', { name: 'Arise Church' }).waitFor({ timeout: 15000 })
  check('the workspace opens with the pastor as owner', /You: Owner/.test(await laptop.locator('main').innerText()))
  check('the Church entry appears in the top bar', (await laptop.getByTestId('church-link').count()) === 1)
  await a11y(laptop, 'Workspace overview')

  console.log('2. Settings and logo')
  await laptop.getByRole('tab', { name: 'Settings' }).click()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  await laptop.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png })
  await laptop.getByText('Logo saved.').waitFor({ timeout: 10000 })
  check('a logo is shrunk and saved', ((await admin.from('orgs').select('logo').eq('name', 'Arise Church').order('created_at', { ascending: false }).limit(1)).data?.[0]?.logo ?? '').startsWith('data:image/'))
  await laptop.locator('input[type=file]').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  check('a non-image logo is refused', /PNG, JPEG, or WebP/.test(await laptop.getByRole('alert').innerText()))
  await laptop.getByLabel('Description').fill('A church in Decatur, Alabama. Sunday 10 AM.')
  await laptop.getByRole('button', { name: 'Save settings' }).click()
  await laptop.getByText('Settings saved.').waitFor()
  check('settings save', true)
  await a11y(laptop, 'Settings')

  console.log('3. Inviting by email')
  await laptop.getByRole('tab', { name: 'Invitations' }).click()
  await laptop.getByLabel('Email address').fill(teacher.email)
  await laptop.getByLabel('Role').selectOption('teacher')
  await laptop.getByRole('button', { name: 'Send invitation' }).click()
  await laptop.getByTestId('invite-result').waitFor({ timeout: 15000 })
  const link = await laptop.getByTestId('invite-link').inputValue()
  check('the invitation is emailed and the link is shown to copy', /Emailed to/.test(await laptop.getByTestId('invite-result').innerText()) && /\/church\/join#token=[0-9a-f]{64}$/.test(link), link)
  check('the email went to the teacher, with the church, the role, and the same link', sent.length === 1 && sent[0].to[0] === teacher.email && /Pastor Carter invited you to join Arise Church/.test(sent[0].text) && /Pastor\/Teacher/.test(sent[0].text) && sent[0].text.includes(link))
  check('the invitation is listed as waiting', /Waiting/.test(await laptop.getByTestId('invites-table').innerText()))
  await a11y(laptop, 'Invitations')
  const localLink = link.replace(/^https?:\/\/[^/]+/, BASE)

  console.log('4. The teacher accepts on a phone')
  const pc = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' })
  await route(pc)
  const phone = await pc.newPage()
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message))
  await phone.goto(localLink, { waitUntil: 'networkidle' })
  await phone.getByTestId('join-signed-out').waitFor()
  check('signed out, the phone explains to sign in with the invited address', /email address the invitation was sent to/.test(await phone.locator('main').innerText()))
  check('the token is removed from the address bar', !phone.url().includes('token='))
  await signIn(phone, teacher)
  check('after signing in, the Account page points to the waiting invitation', /invitation waiting/.test(await phone.getByTestId('church-card').innerText()))
  await phone.getByRole('link', { name: 'Review the invitation' }).click()
  await phone.getByTestId('join-page').waitFor()
  const jp = await phone.locator('main').innerText()
  check('the invitation shows the church, who invited, the role, and what the church can and cannot see', /Arise Church/.test(jp) && /Pastor Carter invited you/.test(jp) && /Pastor\/Teacher/.test(jp) && /cannot see your\s+personal notes/.test(jp), jp.slice(0, 400))
  await a11y(phone, 'Invitation (phone)')
  await phone.getByLabel('Your name as members will see it').fill('Teacher Tanya')
  await phone.getByLabel(/I am 18 or older/).check()
  await phone.getByTestId('accept-invite').click()
  await phone.getByRole('heading', { name: 'Arise Church' }).waitFor({ timeout: 15000 })
  check('accepting opens the workspace as Pastor/Teacher', /You: Pastor\/Teacher/.test(await phone.locator('main').innerText()))
  check('the teacher does not get the Settings or Activity sections', (await phone.getByRole('tab', { name: 'Settings' }).count()) === 0 && (await phone.getByRole('tab', { name: 'Activity' }).count()) === 0)
  await a11y(phone, 'Workspace (phone)')

  console.log('5. A forwarded link is useless to anyone else')
  const sc = await browser.newContext({ serviceWorkers: 'block' })
  const sp = await sc.newPage()
  await signIn(sp, stranger)
  await sp.goto(localLink, { waitUntil: 'networkidle' })
  await sp.getByTestId('join-status').waitFor()
  const st = await sp.getByTestId('join-status').getAttribute('data-status')
  check('the used link now reads as used or for another account, and shows nothing about the church', ['used', 'wrong_account'].includes(st) && !/Arise Church/.test(await sp.locator('main').innerText()), st)

  console.log('6. Roles, members, and the activity log')
  await laptop.getByRole('tab', { name: 'Members', exact: true }).click()
  await laptop.getByTestId('members-table').waitFor()
  const mt = await laptop.getByTestId('members-table').innerText()
  check('the owner sees the teacher with their email', mt.includes('Teacher Tanya') && mt.includes(teacher.email))
  await laptop.getByLabel('Role for Teacher Tanya').selectOption('admin')
  await laptop.getByText('Teacher Tanya is now Administrator.').waitFor()
  check('the owner makes the teacher an administrator', true)
  await laptop.getByRole('tab', { name: 'Activity' }).click()
  await laptop.getByTestId('activity-log').waitFor()
  const log = await laptop.getByTestId('activity-log').innerText()
  check('the activity log records invitation, acceptance, and the role change (with names, no study content)', /sent an invitation/.test(log) && /accepted an invitation/.test(log) && /changed a role \(Teacher Tanya: Administrator\)/.test(log), log)

  console.log('7. Two workspaces and switching')
  await laptop.goto(BASE + '/church', { waitUntil: 'networkidle' })
  await laptop.getByTestId('create-org').click()
  await laptop.getByLabel('Workspace name').fill('Men ARISE')
  await laptop.getByLabel('Type').selectOption('ministry')
  await laptop.getByLabel('Your name as members will see it').fill('Pastor Carter')
  await laptop.getByLabel(/I am 18 or older/).check()
  await laptop.getByRole('button', { name: 'Create workspace' }).click()
  await laptop.getByRole('heading', { name: 'Men ARISE' }).waitFor()
  await laptop.getByTestId('org-switcher').selectOption({ label: 'Arise Church' })
  await laptop.getByRole('heading', { name: 'Arise Church' }).waitFor()
  check('the switcher moves between workspaces', true)
  await laptop.goto(BASE + '/bible/John/3', { waitUntil: 'networkidle' })
  await laptop.getByTestId('church-link').click()
  await laptop.getByRole('heading', { name: 'Arise Church' }).waitFor()
  check('the top-bar Church entry returns to the last workspace used', true)

  console.log('8. Transferring ownership')
  await laptop.getByRole('tab', { name: 'Settings' }).click()
  await laptop.getByLabel('New owner').selectOption({ label: 'Teacher Tanya' })
  await laptop.getByRole('button', { name: 'Offer ownership' }).click()
  await laptop.getByText(/Offer sent/).waitFor()
  await laptop.getByText(/Offered to Teacher Tanya/).waitFor()
  check('nothing changes until the administrator accepts', /You: Owner/.test(await laptop.locator('main').innerText()))
  await phone.goto(BASE + '/church', { waitUntil: 'networkidle' })
  await phone.getByTestId('ownership-offer').waitFor()
  await phone.getByRole('button', { name: 'Accept ownership' }).click()
  await phone.getByText('You now own Arise Church.').waitFor()
  await laptop.reload({ waitUntil: 'networkidle' })
  await laptop.getByRole('heading', { name: 'Arise Church' }).waitFor()
  check('after accepting, the pastor is an administrator', /You: Administrator/.test(await laptop.locator('main').innerText()))

  console.log('9. Leaving keeps personal data')
  await laptop.goto(BASE + '/bible/John/3', { waitUntil: 'networkidle' })
  const notesBefore = await laptop.evaluate(() => new Promise((res) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const g = r.result.transaction('notes').objectStore('notes').count(); g.onsuccess = () => res(g.result) } }))
  await laptop.goto(BASE + '/church', { waitUntil: 'networkidle' })
  await laptop.getByRole('link', { name: /Arise Church/ }).click()
  await laptop.getByRole('tab', { name: 'My membership' }).click()
  await laptop.getByText(/What Arise Church can see/).waitFor()
  check('members are told exactly what the workspace can and cannot see', /never sees your personal notes/.test(await laptop.locator('main').innerText()))
  await laptop.getByRole('button', { name: 'Leave workspace' }).click()
  await laptop.getByRole('dialog').getByRole('button', { name: 'Leave' }).click()
  await laptop.getByText('You left Arise Church.').waitFor()
  const notesAfter = await laptop.evaluate(() => new Promise((res) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const g = r.result.transaction('notes').objectStore('notes').count(); g.onsuccess = () => res(g.result) } }))
  check('leaving does not touch notes on the device', notesBefore === notesAfter)
  check('after leaving, only the other workspace is listed', !/Arise Church/.test(await laptop.getByTestId('org-list').innerText()) && /Men ARISE/.test(await laptop.getByTestId('org-list').innerText()))

  check('no script errors in either browser', !errors.length, errors.join(' | '))
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
