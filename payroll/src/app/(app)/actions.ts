'use server';
import { cookies } from 'next/headers';
import { act, back } from '@/lib/action';
import { str } from '@/lib/services/core';
import * as staff from '@/lib/services/staff';
import * as runs from '@/lib/services/runs';
import * as provider from '@/lib/services/provider';
import * as settings from '@/lib/services/settings';
import * as accounts from '@/lib/services/accounts';
import { UserError } from '@/lib/services/core';

const s = (f: FormData, k: string) => str(f.get(k));
const MAX_UPLOAD = 1_000_000;

async function readUpload(f: FormData, key = 'file'): Promise<{ name: string; text: string }> {
  const file = f.get(key);
  if (!(file instanceof File) || file.size === 0) throw new UserError('Choose a CSV file to upload.');
  if (file.size > MAX_UPLOAD) throw new UserError('That file is larger than 1 MB.');
  if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain|excel/.test(file.type))
    throw new UserError('Upload a .csv file.');
  return { name: file.name.replace(/[^\w.\- ]/g, '_').slice(0, 120), text: await file.text() };
}

function employeeInput(f: FormData): staff.EmployeeInput {
  return {
    employee_code: s(f, 'employee_code').toUpperCase(),
    first_name: s(f, 'first_name'),
    last_name: s(f, 'last_name'),
    email: s(f, 'email'),
    phone: s(f, 'phone'),
    address_line: s(f, 'address_line'),
    city: s(f, 'city'),
    state: s(f, 'state').toUpperCase().slice(0, 2),
    postal_code: s(f, 'postal_code'),
    job_title: s(f, 'job_title'),
    worker_type: s(f, 'worker_type'),
    pay_type: s(f, 'pay_type'),
    flsa_status: s(f, 'flsa_status'),
    start_date: s(f, 'start_date'),
    active: f.get('active') === 'on',
  };
}

// ------------------------------------------------------------------ staff
export async function createEmployeeAction(f: FormData) {
  await act(
    { roles: ['admin'], back: '/staff/new', success: 'Staff record added.', next: (id: string) => `/staff/${id}` },
    (tx, a) => staff.createEmployee(tx, a, employeeInput(f), { amount: s(f, 'rate_amount'), effective_date: s(f, 'rate_effective') }),
  );
}
export async function updateEmployeeAction(f: FormData) {
  const id = s(f, 'id');
  await act({ roles: ['admin'], back: `/staff/${id}`, success: 'Saved.' }, (tx, a) => staff.updateEmployee(tx, a, id, employeeInput(f)));
}
export async function addRateAction(f: FormData) {
  const id = s(f, 'id');
  await act({ roles: ['admin'], back: `/staff/${id}`, success: 'New pay rate recorded.' }, (tx, a) =>
    staff.addRate(tx, a, id, { amount: s(f, 'amount'), effective_date: s(f, 'effective_date'), reason: s(f, 'reason') }),
  );
}
export async function addHousingAction(f: FormData) {
  const id = s(f, 'id');
  await act({ roles: ['admin'], back: `/staff/${id}`, success: 'Housing allowance designation recorded. An approver must re-confirm the provider setup.' }, (tx, a) =>
    staff.addHousingAllowance(tx, a, id, {
      annual_amount: s(f, 'annual_amount'),
      effective_date: s(f, 'effective_date'),
      approval_reference: s(f, 'approval_reference'),
      approved_by_body: s(f, 'approved_by_body'),
      approved_on: s(f, 'approved_on'),
    }),
  );
}
export async function confirmFlagAction(f: FormData) {
  const id = s(f, 'id');
  const which = s(f, 'which');
  await act({ roles: ['approver'], back: back(f, `/staff/${id}`), success: 'Review flag cleared.' }, (tx, a) =>
    which === 'clergy' ? staff.confirmClergyConfig(tx, a, id, s(f, 'note')) : staff.confirmClassification(tx, a, id, s(f, 'note')),
  );
}
export async function reopenFlagAction(f: FormData) {
  const id = s(f, 'id');
  await act({ roles: ['admin', 'approver'], back: `/staff/${id}`, success: 'Review flag reopened.' }, (tx, a) =>
    staff.clearReviewFlag(tx, a, id, s(f, 'which') === 'clergy' ? 'clergy' : 'classification'),
  );
}

