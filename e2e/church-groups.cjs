/*
 * Group Bible studies in the real app (Release 6.2, Stage D): the Romans 8 example from the brief, end to end.
 * A pastor creates a group and its leader; the leader prepares and assigns a study with questions, a commentary
 * note and a link; a member reads it on a phone, opens Study This Passage, saves a private draft, and submits; the
 * leader reviews and replies; the group discusses, a post is reported and hidden, and a topic is locked.
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/church-groups.cjs http://127.0.0.1:5173
 */
const { chromium, devices } = require('playwright')
const { createClient } = require('@supabase/supabase-js')

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
const PASSWORD = 'grace and truth forever'

async function person(tag) {
  const email = `${tag}-${run}@example.org`
  await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { age_confirmed_13: true } })
  const c = createClient(URL_, ANON, opts)
  await c.auth.signInWithPassword({ email, password: PASSWORD })
  return { email, password: PASSWORD, c }
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
      const name = (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.closest('label')?.innerText || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim()
      if (!name) unnamed.push(el.outerHTML.slice(0, 80))
    }
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    return { unnamed, dup: ids.filter((id, i) => ids.indexOf(id) !== i), scroll: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  check(`${label}: controls are named, ids unique, no sideways scrolling`, !r.unnamed.length && !r.dup.length && !r.scroll, r)
}

