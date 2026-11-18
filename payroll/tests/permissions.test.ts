// Server-side permission and database access tests against a throwaway embedded database.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PGLITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arise-payroll-test-'));
process.env.APP_SECRET = 'test-secret-that-is-at-least-32-characters-long';
delete process.env.DATABASE_URL;

// Imported in before() so the environment above is set before the database module loads.
let withCtx: typeof import('../src/lib/db').withCtx;
let SYSTEM: typeof import('../src/lib/db').SYSTEM;
let ctxFor: typeof import('../src/lib/services/core').ctxFor;
let UserError: typeof import('../src/lib/services/core').UserError;
let staff: typeof import('../src/lib/services/staff');
let runs: typeof import('../src/lib/services/runs');
let settings: typeof import('../src/lib/services/settings');

type Actor = import('../src/lib/services/core').Actor;
const mk = (id: string, roles: string[], employee_id: string | null = null): Actor => ({ id, email: `${id}@t.test`, display_name: id, roles, employee_id });
const admin = mk('00000000-0000-4000-8000-00000000000a', ['admin']);
const approver = mk('00000000-0000-4000-8000-00000000000b', ['approver']);
const both = mk('00000000-0000-4000-8000-00000000000c', ['admin', 'approver']);
let empId = '';
let runId = '';

const as = <T,>(a: Actor, fn: (tx: import('../src/lib/db').Queryable) => Promise<T>) => withCtx(ctxFor(a), fn);
const rejects = (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));

before(async () => {
  ({ withCtx, SYSTEM } = await import('../src/lib/db'));
  ({ ctxFor, UserError } = await import('../src/lib/services/core'));
  staff = await import('../src/lib/services/staff');
  runs = await import('../src/lib/services/runs');
  settings = await import('../src/lib/services/settings');
  empId = await as(admin, (tx) =>
    staff.createEmployee(tx, admin, {
      employee_code: 'T-1', first_name: 'Test', last_name: 'Person', email: 't@t.test', phone: '', address_line: '', city: '',
      state: 'AL', postal_code: '', job_title: '', worker_type: 'employee', pay_type: 'salary', flsa_status: 'exempt',
      start_date: '2026-01-01', active: true,
    }, { amount: '52000', effective_date: '2026-01-01' }),
  );
  runId = await as(admin, (tx) => runs.createRun(tx, admin, { schedule: 'biweekly', period_start: '2026-11-09', period_end: '2026-11-22', pay_date: '2026-11-27' }));
});

test('only admins prepare runs; only approvers approve', async () => {
  await rejects(as(approver, (tx) => runs.createRun(tx, approver, { schedule: 'biweekly', period_start: '2026-11-23', period_end: '2026-12-06', pay_date: '2026-12-11' })), /permission/);
  await rejects(as(approver, (tx) => runs.submitRun(tx, approver, runId)), /permission/);
  await as(admin, (tx) => runs.submitRun(tx, admin, runId));
  await rejects(as(admin, (tx) => runs.approveRun(tx, admin, runId, '')), /permission/);
});

test('review flags block approval until an approver confirms', async () => {
  await rejects(as(approver, (tx) => runs.approveRun(tx, approver, runId, '')), /review flags/);
  await rejects(as(admin, (tx) => staff.confirmClassification(tx, admin, empId, 'note')), /permission/);
  await as(approver, (tx) => staff.confirmClassification(tx, approver, empId, 'Reviewed'));
  await as(approver, (tx) => runs.approveRun(tx, approver, runId, ''));
  const r = await as(admin, (tx) => runs.getRun(tx, runId));
  assert.equal(r?.status, 'approved');
  assert.equal(r?.self_approved, false);
});

test('approved runs are locked; reopening clears the approval', async () => {
  await rejects(as(admin, (tx) => runs.addEarningsItem(tx, admin, runId, { employee_id: empId, kind: 'bonus', description: 'x', amount: '5' })), /locked|draft/);
  await as(admin, (tx) => runs.reopenRun(tx, admin, runId, 'Add bonus'));
  const r = await as(admin, (tx) => runs.getRun(tx, runId));
  assert.equal(r?.status, 'draft');
  assert.equal(r?.approved_by, null);
  assert.equal(r?.revision, 2);
});