// ------------------------------------------------------------------ runs
export async function createRunAction(f: FormData) {
  await act(
    { roles: ['admin'], back: '/runs/new', success: 'Pay run created. Salaried and clergy pay were added automatically.', next: (id: string) => `/runs/${id}` },
    (tx, a) =>
      runs.createRun(tx, a, {
        schedule: s(f, 'schedule'),
        period_start: s(f, 'period_start'),
        period_end: s(f, 'period_end'),
        pay_date: s(f, 'pay_date'),
        notes: s(f, 'notes'),
      }),
  );
}
const runBack = (f: FormData) => `/runs/${s(f, 'run_id')}`;

export async function addTimeAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#hours', success: 'Hours added.' }, (tx, a) =>
    runs.addTimeEntry(tx, a, s(f, 'run_id'), {
      employee_id: s(f, 'employee_id'),
      work_date: s(f, 'work_date'),
      regular_hours: s(f, 'regular_hours'),
      overtime_hours: s(f, 'overtime_hours'),
      note: s(f, 'note'),
      approved: f.get('approved') === 'on',
    }),
  );
}
export async function approveHoursAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#hours', success: (n: number) => `Approved ${n} time entr${n === 1 ? 'y' : 'ies'}.` }, (tx, a) =>
    runs.approvePendingHours(tx, a, s(f, 'run_id'), s(f, 'entry_id') || undefined),
  );
}
export async function deleteTimeAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#hours', success: 'Time entry removed.' }, (tx, a) =>
    runs.deleteTimeEntry(tx, a, s(f, 'run_id'), s(f, 'entry_id')),
  );
}
export async function importTimeAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#hours', success: (n: number) => `Imported ${n} time entries. Review and approve them below.` }, async (tx, a) => {
    const up = await readUpload(f);
    return runs.importTimeCsv(tx, a, s(f, 'run_id'), up.name, up.text);
  });
}
export async function addItemAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#earnings', success: 'Line item added.' }, (tx, a) =>
    runs.addEarningsItem(tx, a, s(f, 'run_id'), {
      employee_id: s(f, 'employee_id'),
      kind: s(f, 'kind'),
      description: s(f, 'description'),
      amount: s(f, 'amount'),
    }),
  );
}
export async function deleteItemAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#earnings', success: 'Line item removed.' }, (tx, a) =>
    runs.deleteEarningsItem(tx, a, s(f, 'run_id'), s(f, 'item_id')),
  );
}
export async function submitRunAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f), success: 'Submitted for review. An approver can now review and approve it.' }, (tx, a) =>
    runs.submitRun(tx, a, s(f, 'run_id')),
  );
}
export async function approveRunAction(f: FormData) {
  await act({ roles: ['approver'], back: runBack(f), success: 'Pay run approved. A payroll admin can now export it.' }, (tx, a) =>
    runs.approveRun(tx, a, s(f, 'run_id'), s(f, 'comment')),
  );
}
export async function returnRunAction(f: FormData) {
  await act({ roles: ['approver'], back: runBack(f), success: 'Returned to the admin as a draft.' }, (tx, a) =>
    runs.returnRun(tx, a, s(f, 'run_id'), s(f, 'reason')),
  );
}
export async function reopenRunAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f), success: 'Reopened as a draft. It will need a new review and approval.' }, (tx, a) =>
    runs.reopenRun(tx, a, s(f, 'run_id'), s(f, 'reason')),
  );
}
export async function voidRunAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f), success: 'Pay run voided. The original record is kept.' }, (tx, a) =>
    runs.voidRun(tx, a, s(f, 'run_id'), s(f, 'reason')),
  );
}
export async function correctionAction(f: FormData) {
  await act(
    { roles: ['admin'], back: runBack(f), success: 'Correction run started from a copy of the original inputs. Adjust it, then submit it for review.', next: (id: string) => `/runs/${id}` },
    (tx, a) => runs.createCorrection(tx, a, s(f, 'run_id'), { pay_date: s(f, 'pay_date'), reason: s(f, 'reason') }),
  );
}