;(async () => {
  const pastor = await person('gpastor')
  const leader = await person('gleader')
  const sam = await person('gsam')
  const ruth = await person('gruth')
  // workspace and memberships through the database's own functions (Stage B covers the screens for this)
  const org = (await pastor.c.rpc('create_org', { p: { name: 'Arise Church', kind: 'church', contact_email: 'office@example.org', display_name: 'Pastor Carter', adult: true } })).data
  for (const [p, role, name] of [[leader, 'leader', 'Leader Lee'], [sam, 'member', 'Sam'], [ruth, 'member', 'Ruth']]) {
    const inv = await pastor.c.rpc('create_invitation', { o: org, p: { email: p.email, role } })
    await p.c.rpc('accept_invitation', { token: inv.data.token, display_name: name, adult: true })
  }
  const browser = await chromium.launch()
  const errors = []
  const ctx = async (dev) => {
    const c = await browser.newContext({ ...(dev ? devices[dev] : {}), serviceWorkers: 'block' })
    const p = await c.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    return p
  }

  console.log('1. The pastor creates a group with a leader')
  const pp = await ctx()
  await signIn(pp, pastor)
  await pp.goto(`${BASE}/church/${org}?tab=groups`, { waitUntil: 'networkidle' })
  await pp.getByTestId('create-group').click()
  await pp.getByLabel('Group name').fill('Romans study')
  await pp.getByLabel('Study topic').fill('Romans 8')
  await pp.getByLabel('Schedule (optional)').fill('Tuesdays 7 PM')
  await pp.getByLabel(/Turn on group discussion/).check()
  await pp.getByLabel('Group leader').selectOption({ label: 'Leader Lee (Group Leader)' })
  await pp.getByRole('button', { name: 'Create group' }).click()
  await pp.getByRole('heading', { name: 'Romans study' }).waitFor()
  const groupUrl = pp.url()
  await pp.getByRole('tab', { name: 'Members' }).click()
  await pp.getByRole('button', { name: 'Add members' }).click()
  await pp.getByRole('dialog').getByLabel('Sam').check()
  await pp.getByRole('dialog').getByLabel('Ruth').check()
  await pp.getByRole('dialog').getByRole('button', { name: /^Add 2$/ }).click()
  await pp.getByTestId('group-members').getByText('Ruth').waitFor({ timeout: 10000 })
  const gm = await pp.getByTestId('group-members').innerText()
  check('the group has its leader and two members', /Leader Lee/.test(gm) && /Sam/.test(gm) && /Ruth/.test(gm), gm)
  await a11y(pp, 'Group members')

  console.log('2. The leader prepares and assigns the Romans 8 study')
  const lp = await ctx()
  await signIn(lp, leader)
  await lp.goto(`${BASE}/church/${org}?tab=groups`, { waitUntil: 'networkidle' })
  await lp.getByTestId('my-groups').waitFor()
  check('the leader sees the group they lead', /Romans study/.test(await lp.getByTestId('my-groups').innerText()) && /You lead/.test(await lp.getByTestId('my-groups').innerText()))
  await lp.getByRole('link', { name: 'Romans study' }).click()
  await lp.getByTestId('new-group-study').click()
  await lp.getByLabel('Title').fill('Life in the Spirit')
  await lp.getByLabel('Scripture passage').fill('Romans 8')
  await lp.getByLabel('Instructions').fill('Read the whole chapter twice before Tuesday.')
  await lp.getByLabel('Study questions (one per line)').fill('What does "no condemnation" mean in verse 1?\nHow does verse 28 comfort you?')
  await lp.getByLabel('Commentary', { exact: true }).selectOption('MHCC')
  await lp.getByLabel('Verse', { exact: true }).fill('Romans 8:28')
  await lp.getByRole('button', { name: 'Add resource' }).click()
  await lp.getByLabel('Resource type').selectOption('link')
  await lp.getByLabel('Link address').fill('javascript:alert(1)')
  await lp.getByRole('button', { name: 'Add resource' }).click()
  check('unsafe links are refused', /must start with https/.test(await lp.getByRole('alert').innerText()))
  await lp.getByLabel('Link address').fill('https://www.biblegateway.com/passage/?search=Romans%208')
  await lp.getByLabel('Link title').fill('Romans 8 in other translations')
  await lp.getByRole('button', { name: 'Add resource' }).click()
  await lp.getByLabel(/Due date/).fill('2026-11-17')
  await lp.getByRole('button', { name: 'Save', exact: true }).click()
  await lp.getByText('Saved.').waitFor()
  await a11y(lp, 'Prepare a study')
  const studyUrl = lp.url()
  const sp0 = await ctx('Pixel 7')
  await signIn(sp0, sam)
  await sp0.goto(groupUrl, { waitUntil: 'networkidle' })
  await sp0.getByRole('tab', { name: 'Studies' }).waitFor()
  check('a draft study is hidden from members', !/Life in the Spirit/.test(await sp0.locator('main').innerText()))
  await lp.getByTestId('assign-study').click()
  await lp.getByText('Assigned to the group.').waitFor()
  await lp.getByTestId('group-study-status').getByText('Assigned').waitFor({ timeout: 10000 }).catch(() => {})
  check('the leader assigns it', /Assigned/.test(await lp.getByTestId('group-study-status').innerText()))

  console.log('3. A member studies it on a phone')
  const sp = sp0
  await sp.goto(groupUrl, { waitUntil: 'networkidle' })
  await sp.getByRole('link', { name: 'Life in the Spirit' }).click()
  await sp.getByRole('heading', { name: 'Life in the Spirit' }).waitFor()
  await sp.getByTestId('commentary-excerpt').waitFor()
  await sp.locator('blockquote').first().waitFor()
  const body = await sp.locator('main').innerText()
  check('the member sees the passage text, instructions, and due date', /There is therefore now no condemnation/.test(body) && /Read the whole chapter twice/.test(body) && /due 2026-11-17/.test(body), body.slice(0, 300))
  await sp.getByTestId('commentary-excerpt').locator('.muted, div:not(.block-label)').last().waitFor()
  const ex = await sp.getByTestId('commentary-excerpt').innerText()
  check('the shared commentary note is quoted with its source', /Concise Commentary/i.test(ex) && ex.length > 80, ex.slice(0, 200))
  check('the research link opens safely in a new tab', (await sp.getByRole('link', { name: /Romans 8 in other translations/ }).getAttribute('rel')).includes('noopener'))
  await a11y(sp, 'Group study (phone)')
  await sp.getByTestId('study-this-passage').click()
  await sp.waitForURL(/\/study\//)
  check('Study This Passage opens a private study of Romans 8 in the Study Workspace', /\/study\/[\w-]+$/.test(sp.url()))
  await sp.goBack({ waitUntil: 'networkidle' })
  await sp.getByTestId('group-response').waitFor()
  await sp.getByLabel(/I read Romans 8/).check()
  await sp.getByLabel(/What does "no condemnation" mean/).fill('Christ took the penalty, so God does not condemn me.')
  await sp.getByRole('button', { name: 'Save draft' }).click()
  await sp.getByText(/Draft saved/).waitFor()
  await lp.goto(studyUrl, { waitUntil: 'networkidle' })
  await lp.getByRole('tab', { name: 'Responses' }).click()
  await lp.getByText(/of 2 submitted/).waitFor()
  check('the leader cannot see a draft', /0 of 2 submitted/.test(await lp.locator('main').innerText()) && !/Christ took the penalty/.test(await lp.locator('main').innerText()))
  await sp.getByLabel(/How does verse 28 comfort you/).fill('Even hard things are worked for good.')
  await sp.getByLabel('Reflection').fill('I want to live by the Spirit this week.')
  await sp.getByRole('button', { name: 'Submit to my leader' }).click()
  await sp.getByTestId('response-submitted').waitFor()
  check('the member submits', true)

  console.log('4. The leader reviews and replies')
  await lp.reload({ waitUntil: 'networkidle' })
  await lp.getByRole('tab', { name: 'Responses' }).click()
  await lp.getByTestId('group-response-card').waitFor()
  const card = await lp.getByTestId('group-response-card').innerText()
  check('the leader sees the submitted answers, reflection, and that Sam read the passage', /Christ took the penalty/.test(card) && /live by the Spirit/.test(card) && /read Romans 8/.test(card) && /Sam/.test(card), card)
  check('and who has not submitted yet', /1 of 2 submitted\. Not yet: Ruth/.test(await lp.locator('main').innerText()))
  await lp.getByLabel(/A note back to Sam/).fill('Beautiful. Read verse 39 again.')
  await lp.getByRole('button', { name: 'Save note' }).click()
  await lp.getByText('Note saved.').waitFor()
  await sp.reload({ waitUntil: 'networkidle' })
  await sp.getByTestId('leader-note').waitFor()
  check('the member reads the leader\'s note', /Read verse 39 again/.test(await sp.getByTestId('leader-note').innerText()))
  const rp = await ctx()
  await signIn(rp, ruth)
  await rp.goto(studyUrl, { waitUntil: 'networkidle' })
  await rp.getByTestId('group-response').waitFor()
  check('another member never sees Sam\'s answers', !/Christ took the penalty/.test(await rp.locator('main').innerText()))

  console.log('5. Discussion with moderation')
  await lp.goto(groupUrl, { waitUntil: 'networkidle' })
  await lp.getByRole('tab', { name: 'Discussion' }).click()
  await lp.getByLabel('New topic').fill('Romans 8:28 in hard seasons')
  await lp.getByRole('button', { name: 'Start topic' }).click()
  await lp.getByTestId('thread').waitFor()
  await sp.goto(groupUrl, { waitUntil: 'networkidle' })
  await sp.getByRole('tab', { name: 'Discussion' }).click()
  await sp.getByRole('button', { name: 'Romans 8:28 in hard seasons' }).click()
  await sp.getByPlaceholder('Add to the discussion').fill('This verse carried me through a hard year.')
  await sp.getByRole('button', { name: 'Post', exact: true }).click()
  await sp.getByTestId('post').waitFor()
  await rp.goto(groupUrl, { waitUntil: 'networkidle' })
  await rp.getByRole('tab', { name: 'Discussion' }).click()
  await rp.getByRole('button', { name: 'Romans 8:28 in hard seasons' }).click()
  await rp.getByTestId('post').waitFor()
  check('group members read each other\'s posts', /carried me through/.test(await rp.getByTestId('thread').innerText()))
  await rp.getByRole('button', { name: /Report post by Sam/ }).click()
  await rp.getByLabel('Reason').fill('Testing the report flow.')
  await rp.getByRole('button', { name: 'Send report' }).click()
  await rp.getByText(/Reported\. A leader will review it/).waitFor()
  await lp.reload({ waitUntil: 'networkidle' })
  await lp.getByRole('tab', { name: 'Discussion' }).click()
  await lp.getByTestId('reports-queue').waitFor()
  check('the leader sees the report', /Testing the report flow/.test(await lp.getByTestId('reports-queue').innerText()))
  await lp.getByRole('button', { name: 'Hide the post' }).click()
  await lp.getByText('Post hidden.').waitFor()
  await rp.reload({ waitUntil: 'networkidle' })
  await rp.getByRole('tab', { name: 'Discussion' }).click()
  await rp.getByRole('button', { name: 'Romans 8:28 in hard seasons' }).click()
  await rp.getByTestId('thread').waitFor()
  check('a hidden post disappears for other members', !/carried me through/.test(await rp.getByTestId('thread').innerText()))
  await lp.getByRole('button', { name: /Lock/ }).first().click()
  await sp.reload({ waitUntil: 'networkidle' })
  await sp.getByRole('tab', { name: 'Discussion' }).click()
  await sp.getByRole('button', { name: 'Romans 8:28 in hard seasons' }).click()
  await sp.getByText('This topic is locked.').waitFor()
  check('a locked topic takes no new posts', (await sp.getByPlaceholder('Add to the discussion').count()) === 0)
  check('there is no direct-message feature anywhere', (await sp.getByText(/direct message|send a message to/i).count()) === 0)

  console.log('6. Joining an open group, and privacy between groups')
  await pp.goto(`${BASE}/church/${org}?tab=groups`, { waitUntil: 'networkidle' })
  await pp.getByTestId('create-group').click()
  await pp.getByLabel('Group name').fill('Men ARISE')
  await pp.getByLabel('Who can find it').selectOption('org')
  await pp.getByRole('button', { name: 'Create group' }).click()
  await pp.getByRole('heading', { name: 'Men ARISE' }).waitFor()
  const menUrl = pp.url()
  await rp.goto(`${BASE}/church/${org}?tab=groups`, { waitUntil: 'networkidle' })
  await rp.getByTestId('open-groups').waitFor()
  await rp.getByRole('button', { name: 'Ask to join' }).click()
  await rp.getByText('Request sent').waitFor()
  await pp.reload({ waitUntil: 'networkidle' })
  await pp.getByRole('tab', { name: 'Members' }).click()
  await pp.getByTestId('join-requests').waitFor()
  await pp.getByRole('button', { name: 'Add to the group' }).click()
  await pp.getByText('Ruth added.').waitFor()
  await pp.getByTestId('group-members').getByText('Ruth').waitFor({ timeout: 10000 }).catch(() => {})
  check('a member asks to join a listed group and the leader adds them', /Ruth/.test(await pp.getByTestId('group-members').innerText()))
  await pp.goto(`${BASE}/church/${org}?tab=groups`, { waitUntil: 'networkidle' })
  await pp.getByTestId('create-group').click()
  await pp.getByLabel('Group name').fill('Elders')
  await pp.getByRole('button', { name: 'Create group' }).click()
  await pp.getByRole('heading', { name: 'Elders' }).waitFor()
  await lp.goto(pp.url(), { waitUntil: 'networkidle' })
  await lp.getByRole('heading', { name: 'Group not available' }).waitFor()
  check('a group leader cannot open a private group they do not lead', true)
  await lp.goto(menUrl, { waitUntil: 'networkidle' })
  check('nor see the members or studies of a listed group they are not in', /Ask to join from the Groups list/.test(await lp.locator('main').innerText()) && (await lp.getByRole('tab', { name: 'Members' }).count()) === 0)

  check('no script errors', !errors.length, errors.join(' | '))
  await browser.close()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log('Failed:\n - ' + failures.join('\n - '))
    process.exit(1)
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
