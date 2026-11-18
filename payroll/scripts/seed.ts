/**
 * Demo data. Every person, amount and reference here is FICTIONAL.
 * Run with `npm run db:seed` (or `npm run db:reset` to start fresh).
 */
import fs from 'node:fs';
import path from 'node:path';
import { withCtx, SYSTEM } from '../src/lib/db';
import { getDriver } from '../src/lib/db-driver';
import { encryptSecret, hashPassword } from '../src/lib/crypto';
import { ctxFor, type Actor } from '../src/lib/services/core';
import { addHousingAllowance, addRate, clearReviewFlag, confirmClassification, confirmClergyConfig, createEmployee } from '../src/lib/services/staff';
import {
  addEarningsItem,
  addTimeEntry,
  approveRun,
  createRun,
  submitRun,
} from '../src/lib/services/runs';
import {
  exportRun,
  importProviderResults,
  mockProviderResultsCsv,
  recordBatchRef,
  reconcileRun,
} from '../src/lib/services/provider';
import { DEMO_PASSWORD, DEMO_DOMAIN, DEMO_MFA } from '../src/lib/demo';

process.env.APP_SECRET ||= loadEnvSecret();

function loadEnvSecret(): string {
  for (const f of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), f);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/^APP_SECRET=(.+)$/m);
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  throw new Error('Set APP_SECRET in .env.local before seeding (see .env.example).');
}