// ------------------------------------------------------------------ provider handoff
export async function exportRunAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#handoff', success: 'Review CSV created. Download it below and check it before entering it with your provider.' }, (tx, a) =>
    provider.exportRun(tx, a, s(f, 'run_id')),
  );
}
export async function batchRefAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f) + '#handoff', success: 'Provider batch reference saved.' }, (tx, a) =>
    provider.recordBatchRef(tx, a, s(f, 'run_id'), s(f, 'ref')),
  );
}
export async function importResultsAction(f: FormData) {
  await act(
    {
      roles: ['admin'],
      back: runBack(f) + '#reconcile',
      success: (r: { rows: number; issues: number }) =>
        r.issues ? `Imported ${r.rows} results. ${r.issues} difference${r.issues === 1 ? '' : 's'} need attention.` : `Imported ${r.rows} results. Everything matches the approved run.`,
    },
    async (tx, a) => {
      const up = await readUpload(f);
      return provider.importProviderResults(tx, a, s(f, 'run_id'), up.name, up.text);
    },
  );
}
export async function acknowledgeAction(f: FormData) {
  await act({ roles: ['admin', 'approver'], back: runBack(f) + '#reconcile', success: 'Difference accepted with your note.' }, (tx, a) =>
    provider.acknowledgeDifference(tx, a, s(f, 'run_id'), s(f, 'item_id'), s(f, 'note')),
  );
}
export async function reconcileAction(f: FormData) {
  await act({ roles: ['admin'], back: runBack(f), success: (n: number) => `Reconciled. ${n} pay statements are now visible to staff.` }, (tx, a) =>
    provider.reconcileRun(tx, a, s(f, 'run_id')),
  );
}

// ------------------------------------------------------------------ settings and people
export async function updateSettingsAction(f: FormData) {
  await act({ roles: ['admin'], back: '/settings', success: 'Settings saved.' }, (tx, a) =>
    settings.updateSettings(tx, a, {
      org_name: s(f, 'org_name'),
      require_separate_approver: f.get('require_separate_approver') === 'on',
      overtime_multiplier: s(f, 'overtime_multiplier'),
      pay_schedule: s(f, 'pay_schedule'),
      schedule_anchor_start: s(f, 'schedule_anchor_start'),
      payday_offset_days: s(f, 'payday_offset_days'),
    }),
  );
}
export async function updateExportProfileAction(f: FormData) {
  await act({ roles: ['admin'], back: '/settings#export', success: 'Export layout saved.' }, (tx, a) =>
    settings.updateExportProfile(tx, a, {
      name: s(f, 'name'),
      columns: String(f.get('columns') ?? ''),
      date_format: s(f, 'date_format'),
      amount_format: s(f, 'amount_format'),
      include_banner: f.get('include_banner') === 'on',
    }),
  );
}
/** Invite links never go in a URL (history, logs). They are handed to the settings page in a short-lived cookie. */
async function stashInviteLink(email: string, token: string) {
  const base = (process.env.APP_URL || 'http://localhost:3100').replace(/\/$/, '');
  (await cookies()).set('arise_invite_link', JSON.stringify({ email, link: `${base}/invite/${token}` }), {
    httpOnly: true,
    sameSite: 'strict',
    secure: base.startsWith('https://'),
    path: '/settings',
    maxAge: 600,
  });
}
export async function inviteUserAction(f: FormData) {
  await act(
    { roles: ['admin'], back: '/settings#users', success: 'Invite created. Copy the link below and send it privately.' },
    async (tx, a) => {
      const token = await accounts.inviteUser(tx, a, {
        email: s(f, 'email'),
        display_name: s(f, 'display_name'),
        roles: f.getAll('roles').map(String),
        employee_id: s(f, 'employee_id') || null,
      });
      await stashInviteLink(s(f, 'email').toLowerCase(), token);
    },
  );
}
export async function reissueInviteAction(f: FormData) {
  await act({ roles: ['admin'], back: '/settings#users', success: 'New invite link created. Copy it below.' }, async (tx, a) => {
    const token = await accounts.reissueInvite(tx, a, s(f, 'user_id'));
    const u = await tx.one<{ email: string }>('select email from payroll.users where id = $1', [s(f, 'user_id')]);
    await stashInviteLink(u?.email ?? '', token);
  });
}
export async function updateAccessAction(f: FormData) {
  await act({ roles: ['admin'], back: '/settings#users', success: 'Access updated. Their open sessions were signed out.' }, (tx, a) =>
    accounts.updateUserAccess(tx, a, s(f, 'user_id'), {
      roles: f.getAll('roles').map(String),
      status: s(f, 'status') === 'disabled' ? 'disabled' : 'active',
    }),
  );
}
export async function resetMfaAction(f: FormData) {
  await act({ roles: ['admin'], back: '/settings#users', success: 'MFA reset. They will set it up again at next sign-in.' }, (tx, a) =>
    accounts.resetMfa(tx, a, s(f, 'user_id')),
  );
}
