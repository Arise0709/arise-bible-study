// End-to-end acceptance test for the Arise Payroll demo.
// Prereq: a freshly reset demo database and the app running:
//   npm run db:reset && npm run build && npm start      (then, in another terminal)
//   npm run e2e
// Verifies: admin prepares a run, approver returns then approves it, separate approval is enforced,
// admin exports, records the batch, imports provider results (with a deliberate mismatch first),
// reconciles, and every staff member can open only their own published statements.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
// Playwright is not a project dependency (it is large). Install it once with: npm i -g playwright && npx playwright install chromium
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const PASSWORD = 'AriseDemo2026';
const DOMAIN = 'arise-demo.test';
const MFA = {
  admin: 'JBSWY3DPEHPK3PXPAAAADEMOADMN',
  approver: 'JBSWY3DPEHPK3PXPAAAADEMOAPPR',
  exec: 'JBSWY3DPEHPK3PXPAAAADEMOEXEC',
};
const SHOTS = path.join(process.cwd(), 'e2e', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// ------------------------------------------------------------ helpers
function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// The server blocks re-use of a code (replay protection); it accepts one step of drift ahead.
const lastStep = {};
async function freshCode(secret) {
  for (;;) {
    const now = Math.floor(Date.now() / 30000);
    const step = Math.max(now, (lastStep[secret] ?? -1) + 1);
    if (step <= now + 1) { lastStep[secret] = step; return totp(secret, step); }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let passed = 0;
function ok(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}
async function flash(page) {
  const el = page.locator('.flash');
  return (await el.count()) ? (await el.first().innerText()).trim() : '';
}

const browser = await chromium.launch();

async function session(email, mfaSecret, device) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept()); // accept "Are you sure?" confirmations
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await submit(page, page.locator('button[type=submit]'));
  if (mfaSecret) {
    ok(page.url().endsWith('/mfa'), `${email} is asked for an MFA code`);
    await page.fill('input[name=code]', await freshCode(mfaSecret));
    await submit(page, page.locator('button:has-text("Verify")'));
  }
  return { ctx, page };
}
// Server actions POST, then the router navigates. Wait for both before checking the page.
async function submit(page, locator) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST', { timeout: 30000 }),
    locator.click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
}
async function click(page, text, scope = page) {
  await submit(page, scope.locator(`button:has-text("${text}")`).first());
}