async function main() {
  const driver = await getDriver();
  if (driver.kind === 'postgres') {
    const { migrate } = await import('../src/lib/migrate');
    await migrate(driver, { quiet: true });
  }

  const existing = await withCtx(SYSTEM, (tx) => tx.query<{ email: string }>('select email from payroll.users'));
  if (existing.some((u) => !u.email.endsWith(`@${DEMO_DOMAIN}`))) {
    throw new Error('Real accounts exist in this database. The demo seed will not run here.');
  }
  if (existing.length) {
    console.log('Demo data is already loaded. Use `npm run db:reset` to start over.');
    return;
  }

  // ---------------------------------------------------------------- accounts
  const pw = hashPassword(DEMO_PASSWORD);
  const mkUser = (email: string, name: string, roles: string[], mfa?: string) =>
    withCtx(SYSTEM, async (tx) => {
      const row = await tx.one<{ id: string }>(
        `insert into payroll.users (email, display_name, roles, status, password_hash, mfa_secret_enc, mfa_enabled_at)
         values ($1,$2,$3,'active',$4,$5,$6) returning id`,
        [email, name, roles, pw, mfa ? encryptSecret(mfa) : null, mfa ? new Date().toISOString() : null],
      );
      return { id: row!.id, email, display_name: name, roles, employee_id: null } as Actor;
    });

  const admin = await mkUser(`admin@${DEMO_DOMAIN}`, 'Dana Whitfield', ['admin'], DEMO_MFA.admin);
  const approver = await mkUser(`approver@${DEMO_DOMAIN}`, 'Marcus Bell', ['approver'], DEMO_MFA.approver);
  await mkUser(`exec@${DEMO_DOMAIN}`, 'Ruth Okafor', ['admin', 'approver'], DEMO_MFA.exec);

  const A = (fn: Parameters<typeof withCtx>[1]) => withCtx(ctxFor(admin), fn);
  const P = (fn: Parameters<typeof withCtx>[1]) => withCtx(ctxFor(approver), fn);

  // ---------------------------------------------------------------- staff (fictional)
  const base = { phone: '', address_line: '', city: 'Decatur', state: 'AL', postal_code: '35601', active: true };
  const grace = (await A((tx) =>
    createEmployee(tx, admin, {
      ...base, employee_code: 'AR-1001', first_name: 'Grace', last_name: 'Holloway', email: `grace@${DEMO_DOMAIN}`,
      phone: '(256) 555-0141', job_title: 'Office Manager', worker_type: 'employee', pay_type: 'salary',
      flsa_status: 'exempt', start_date: '2024-03-04',
    }, { amount: '46000', effective_date: '2024-03-04' }),
  )) as string;
  await A((tx) => addRate(tx, admin, grace, { amount: '48500', effective_date: '2026-01-05', reason: 'Annual review, board approved' }));

  const tyrese = (await A((tx) =>
    createEmployee(tx, admin, {
      ...base, employee_code: 'AR-1002', first_name: 'Tyrese', last_name: 'Lambert', email: `tyrese@${DEMO_DOMAIN}`,
      phone: '(256) 555-0172', job_title: 'Facilities & Hospitality Coordinator', worker_type: 'employee', pay_type: 'hourly',
      flsa_status: 'nonexempt', start_date: '2025-06-02',
    }, { amount: '18.50', effective_date: '2025-06-02' }),
  )) as string;
  // Raise that lands in the middle of the demo pay period, to show effective-date accuracy.
  await A((tx) => addRate(tx, admin, tyrese, { amount: '19.25', effective_date: '2026-11-16', reason: 'Six-month review' }));

  const nathaniel = (await A((tx) =>
    createEmployee(tx, admin, {
      ...base, employee_code: 'AR-1003', first_name: 'Nathaniel', last_name: 'Brooks', email: `nathaniel@${DEMO_DOMAIN}`,
      phone: '(256) 555-0118', job_title: 'Associate Pastor (ordained)', worker_type: 'clergy', pay_type: 'salary',
      flsa_status: 'exempt', start_date: '2023-08-01',
    }, { amount: '58000', effective_date: '2023-08-01' }),
  )) as string;
  await A((tx) => addRate(tx, admin, nathaniel, { amount: '62400', effective_date: '2026-01-01', reason: '2026 compensation package' }));
  await A((tx) =>
    addHousingAllowance(tx, admin, nathaniel, {
      annual_amount: '18000', effective_date: '2026-01-01', approval_reference: 'DEMO Board resolution 2025-12-14, item 4',
      approved_by_body: 'Church Board (fictional)', approved_on: '2025-12-14',
    }),
  );

  const simone = (await A((tx) =>
    createEmployee(tx, admin, {
      ...base, employee_code: 'AR-2001', first_name: 'Simone', last_name: 'Reyes', email: `simone@${DEMO_DOMAIN}`,
      phone: '(256) 555-0190', job_title: 'AV & Livestream Technician (Reyes Sound & Media, fictional)', worker_type: 'contractor',
      pay_type: 'contract', flsa_status: 'not_applicable', start_date: '2025-09-07',
    }, { amount: '0', effective_date: '2025-09-07' }),
  )) as string;

  // Staff logins (no MFA required for staff-only accounts)
  for (const [email, name, emp] of [
    [`grace@${DEMO_DOMAIN}`, 'Grace Holloway', grace],
    [`tyrese@${DEMO_DOMAIN}`, 'Tyrese Lambert', tyrese],
    [`nathaniel@${DEMO_DOMAIN}`, 'Nathaniel Brooks', nathaniel],
    [`simone@${DEMO_DOMAIN}`, 'Simone Reyes', simone],
  ]) {
    await withCtx(SYSTEM, (tx) =>
      tx.query(
        `insert into payroll.users (email, display_name, roles, employee_id, status, password_hash) values ($1,$2,'{staff}',$3,'active',$4)`,
        [email, name, emp, pw],
      ),
    );
  }

  // Review flags confirmed for the earlier pay period
  for (const id of [grace, tyrese, nathaniel, simone])
    await P((tx) => confirmClassification(tx, approver, id, 'DEMO: reviewed with church treasurer and provider onboarding'));
  await P((tx) =>
    confirmClergyConfig(tx, approver, nathaniel, 'DEMO: provider set up as minister; no FICA withholding; housing allowance excluded from federal income tax wages'),
  );

  // ---------------------------------------------------------------- history: a completed pay period
  const past = (await A((tx) =>
    createRun(tx, admin, { schedule: 'biweekly', period_start: '2026-10-26', period_end: '2026-11-08', pay_date: '2026-11-13' }),
  )) as string;
  const days = (start: string, n: number) =>
    Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10));
  for (const d of [...days('2026-10-26', 5), ...days('2026-11-02', 5)])
    await A((tx) => addTimeEntry(tx, admin, past, { employee_id: tyrese, work_date: d, regular_hours: '8', overtime_hours: '0', note: '', approved: true }));
  await A((tx) => addEarningsItem(tx, admin, past, { employee_id: simone, kind: 'contractor_payment', description: 'Sound & livestream, 2 Sundays (invoice RSM-1031)', amount: '650' }));
  await A((tx) => submitRun(tx, admin, past));
  await P((tx) => approveRun(tx, approver, past, 'Looks right'));
  await A((tx) => exportRun(tx, admin, past));
  await A((tx) => recordBatchRef(tx, admin, past, 'DEMO-BATCH-26-1113'));
  const pastResults = (await A((tx) => mockProviderResultsCsv(tx, past))) as string;
  await A((tx) => importProviderResults(tx, admin, past, 'demo-provider-results-2026-11-13.csv', pastResults));
  await A((tx) => reconcileRun(tx, admin, past));

  // Year-end review re-opens two flags so the demo shows the review step.
  await P((tx) => clearReviewFlag(tx, approver, nathaniel, 'clergy'));
  await P((tx) => clearReviewFlag(tx, approver, simone, 'classification'));

  // ---------------------------------------------------------------- the sample pay period (draft)
  const current = (await A((tx) =>
    createRun(tx, admin, { schedule: 'biweekly', period_start: '2026-11-09', period_end: '2026-11-22', pay_date: '2026-11-27', notes: 'Thanksgiving week: confirm provider holiday cutoff.' }),
  )) as string;
  for (const d of days('2026-11-09', 5))
    await A((tx) => addTimeEntry(tx, admin, current, { employee_id: tyrese, work_date: d, regular_hours: '8', overtime_hours: '0', note: '', approved: true }));
  for (const d of days('2026-11-16', 4))
    await A((tx) => addTimeEntry(tx, admin, current, { employee_id: tyrese, work_date: d, regular_hours: '8', overtime_hours: '0', note: '', approved: true }));
  await A((tx) => addTimeEntry(tx, admin, current, { employee_id: tyrese, work_date: '2026-11-20', regular_hours: '8', overtime_hours: '2.5', note: 'Harvest dinner setup', approved: true }));
  await A((tx) => addEarningsItem(tx, admin, current, { employee_id: grace, kind: 'reimbursement', description: 'Office supplies (receipt #1182)', amount: '42.18' }));
  await A((tx) => addEarningsItem(tx, admin, current, { employee_id: grace, kind: 'bonus', description: 'Thanksgiving appreciation gift', amount: '150' }));
  await A((tx) => addEarningsItem(tx, admin, current, { employee_id: tyrese, kind: 'deduction', description: 'Uniform shirts (signed authorization on file)', amount: '25' }));
  await A((tx) => addEarningsItem(tx, admin, current, { employee_id: simone, kind: 'contractor_payment', description: 'Sound & livestream, 2 Sundays (invoice RSM-1107)', amount: '650' }));

  // Mock provider results file matching the sample period, for the reconciliation step.
  const mock = (await A((tx) => mockProviderResultsCsv(tx, current))) as string;
  fs.mkdirSync(path.join(process.cwd(), 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), 'demo', 'mock-provider-results.csv'),
    `# DEMO ONLY - fictional provider results for the sample pay period (Nov 9 - Nov 22, 2026).\n# Withholding figures are made up and are not tax calculations.\n${mock}`,
  );
  fs.writeFileSync(
    path.join(process.cwd(), 'demo', 'sample-hours.csv'),
    'employee_code,work_date,regular_hours,overtime_hours,note\nAR-1002,2026-11-21,4,0,Saturday youth event setup\n',
  );

  console.log('Demo data loaded (all fictional).');
  console.log(`  Sign in at the app with any demo account. Password: ${DEMO_PASSWORD}`);
  await driver.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
