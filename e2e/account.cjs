/*
 * Accounts and sync in the real app, two browsers acting as two devices, against a Supabase stack.
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=... npx vite build --outDir dist-cloud
 *   VITE_SUPABASE_URL=http://127.0.0.1:54321 npx vite preview --outDir dist-cloud --port 5173
 *   node e2e/account.cjs http://127.0.0.1:5173
 */
const { chromium } = require('playwright')

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const MAIL = process.env.MAILPIT || 'http://127.0.0.1:54324'
let passed = 0
const failures = []
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log('  ok  ' + name)
  } else {
    failures.push(name)
    console.log('  FAIL ' + name + (detail ? ' :: ' + String(detail).slice(0, 300) : ''))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function mailLink(to) {
  for (let i = 0; i < 60; i++) {
    const s = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()
    if (s.messages?.length) {
      const m = await (await fetch(`${MAIL}/api/v1/message/${s.messages[0].ID}`)).json()
      return m.Text.match(/https?:\/\/\S*type=signup\S*/)[0]
    }
    await sleep(250)
  }
  throw new Error('no email')
}
const idb = (page, fn, arg) => page.evaluate(fn, arg)
const putNote = (page, note) =>
  idb(page, (n) => new Promise((res, rej) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const tx = r.result.transaction('notes', 'readwrite'); tx.objectStore('notes').put(n); tx.oncomplete = () => { r.result.close(); res() }; tx.onerror = () => rej(tx.error) } }), note)
const getAll = (page, store) =>
  idb(page, (s) => new Promise((res) => { const r = indexedDB.open('arise-bible-study'); r.onsuccess = () => { const g = r.result.transaction(s).objectStore(s).getAll(); g.onsuccess = () => { r.result.close(); res(g.result) } } }), store)
const status = (page) => page.getByTestId('sync-status').innerText()
async function waitStatus(page, re, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const t = await status(page).catch(() => '')
    if (re.test(t)) return t
    await sleep(300)
  }
  return status(page).catch(() => '')
}
const note = (id, text) => ({ id, ref: 'John.3.16', book: 'John', startKey: 43003016, endKey: 43003016, text, tags: [], createdAt: 1, updatedAt: Date.now() })