test('the database itself refuses edits to a submitted run, even if code checks were skipped', async () => {
  await as(admin, (tx) => runs.submitRun(tx, admin, runId));
  await rejects(
    withCtx(SYSTEM, (tx) => tx.query(`insert into payroll.earnings_items (run_id, employee_id, kind, description, amount_cents) values ($1,$2,'bonus','sneaky',100)`, [runId, empId])),
    /only change while it is a draft/,
  );
  await rejects(withCtx(SYSTEM, (tx) => tx.query(`update payroll.pay_runs set status = 'exported' where id = $1`, [runId])), /cannot move from submitted to exported/);
});

test('separate approval is enforced, and same-person approval is recorded when allowed', async () => {
  const r2 = await as(both, (tx) => runs.createRun(tx, both, { schedule: 'biweekly', period_start: '2026-11-23', period_end: '2026-12-06', pay_date: '2026-12-11' }));
  await as(both, (tx) => runs.submitRun(tx, both, r2));
  await rejects(as(both, (tx) => runs.approveRun(tx, both, r2, '')), /Separate approval is required/);
  await as(both, (tx) =>
    settings.updateSettings(tx, both, { org_name: 'Arise Church', require_separate_approver: false, overtime_multiplier: '1.5', pay_schedule: 'biweekly', schedule_anchor_start: '2026-11-09', payday_offset_days: '5' }),
  );
  await as(both, (tx) => runs.approveRun(tx, both, r2, ''));
  const r = await as(both, (tx) => runs.getRun(tx, r2));
  assert.equal(r?.self_approved, true);
  const audit = await withCtx(SYSTEM, (tx) => tx.one<{ summary: string }>(`select summary from payroll.audit_events where action = 'run.approved' and entity_id = $1`, [r2]));
  assert.match(audit!.summary, /same person prepared and approved/);
});

test('staff context cannot read other people, runs or the audit log', async () => {
  const staffActor = mk('00000000-0000-4000-8000-00000000000d', ['staff'], '00000000-0000-4000-8000-0000000000ff');
  const seen = await as(staffActor, async (tx) => ({
    employees: await tx.query('select id from payroll.employees'),
    runs: await tx.query('select id from payroll.pay_runs'),
    audit: await tx.query('select id from payroll.audit_events'),
    rates: await tx.query('select id from payroll.compensation_rates'),
  }));
  assert.deepEqual(seen, { employees: [], runs: [], audit: [], rates: [] });
  await rejects(as(staffActor, (tx) => runs.createRun(tx, staffActor, { schedule: 'weekly', period_start: '2027-01-04', period_end: '2027-01-10', pay_date: '2027-01-15' })), /permission/);
});

test('rate history and the audit log are append-only', async () => {
  await rejects(as(admin, (tx) => tx.query('update payroll.compensation_rates set amount_cents = 1')), /permission denied/);
  await rejects(as(admin, (tx) => tx.query('delete from payroll.audit_events')), /permission denied/);
  await rejects(withCtx(SYSTEM, (tx) => tx.query('delete from payroll.audit_events')), /permission denied/);
});

test('live money movement and tax filing cannot be switched on', async () => {
  await rejects(withCtx(SYSTEM, (tx) => tx.query('update payroll.settings set live_money_movement = true')), /check constraint/);
  await rejects(withCtx(SYSTEM, (tx) => tx.query('update payroll.settings set tax_filing = true')), /check constraint/);
});

test('SSN-like values are refused on staff records', async () => {
  await assert.rejects(
    as(admin, (tx) =>
      staff.createEmployee(tx, admin, {
        employee_code: 'T-2', first_name: 'A', last_name: 'B', email: 'ab@t.test', phone: '', address_line: '123-45-6789', city: '',
        state: 'AL', postal_code: '', job_title: '', worker_type: 'employee', pay_type: 'hourly', flsa_status: 'nonexempt',
        start_date: '2026-01-01', active: true,
      }, { amount: '15', effective_date: '' }),
    ),
    (e: Error) => e instanceof UserError && /Social Security/.test(e.message),
  );
});