try {
  // ======================================================== 1. sign-in protections
  console.log('\n1. Sign-in and MFA');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/dashboard`);
    ok(page.url().includes('/login'), 'signed-out visitors are sent to sign-in');
    await page.fill('input[name=email]', `admin@${DOMAIN}`);
    await page.fill('input[name=password]', 'wrong-password-123');
    await submit(page, page.locator('button[type=submit]'));
    ok((await flash(page)).includes('did not match'), 'a wrong password is rejected');
    await page.fill('input[name=email]', `admin@${DOMAIN}`);
    await page.fill('input[name=password]', PASSWORD);
    await submit(page, page.locator('button[type=submit]'));
    await page.goto(`${BASE}/runs`);
    ok(page.url().endsWith('/mfa'), 'an admin cannot reach payroll pages before finishing MFA');
    await page.fill('input[name=code]', '000000');
    await submit(page, page.locator('button:has-text("Verify")'));
    ok((await flash(page)).includes('did not work'), 'a wrong MFA code is rejected');
    await ctx.close();
  }

  // ======================================================== 2. admin prepares the run
  console.log('\n2. Admin prepares the sample pay run');
  const admin = await session(`admin@${DOMAIN}`, MFA.admin);
  let p = admin.page;
  ok(p.url().endsWith('/dashboard'), `admin lands on the dashboard (at ${p.url()} ${await flash(p)})`);
  const dash = await p.locator('.stats').innerText();
  ok(/Next payday/i.test(dash) && dash.includes('Nov 27, 2026'), 'dashboard shows the next payday (Nov 27, 2026)');
  ok(/Current pay period/i.test(dash) && dash.includes('Nov 9'), 'dashboard shows the current pay period');
  ok(/Draft payroll/i.test(dash) && dash.includes('$5,997.57'), 'dashboard shows draft payroll totals');
  await p.screenshot({ path: path.join(SHOTS, '01-dashboard.png'), fullPage: true });

  await p.click('text=All pay runs →');
  await p.waitForURL(/\/runs$/);
  await p.click('a:text-is("#2")');
  await p.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  await p.waitForLoadState('networkidle');
  const runUrl = p.url();
  ok(/\/runs\/[0-9a-f-]{36}$/.test(runUrl), 'opened draft run #2');
  const breakdown = await p.locator('#breakdown').innerText();
  ok(breakdown.includes('$18.50/hr') && breakdown.includes('$19.25/hr'), 'hourly pay uses each day’s effective rate (raise on Nov 16)');
  ok(breakdown.includes('Housing allowance (designated'), 'clergy housing allowance is its own line');
  ok(breakdown.includes('$650.00'), 'contractor payment is shown');

  // CSV upload of hours
  await p.setInputFiles('input[name=file]', path.join(process.cwd(), 'demo', 'sample-hours.csv'));
  await click(p, 'Upload CSV');
  { const f = await flash(p); ok(f.includes('Imported 1 time entries'), `hours CSV imported as pending [${f}]`); }
  await click(p, 'Submit for review');
  ok((await flash(p)).includes('still pending'), 'cannot submit with pending hours');
  await click(p, 'Approve all 1 pending');
  ok((await flash(p)).includes('Approved 1'), 'admin approves the uploaded hours');
  // a manual adjustment
  await p.selectOption('form:has(input[name=description]) select[name=employee_id]', { label: 'Simone Reyes (Contractor)' });
  await p.selectOption('select[name=kind]', 'bonus');
  await p.fill('input[name=description]', 'Christmas gift');
  await p.fill('input[name=amount]', '50');
  await click(p, 'Add line item');
  ok((await flash(p)).includes('Contractors are paid with contractor payments only'), 'contractor payments stay separate from employee earnings');

  ok((await p.locator('button:has-text("Approve pay run")').count()) === 0, 'admin (not an approver) sees no approve button');
  await click(p, 'Submit for review');
  ok((await flash(p)).includes('Submitted for review'), 'admin submits the run for review');
  ok((await p.locator('.badge-submitted').count()) > 0, 'status is Submitted for review');
  ok((await p.locator('input[name=regular_hours]').count()) === 0, 'hours entry is locked once submitted');
  await p.screenshot({ path: path.join(SHOTS, '02-run-submitted.png'), fullPage: true });

  // ======================================================== 3. approver reviews
  console.log('\n3. Approver reviews, returns, then approves');
  const approver = await session(`approver@${DOMAIN}`, MFA.approver);
  let a = approver.page;
  await a.goto(runUrl);
  ok((await a.locator('text=Review flags').count()) > 0, 'review flags are shown to the approver');
  await click(a, 'Approve pay run');
  ok((await flash(a)).includes('Clear these review flags'), 'approval is blocked until clergy and classification flags are confirmed');
  await a.fill('input[name=reason]', 'Please double-check the Saturday hours with Tyrese.');
  await click(a, 'Return to admin');
  ok((await flash(a)).includes('Returned'), 'approver returns the run with a reason');

  await p.reload();
  ok((await p.locator('text=Returned for changes').count()) > 0 && (await p.innerText('body')).includes('Saturday hours'), 'admin sees the return reason');
  await click(p, 'Submit for review');
  ok((await flash(p)).includes('Submitted'), 'admin resubmits');

  await a.reload();
  const flagForms = a.locator('form:has(input[name=which])');
  const nFlags = await flagForms.count();
  for (let i = 0; i < nFlags; i++) {
    const f = a.locator('form:has(input[name=which])').first();
    await f.locator('input[name=note]').fill('DEMO: confirmed with provider onboarding call on 11/18');
    await click(a, 'Confirm', f);
  }
  ok((await a.locator('form:has(input[name=which])').count()) === 0, `approver confirms ${nFlags} review flags`);
  await a.fill('input[name=comment]', 'Reviewed totals and hours.');
  await click(a, 'Approve pay run');
  ok((await flash(a)).includes('approved'), 'approver approves the run');
  await a.screenshot({ path: path.join(SHOTS, '03-run-approved.png'), fullPage: true });

  // ======================================================== 4. export
  console.log('\n4. Admin exports for the payroll provider');
  await p.reload();
  await click(p, 'Export review CSV');
  ok((await flash(p)).includes('Review CSV created'), 'admin exports the approved run');
  const links = await p.locator('a[href^="/api/exports/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  ok(links.length === 2, 'two files: employee payroll and contractor payments, kept separate');
  const empCsv = await (await p.request.get(BASE + links[0])).text();
  ok(empCsv.startsWith('# REVIEW COPY') && empCsv.includes('Housing Allowance') && empCsv.includes('AR-1003'), 'employee review CSV is labeled and includes clergy lines');
  ok(!empCsv.includes('AR-2001'), 'contractor is not in the employee payroll file');
  const tyreseRows = empCsv.split('\r\n').filter((r) => r.startsWith('AR-1002'));
  ok(tyreseRows.length === 2 && tyreseRows[0].includes(',18.50,') && tyreseRows[1].includes(',19.25,'), 'mid-period raise exports as two rows, one per hourly rate');
  const conCsv = await (await p.request.get(BASE + links[1])).text();
  ok(conCsv.includes('CONTRACTOR PAYMENTS') && conCsv.includes('AR-2001'), 'contractor file holds the contractor payment');

  // ======================================================== 5. reconcile
  console.log('\n5. Admin records the batch, imports results and reconciles');
  await p.fill('input[name=ref]', 'DEMO-BATCH-26-1127');
  await click(p, 'Save reference');
  ok((await flash(p)).includes('batch reference saved'), 'provider batch reference recorded');

  const mock = await (await p.request.get(`${BASE}${new URL(runUrl).pathname.replace('/runs/', '/api/runs/')}/mock-results`)).text();
  const badPath = path.join(SHOTS, 'results-with-mismatch.csv');
  const goodPath = path.join(SHOTS, 'results.csv');
  fs.writeFileSync(goodPath, mock);
  fs.writeFileSync(badPath, mock.replace(/^(AR-1002,)([\d.]+)/m, (_m, a, g) => `${a}${(Number(g) + 25).toFixed(2)}`));
  await p.setInputFiles('#reconcile input[name=file]', badPath);
  await click(p, 'Import results');
  ok((await flash(p)).includes('need attention'), 'a $25 gross mismatch is flagged');
  await click(p, 'Mark reconciled and publish statements');
  ok((await flash(p)).includes('still open'), 'reconciliation is blocked while differences are open');
  await p.screenshot({ path: path.join(SHOTS, '04-mismatch.png'), fullPage: true });
  await p.setInputFiles('#reconcile input[name=file]', goodPath);
  await click(p, 'Import results');
  ok((await flash(p)).includes('Everything matches'), 'corrected provider results match the approved run');
  await click(p, 'Mark reconciled and publish statements');
  ok((await flash(p)).includes('4 pay statements'), 'run reconciled and 4 statements published');
  ok((await p.locator('.badge-reconciled').count()) > 0, 'status is Reconciled');
  const statementLinks = await p.locator('a[href^="/me/statements/"]').evaluateAll((els) => els.map((e) => ({ href: e.getAttribute('href'), name: e.textContent.trim() })));
  await p.screenshot({ path: path.join(SHOTS, '05-reconciled.png'), fullPage: true });

  // audit trail
  await p.goto(`${BASE}/audit`);
  const auditText = await p.innerText('body');
  for (const w of ['Approved pay run #2', 'Exported pay run #2', 'Returned pay run #2', 'Reconciled pay run #2', 'New hourly rate']) ok(auditText.includes(w), `audit log records: ${w}`);

  // ======================================================== 6. separate approval setting
  console.log('\n6. Separate approval is enforced and configurable');
  const exec = await session(`exec@${DOMAIN}`, MFA.exec);
  const e = exec.page;
  await e.goto(`${BASE}/runs/new`);
  await click(e, 'Create draft run');
  ok((await flash(e)).includes('Pay run created'), 'admin+approver (Ruth) starts the next run (Nov 23 – Dec 6)');
  const run3 = e.url().split('?')[0];
  await click(e, 'Submit for review');
  await click(e, 'Approve pay run');
  ok((await flash(e)).includes('Separate approval is required'), 'the preparer cannot approve their own run while separate approval is on');
  await e.goto(`${BASE}/settings`);
  await e.uncheck('input[name=require_separate_approver]');
  await click(e, 'Save payroll rules');
  await e.goto(run3);
  await click(e, 'Approve pay run');
  ok((await e.innerText('body')).includes('Same-person approval'), 'with the setting off, same-person approval is allowed and marked');
  await e.goto(`${BASE}/settings`);
  await e.check('input[name=require_separate_approver]');
  await click(e, 'Save payroll rules');

  // ======================================================== 7. staff privacy
  console.log('\n7. Staff see only their own statements');
  const people = [
    ['grace', 'Grace Holloway'],
    ['tyrese', 'Tyrese Lambert'],
    ['nathaniel', 'Nathaniel Brooks'],
    ['simone', 'Simone Reyes'],
  ];
  for (const [user, name] of people) {
    const s = await session(`${user}@${DOMAIN}`, null, user === 'tyrese' ? 'iPhone 13' : undefined);
    const sp = s.page;
    ok(sp.url().endsWith('/me'), `${name} lands on My pay (no MFA needed for staff-only accounts)`);
    const rows = await sp.locator('a[href^="/me/statements/"]').count();
    ok(rows === 2, `${name} sees exactly 2 statements (their own)`);
    const own = statementLinks.find((l) => l.name === name);
    const others = statementLinks.filter((l) => l.name !== name);
    await sp.goto(BASE + own.href);
    ok(/net pay/i.test(await sp.innerText('body')) && (await sp.innerText('body')).includes(name), `${name} can open their own statement`);
    if (user === 'tyrese') await sp.screenshot({ path: path.join(SHOTS, '06-statement-mobile.png'), fullPage: true });
    for (const other of others) {
      const resp = await sp.goto(BASE + other.href);
      ok(resp.status() === 404, `${name} gets "not found" for ${other.name}’s statement`);
    }
    await sp.goto(`${BASE}/runs`);
    ok(sp.url().endsWith('/forbidden'), `${name} cannot open pay runs`);
    await sp.goto(`${BASE}/staff`);
    ok(sp.url().endsWith('/forbidden'), `${name} cannot open staff records`);
    const api = await sp.request.get(BASE + links[0]);
    ok(api.status() === 403, `${name} cannot download payroll exports (403)`);
    await s.ctx.close();
  }

  // approver cannot change settings
  await a.goto(`${BASE}/settings`);
  ok(a.url().endsWith('/forbidden'), 'an approver (without admin) cannot open Settings');

  // mobile screenshot of the run page
  const mob = await session(`approver@${DOMAIN}`, MFA.approver, 'iPhone 13');
  await mob.page.goto(runUrl);
  await mob.page.screenshot({ path: path.join(SHOTS, '07-run-mobile.png'), fullPage: false });
  const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'run page has no sideways page scroll on a phone');

  console.log(`\nAll ${passed} checks passed.`);
} catch (err) {
  console.error(`\n${err.message}`);
  console.log(`(${passed} checks passed before the failure)`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
