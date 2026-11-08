/*
 * Sharing and announcements in the real app (Release 6.2, Stage E). A member shares a copy of a study from the
 * Study Workspace with their group, updates it, invites an editor, and withdraws it; a workspace-wide outline
 * waits for approval; announcements reach the right people and the "new" count clears once read.
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node e2e/church-share.cjs http://127.0.0.1:5173
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
async function a11y(page, label) {
  const r = await page.evaluate(() => {
    const unnamed = []
    for (const el of document.querySelectorAll('main input:not([type=hidden]), main select, main textarea, main button, main a[href], [role=dialog] input, [role=dialog] select, [role=dialog] textarea, [role=dialog] button')) {
      const name = (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.closest('label')?.innerText || el.getAttribute('title') || el.innerText || el.getAttribute('placeholder') || '').trim()
      if (!name) unnamed.push(el.outerHTML.slice(0, 80))
    }
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    return { unnamed, dup: ids.filter((id, i) => ids.indexOf(id) !== i), scroll: document.documentElement.scrollWidth > window.innerWidth + 1 }
  })
  check(`${label}: controls are named, ids unique, no sideways scrolling`, !r.unnamed.length && !r.dup.length && !r.scroll, r)
}
const idb = (page, fn, arg) => page.evaluate(fn, arg)
const put = (page, store, row) => idb(page, ({ store, row }) => new Promise((res, rej) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const tx = r.result.transaction(store, 'readwrite'); tx.objectStore(store).put(row); tx.oncomplete = () => { r.result.close(); res() }; tx.onerror = () => rej(tx.error) } }), { store, row })
const all = (page, store) => idb(page, (store) => new Promise((res) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const g = r.result.transaction(store).objectStore(store).getAll(); g.onsuccess = () => { r.result.close(); res(g.result) } } }), store)

const now = Date.now()
const block = (id, text) => ({ id, kind: 'note', text })
const STUDY = { id: 'st-romans8', title: 'My Romans 8 notes', passage: 'Rom.8.1-Rom.8.39', sections: { context: [], observation: [block('o1', 'No condemnation for those in Christ.')], wordStudy: [], crossRefs: [], interpretation: [], application: [], summary: [] }, tags: [], folderId: 'private-folder', createdAt: now, updatedAt: now }
const SERMON = { id: 'se-1', title: 'Life in the Spirit', subtitle: '', passage: 'Rom.8.1-Rom.8.17', mainIdea: 'The Spirit gives life.', objective: '', audience: '', length: '', template: 'expository', status: 'draft', tags: [], sections: [{ id: 'x1', type: 'point', title: 'No condemnation', level: 1, blocks: [block('b1', 'Verse 1 is the turning point.')] }], sources: '', createdAt: now, updatedAt: now }
const PRIVATE_NOTE = { id: 'pn-1', ref: 'John.3.16', book: 'John', startKey: 43003016, endKey: 43003016, text: 'MY PRIVATE PRAYER NOTE', tags: [], createdAt: now, updatedAt: now }

;(async () => {
  const pastor = await person('spastor')
  const sam = await person('ssam')
  const ruth = await person('sruth')
  const org = (await pastor.c.rpc('create_org', { p: { name: 'Arise Church', kind: 'church', contact_email: 'office@example.org', display_name: 'Pastor Carter', adult: true } })).data
  for (const [p, name] of [[sam, 'Sam'], [ruth, 'Ruth']]) {
    const inv = await pastor.c.rpc('create_invitation', { o: org, p: { email: p.email, role: 'member' } })
    await p.c.rpc('accept_invitation', { token: inv.data.token, display_name: name, adult: true })
  }
  const G = (await pastor.c.rpc('save_group', { o: org, gid: null, p: { name: 'Romans study' } })).data
  await pastor.c.rpc('set_group_member', { gid: G, u: sam.id, r: 'member' })
  await pastor.c.rpc('set_group_member', { gid: G, u: ruth.id, r: 'member' })

  const browser = await chromium.launch()
  const errors = []
  const page = async (dev) => {
    const c = await browser.newContext({ ...(dev ? devices[dev] : {}), serviceWorkers: 'block' })
    const p = await c.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    return p
  }

  console.log('1. Guests and non-members see no sharing')
  const guest = await page()
  await guest.goto(BASE + '/study', { waitUntil: 'networkidle' })
  await put(guest, 'studies', STUDY)
  await guest.goto(BASE + '/study/st-romans8', { waitUntil: 'networkidle' })
  await guest.getByRole('button', { name: /Turn into sermon/ }).waitFor()
  check('a guest sees no "Share a copy" button', (await guest.getByTestId('share-copy').count()) === 0)

  console.log('2. Sam shares a copy of a study with the group')
  const sp = await page()
  await sp.goto(BASE + '/study', { waitUntil: 'networkidle' })
  await put(sp, 'studies', STUDY)
  await put(sp, 'sermons', SERMON)
  await put(sp, 'notes', PRIVATE_NOTE)
  await signIn(sp, sam)
  await sp.goto(`${BASE}/church/${org}`, { waitUntil: 'networkidle' }) // remembers membership on this device
  await sp.getByRole('heading', { name: 'Arise Church' }).waitFor()
  await sp.goto(BASE + '/study/st-romans8', { waitUntil: 'networkidle' })
  await sp.getByTestId('share-copy').click()
  await sp.getByTestId('share-dialog').waitFor()
  await sp.getByTestId('share-dialog').getByLabel('Share with').selectOption({ label: 'Group: Romans study' })
  check('the dialog says only a copy of this item is shared and the original stays private', /copy of this bible study only/i.test(await sp.getByTestId('share-dialog').innerText()) && /original stays private/.test(await sp.getByTestId('share-dialog').innerText()))
  await a11y(sp, 'Share dialog')
  await sp.getByRole('button', { name: 'Share a copy' }).last().click()
  await sp.getByText('Shared.').waitFor()
  let row = null
  for (let i = 0; i < 40 && !row; i++) {
    row = (await admin.from('org_shared_resources').select('*').eq('org_id', org).eq('kind', 'study').limit(1)).data?.[0] ?? null
    if (!row) await new Promise((r) => setTimeout(r, 250))
  }
  const json = JSON.stringify(row.content)
  check('the shared copy holds the study itself, not its folder or anything else private', /No condemnation/.test(json) && !json.includes('private-folder') && !json.includes('MY PRIVATE PRAYER NOTE') && row.group_id === G)

  console.log('3. Ruth reads it on a phone and keeps her own copy')
  const rp = await page('Pixel 7')
  await rp.goto(BASE + '/bible/John/1', { waitUntil: 'networkidle' })
  await signIn(rp, ruth)
  await rp.goto(`${BASE}/church/${org}?tab=shared`, { waitUntil: 'networkidle' })
  await rp.getByTestId('shared-list').waitFor()
  await rp.getByRole('link', { name: 'My Romans 8 notes' }).click()
  await rp.getByTestId('shared-content').waitFor()
  check('the group member reads the shared study', /No condemnation for those in Christ/.test(await rp.getByTestId('shared-content').innerText()) && /Shared by Sam/.test(await rp.getByTestId('share-byline').innerText()))
  await a11y(rp, 'Shared study (phone)')
  await rp.getByRole('button', { name: 'Save my own copy' }).click()
  await rp.getByText(/A copy was saved/).waitFor()
  check('"Save my own copy" puts an independent study on her device', (await all(rp, 'studies')).some((s) => s.title === 'My Romans 8 notes (copy)' && s.id !== 'st-romans8'))

  console.log('4. Sam updates the copy from his current version, and invites an editor on a note')
  STUDY.sections.observation.push(block('o2', 'Verse 28: all things work together.'))
  await put(sp, 'studies', { ...STUDY, updatedAt: Date.now() })
  await sp.goto(`${BASE}/church/${org}/shared/${row.id}`, { waitUntil: 'networkidle' })
  await sp.getByTestId('update-share').click()
  await sp.getByText('Updated from your current version.').waitFor()
  await rp.reload({ waitUntil: 'networkidle' })
  await rp.getByTestId('shared-content').waitFor()
  check('the group sees the update', /all things work together/.test(await rp.getByTestId('shared-content').innerText()))
  await sp.goto(`${BASE}/church/${org}?tab=shared`, { waitUntil: 'networkidle' })
  await sp.getByTestId('share-something').click()
  await sp.getByLabel('What would you like to share?').selectOption('note')
  await sp.getByLabel('Title').fill('Questions for Tuesday')
  await sp.getByLabel('Note', { exact: true }).fill('1. What does adoption mean in verse 15?')
  await sp.getByRole('button', { name: 'Next' }).click()
  await sp.getByTestId('share-dialog').getByLabel('Share with').selectOption({ label: 'Group: Romans study' })
  await sp.getByRole('button', { name: 'Share a copy' }).last().click()
  await sp.getByText('Shared.').waitFor()
  let note = null
  for (let i = 0; i < 40 && !note; i++) {
    note = (await admin.from('org_shared_resources').select('id').eq('org_id', org).eq('kind', 'note').limit(1)).data?.[0] ?? null
    if (!note) await new Promise((r) => setTimeout(r, 250))
  }
  await sp.goto(`${BASE}/church/${org}/shared/${note.id}`, { waitUntil: 'networkidle' })
  await sp.getByRole('button', { name: 'Editors and access' }).click()
  await sp.getByRole('dialog').getByLabel('Ruth').click()
  await sp.waitForFunction(() => [...document.querySelectorAll('dialog label, [role=dialog] label')].some((l) => /Ruth/.test(l.textContent) && l.querySelector('input').checked), null, { timeout: 8000 })
  await sp.getByRole('button', { name: 'Done' }).click()
  await rp.goto(`${BASE}/church/${org}/shared/${note.id}`, { waitUntil: 'networkidle' })
  await rp.getByLabel('Note').fill('1. What does adoption mean in verse 15?\n2. Who groans in verse 26?')
  await rp.getByRole('button', { name: 'Save changes' }).click()
  await rp.getByText('Saved for everyone.').waitFor()
  await sp.reload({ waitUntil: 'networkidle' })
  await sp.getByTestId('share-byline').waitFor()
  check('an invited editor changes it, and the owner sees who did', /by Ruth/.test(await sp.getByTestId('share-byline').innerText()) && /groans in verse 26/.test(await sp.getByLabel('Note').inputValue()), await sp.getByTestId('share-byline').innerText())

  console.log('5. A workspace-wide share waits for approval')
  await sp.goto(BASE + '/sermons/se-1', { waitUntil: 'networkidle' })
  await sp.getByTestId('share-copy').click()
  check('the dialog warns that workspace-wide shares need approval', /administrator approves/.test(await sp.getByTestId('share-dialog').innerText()))
  await sp.getByRole('button', { name: 'Share a copy' }).last().click()
  await sp.getByText(/An administrator will approve it/).waitFor()
  await rp.goto(`${BASE}/church/${org}?tab=shared`, { waitUntil: 'networkidle' })
  await rp.getByTestId('shared-list').waitFor()
  check('other members do not see it before approval', !/Life in the Spirit/.test(await rp.getByTestId('shared-list').innerText()))
  const pp = await page()
  await signIn(pp, pastor)
  await pp.goto(`${BASE}/church/${org}?tab=shared`, { waitUntil: 'networkidle' })
  await pp.getByTestId('pending-shares').waitFor()
  await pp.getByRole('button', { name: 'Approve' }).click()
  await pp.getByText('Approved for the workspace.').waitFor()
  await rp.reload({ waitUntil: 'networkidle' })
  await rp.getByTestId('shared-list').waitFor()
  check('after approval the workspace sees the outline', /Life in the Spirit/.test(await rp.getByTestId('shared-list').innerText()))

  console.log('6. Withdrawing a share')
  await sp.goto(`${BASE}/church/${org}/shared/${row.id}`, { waitUntil: 'networkidle' })
  sp.once('dialog', (d) => d.accept())
  await sp.getByTestId('revoke-share').click()
  await sp.getByText('Withdrawn.').waitFor()
  await rp.goto(`${BASE}/church/${org}/shared/${row.id}`, { waitUntil: 'networkidle' })
  await rp.getByRole('heading', { name: 'Not available' }).waitFor()
  check('a withdrawn share is gone for everyone', true)
  check('the owner\'s original study is untouched', (await all(sp, 'studies')).some((s) => s.id === 'st-romans8' && s.sections.observation.length === 2))
  check('and Ruth\'s own copy stays hers', (await all(rp, 'studies')).some((s) => s.title === 'My Romans 8 notes (copy)'))

  console.log('7. Announcements')
  await pp.goto(`${BASE}/church/${org}?tab=announcements`, { waitUntil: 'networkidle' })
  await pp.getByTestId('new-announcement').click()
  await pp.getByLabel('Title').fill('Class moves to Thursday')
  await pp.getByLabel('Message').fill('Room 2 this week only.')
  await pp.getByLabel('Pin to the top').check()
  await a11y(pp, 'Announcement dialog')
  await pp.getByRole('button', { name: 'Post', exact: true }).click()
  await pp.getByText('Posted.').waitFor()
  await pp.getByTestId('new-announcement').click()
  await pp.getByLabel('For').selectOption({ label: 'Group: Romans study' })
  await pp.getByLabel('Title').fill('Read Romans 8 before Tuesday')
  await pp.getByRole('button', { name: 'Post', exact: true }).click()
  await pp.getByText('Posted.').waitFor()
  await rp.goto(`${BASE}/church/${org}`, { waitUntil: 'networkidle' })
  await rp.getByRole('tab', { name: /Announcements \(2 new\)/ }).waitFor({ timeout: 10000 })
  check('members see a count of new announcements', true)
  await rp.getByRole('tab', { name: /Announcements/ }).click()
  await rp.getByTestId('announcements').waitFor()
  const anns = await rp.getByTestId('announcements').innerText()
  check('workspace and group announcements both reach a group member, pinned first', /Class moves to Thursday[\s\S]*Read Romans 8/.test(anns), anns)
  check('members cannot post announcements', (await rp.getByTestId('new-announcement').count()) === 0)
  await rp.getByRole('tab', { name: 'Announcements', exact: true }).waitFor({ timeout: 10000 })
  check('once read, the count clears', true)
  const other = await person('sother')
  const inv = await pastor.c.rpc('create_invitation', { o: org, p: { email: other.email, role: 'member' } })
  await other.c.rpc('accept_invitation', { token: inv.data.token, display_name: 'Other', adult: true })
  const seen = ((await other.c.from('org_announcements').select('title').eq('org_id', org)).data ?? []).map((a) => a.title)
  check('people outside the group get only the workspace announcement', seen.includes('Class moves to Thursday') && !seen.includes('Read Romans 8 before Tuesday'), seen)
  await rp.getByRole('tab', { name: 'My membership' }).click()
  await rp.getByLabel(/Show a badge for new announcements/).uncheck()
  await rp.getByRole('button', { name: 'Save', exact: true }).click()
  await rp.getByText('Saved.').waitFor()
  await pastor.c.rpc('post_announcement', { o: org, p: { title: 'Another note' } })
  await rp.goto(`${BASE}/church/${org}`, { waitUntil: 'networkidle' })
  await rp.getByRole('tab', { name: 'Announcements', exact: true }).waitFor()
  check('a member can turn the new-announcement badge off', (await rp.getByRole('tab', { name: /new\)/ }).count()) === 0)

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