;(async () => {
  const browser = await chromium.launch()
  const errors = []
  const email = `pastor-${Date.now()}@example.org`
  const password = 'grace and truth forever'

  console.log('1. A guest with years of notes creates an account on their laptop')
  const lc = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' })
  const laptop = await lc.newPage()
  laptop.on('pageerror', (e) => errors.push('laptop: ' + e.message))
  await laptop.goto(BASE + '/bible/John/3', { waitUntil: 'networkidle' })
  for (let i = 0; i < 30; i++) await putNote(laptop, note('ln' + i, 'Laptop note ' + i))
  check('the account icon shows "not signed in" for guests', /not signed in/.test(await laptop.getByTestId('sync-badge').getAttribute('aria-label')))
  await laptop.getByTestId('sync-badge').click()
  await laptop.getByRole('tab', { name: 'Create an account' }).click()
  await laptop.getByLabel('Email').fill(email)
  await laptop.getByLabel('Password').fill(password)
  await laptop.getByRole('button', { name: 'Create account' }).click()
  check('accounts require confirming age 13 or over', /13 and older/.test(await laptop.getByRole('alert').innerText()))
  await laptop.getByLabel(/I am 13 or older/).check()
  await laptop.getByRole('button', { name: 'Create account' }).click()
  await laptop.locator('text=/Check .* for a link/').waitFor()
  check('after signing up, the person is asked to confirm their email', true)
  await laptop.goto(await mailLink(email), { waitUntil: 'networkidle' })
  await laptop.getByTestId('migration').waitFor({ timeout: 30000 })
  await laptop.getByTestId('migration-summary').waitFor({ timeout: 30000 })
  check('the confirmation link signs in and offers to bring this device’s data into the account', /30 items will be added to your account/.test(await laptop.getByTestId('migration-summary').innerText()), await laptop.getByTestId('migration-summary').innerText())
  check('nothing moved yet: still saved only on this device', /Saved on this device/.test(await status(laptop)))
  const [bk] = await Promise.all([laptop.waitForEvent('download'), laptop.getByRole('button', { name: 'Download a backup first' }).click()])
  check('a backup can be downloaded before moving anything', /\.json$/.test(bk.suggestedFilename()))
  await laptop.getByRole('button', { name: 'Combine with my account' }).click()
  await laptop.getByTestId('migration-result').waitFor({ timeout: 60000 }).catch(async (e) => {
    console.log('SCREEN:', (await laptop.locator('main').innerText()).slice(0, 1500))
    throw e
  })
  check('the move finishes only after the server confirms every item', /30 items on this device are confirmed in your account/.test(await laptop.getByTestId('migration-result').innerText()), await laptop.getByTestId('migration-result').innerText())
  check('then the status says Synced', /^Synced/.test(await waitStatus(laptop, /^Synced/)))
  check('all 30 notes are still on the laptop', (await getAll(laptop, 'notes')).length === 30)

  console.log('2. Signing in on a phone brings everything over')
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'block' })
  const phone = await pc.newPage()
  phone.on('pageerror', (e) => errors.push('phone: ' + e.message))
  await phone.goto(BASE + '/account', { waitUntil: 'networkidle' })
  await phone.getByLabel('Email').fill(email)
  await phone.getByLabel('Password').fill(password)
  await phone.getByRole('button', { name: 'Sign in' }).click()
  await waitStatus(phone, /^Synced/)
  check('the phone receives all 30 notes', (await getAll(phone, 'notes')).length === 30)

  console.log('3. Edits flow between devices automatically')
  await putNote(phone, { ...note('ln1', 'Edited on the phone'), updatedAt: Date.now() })
  await sleep(3500)
  await waitStatus(phone, /^Synced/)
  await laptop.getByRole('button', { name: 'Sync now' }).click()
  await waitStatus(laptop, /^Synced/)
  check('an edit on the phone reaches the laptop', (await getAll(laptop, 'notes')).find((n) => n.id === 'ln1')?.text === 'Edited on the phone')

  console.log('4. Offline on both, the same note edited differently: nothing lost')
  await lc.setOffline(true)
  await pc.setOffline(true)
  await putNote(laptop, { ...note('ln2', 'Laptop wording, written offline'), updatedAt: Date.now() })
  await putNote(phone, { ...note('ln2', 'Phone wording, written offline'), updatedAt: Date.now() })
  await sleep(3000)
  check('offline, the phone says its changes are saved on the device', /Offline/.test(await status(phone)), await status(phone))
  await pc.setOffline(false)
  await phone.evaluate(() => window.dispatchEvent(new Event('online')))
  check('back online, the phone syncs', /^Synced/.test(await waitStatus(phone, /^Synced/)))
  await lc.setOffline(false)
  await laptop.evaluate(() => window.dispatchEvent(new Event('online')))
  const st = await waitStatus(laptop, /Conflict detected/)
  check('the laptop reports a conflict instead of overwriting', /Conflict detected/.test(st), st)
  await laptop.reload({ waitUntil: 'networkidle' })
  await laptop.getByTestId('conflicts').waitFor()
  const c = await laptop.getByTestId('conflicts').innerText()
  check('both versions are shown side by side', /Laptop wording, written offline/.test(c) && /Phone wording, written offline/.test(c))
  await laptop.getByTestId('conflicts').getByRole('button', { name: 'Keep both' }).click()
  await waitStatus(laptop, /^Synced/)
  const both = (await getAll(laptop, 'notes')).filter((n) => /written offline/.test(n.text)).map((n) => n.text).sort()
  check('"Keep both" keeps both wordings', both.length === 2 && both[0].startsWith('Laptop') && both[1].startsWith('Phone'), JSON.stringify(both))
  await phone.getByRole('button', { name: 'Sync now' }).click()
  await waitStatus(phone, /^Synced/)
  check('and the phone receives the kept copy too', (await getAll(phone, 'notes')).filter((n) => /written offline/.test(n.text)).length === 2)

  console.log('5. "Synced" only when the server has confirmed')
  await phone.route('**/rest/v1/rpc/sync_push', (r) => r.abort())
  await putNote(phone, { ...note('new1', 'Not yet on the server'), updatedAt: Date.now() })
  const s5 = await waitStatus(phone, /Sync failed|Offline/, 15000)
  check('when the server cannot be reached, it does not say Synced', !/^Synced/.test(s5), s5)
  await phone.unroute('**/rest/v1/rpc/sync_push')
  await phone.getByRole('button', { name: 'Sync now' }).click()
  check('after a retry it is confirmed', /^Synced/.test(await waitStatus(phone, /^Synced/)))

  console.log('6. Signing out keeps the device working as a guest')
  await phone.getByRole('button', { name: 'Sign out of this device' }).click()
  await phone.getByTestId('auth-form').waitFor()
  const pn = await getAll(phone, 'notes')
  check('after signing out, every note is still on the phone', pn.length === 32, pn.length + ' ' + pn.filter((n) => !/^Laptop note/.test(n.text)).map((n) => n.id + ':' + n.text).join(' / '))
  await phone.goto(BASE + '/bible/John/3', { waitUntil: 'networkidle' })
  check('and the Bible reads as before', /For God so loved the world/.test(await phone.locator('#v-John-3-16').innerText()))

  console.log('7. A different person signing in on that phone is not merged in')
  const other = `other-${Date.now()}@example.org`
  await phone.goto(BASE + '/account', { waitUntil: 'networkidle' })
  await phone.getByRole('tab', { name: 'Create an account' }).click()
  await phone.getByLabel('Email').fill(other)
  await phone.getByLabel('Password').fill(password)
  await phone.getByLabel(/I am 13 or older/).check()
  await phone.getByRole('button', { name: 'Create account' }).click()
  await phone.locator('text=/Check .* for a link/').waitFor()
  await phone.goto(await mailLink(other), { waitUntil: 'networkidle' })
  await phone.getByTestId('other-owner').waitFor({ timeout: 30000 })
  check('the other account is told this device holds someone else’s data, and nothing is combined', new RegExp(email.replace(/[.+]/g, '\\$&')).test(await phone.getByTestId('other-owner').innerText()))

  check('no page errors', errors.length === 0, errors.join(' | '))
  await browser.close()
  console.log(`\n${passed} passed, ${failures.length} failed`)
  process.exit(failures.length ? 1 : 0)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
