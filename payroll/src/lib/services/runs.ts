import type { Queryable } from '../db';
import {
  calculateRun,
  totalsFor,
  type CalcEmployee,
  type CalcHousing,
  type CalcItem,
  type CalcRate,
  type CalcTime,
  type Line,
  type PersonTotals,
} from '../calc';
import { parseCsvObjects } from '../csv';
import { formatMoney, parseHours, parseMoney } from '../money';
import { SCHEDULES, isISODate, nextPeriod, periodContaining, todayISO, type Period, type Schedule } from '../schedule';
import { type Actor, UserError, audit, hasRole, requireRole } from './core';
import { getSettings } from './settings';
import { fullName, reviewFlags, type Employee } from './staff';

export type RunStatus = 'draft' | 'submitted' | 'approved' | 'exported' | 'reconciled' | 'voided';

export type Run = {
  id: string;
  run_number: number;
  kind: 'regular' | 'correction';
  corrects_run_id: string | null;
  schedule: Schedule;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: RunStatus;
  notes: string;
  revision: number;
  created_by: string | null;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approved_revision: number | null;
  self_approved: boolean;
  return_reason: string | null;
  returned_by: string | null;
  returned_at: string | null;
  provider_batch_ref: string | null;
  provider_batch_recorded_at: string | null;
  reconciled_by: string | null;
  reconciled_at: string | null;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_by_name?: string | null;
  submitted_by_name?: string | null;
  approved_by_name?: string | null;
  returned_by_name?: string | null;
  reconciled_by_name?: string | null;
  voided_by_name?: string | null;
};

export type RunTotals = {
  gross: number;
  reimbursements: number;
  deductions: number;
  contractor: number;
  people: number;
  contractors: number;
};

export const STATUS_STEPS: { status: RunStatus; label: string }[] = [
  { status: 'draft', label: 'Draft' },
  { status: 'submitted', label: 'Submitted for review' },
  { status: 'approved', label: 'Approved' },
  { status: 'exported', label: 'Exported' },
  { status: 'reconciled', label: 'Reconciled' },
];

const RUN_SELECT = `
  select r.*, cu.display_name as created_by_name, su.display_name as submitted_by_name,
         au.display_name as approved_by_name, ru.display_name as returned_by_name,
         rcu.display_name as reconciled_by_name, vu.display_name as voided_by_name
    from payroll.pay_runs r
    left join payroll.users cu on cu.id = r.created_by
    left join payroll.users su on su.id = r.submitted_by
    left join payroll.users au on au.id = r.approved_by
    left join payroll.users ru on ru.id = r.returned_by
    left join payroll.users rcu on rcu.id = r.reconciled_by
    left join payroll.users vu on vu.id = r.voided_by`;

export async function getRun(tx: Queryable, id: string): Promise<Run | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return tx.one<Run>(`${RUN_SELECT} where r.id = $1`, [id]);
}

async function mustGetRun(tx: Queryable, id: string): Promise<Run> {
  const run = await getRun(tx, id);
  if (!run) throw new UserError('Pay run not found.');
  return run;
}

function requireDraft(run: Run): void {
  if (run.status !== 'draft')
    throw new UserError(
      run.status === 'approved' || run.status === 'submitted'
        ? 'This run is locked for review. Reopen it as a draft to make changes (it will need a new approval).'
        : `This run is ${run.status}. Changes after export go through a correction run.`,
    );
}

export async function listRuns(tx: Queryable, limit = 50): Promise<(Run & RunTotals)[]> {
  return tx.query<Run & RunTotals>(
    `${RUN_SELECT.replace('select r.*,', `select r.*,
        coalesce((select sum(amount_cents) from payroll.run_lines l where l.run_id = r.id and l.category = 'earning'), 0) as gross,
        coalesce((select sum(amount_cents) from payroll.run_lines l where l.run_id = r.id and l.category = 'reimbursement'), 0) as reimbursements,
        coalesce((select sum(amount_cents) from payroll.run_lines l where l.run_id = r.id and l.category = 'deduction'), 0) as deductions,
        coalesce((select sum(amount_cents) from payroll.run_lines l where l.run_id = r.id and l.category = 'contractor'), 0) as contractor,
        (select count(distinct employee_id) from payroll.run_lines l where l.run_id = r.id and l.worker_type <> 'contractor') as people,
        (select count(distinct employee_id) from payroll.run_lines l where l.run_id = r.id and l.worker_type = 'contractor') as contractors,`)}
     order by r.period_start desc, r.run_number desc limit $1`,
    [limit],
  );
}

/** Suggest the next period to run, based on the schedule and the latest regular run. */
export async function suggestNextPeriod(tx: Queryable): Promise<Period & { schedule: Schedule }> {
  const s = await getSettings(tx);
  const last = await tx.one<{ period_start: string; period_end: string; schedule: Schedule }>(
    `select period_start, period_end, schedule from payroll.pay_runs
      where kind = 'regular' and status <> 'voided' order by period_end desc limit 1`,
  );
  let p: Period;
  if (last && last.schedule === s.pay_schedule) {
    p = nextPeriod(s.pay_schedule, { start: last.period_start, end: last.period_end, payDate: '' }, s.schedule_anchor_start, s.payday_offset_days);
  } else {
    p = periodContaining(s.pay_schedule, todayISO(), s.schedule_anchor_start, s.payday_offset_days);
  }
  return { ...p, schedule: s.pay_schedule };
}

export async function createRun(
  tx: Queryable,
  actor: Actor,
  input: { schedule: string; period_start: string; period_end: string; pay_date: string; notes?: string },
): Promise<string> {
  requireRole(actor, 'admin');
  if (!SCHEDULES.some((s) => s.value === input.schedule)) throw new UserError('Choose a pay schedule.');
  if (![input.period_start, input.period_end, input.pay_date].every(isISODate)) throw new UserError('Enter valid dates.');
  if (input.period_end < input.period_start) throw new UserError('The period ends before it starts.');
  if (input.pay_date < input.period_end) throw new UserError('The pay date should be on or after the end of the period.');
  const overlap = await tx.one<{ run_number: number }>(
    `select run_number from payroll.pay_runs where kind = 'regular' and status <> 'voided'
       and period_start <= $2 and period_end >= $1 limit 1`,
    [input.period_start, input.period_end],
  );
  if (overlap) throw new UserError(`Pay run #${overlap.run_number} already covers part of that period.`);
  const row = await tx.one<{ id: string; run_number: number }>(
    `insert into payroll.pay_runs (schedule, period_start, period_end, pay_date, notes, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id, run_number`,
    [input.schedule, input.period_start, input.period_end, input.pay_date, input.notes ?? '', actor.id],
  );
  await audit(tx, actor, 'run.created', 'pay_run', row!.id, `Created pay run #${row!.run_number} for ${input.period_start} to ${input.period_end}`, input);
  await recalculate(tx, row!.id);
  return row!.id;
}

type Inputs = {
  employees: (CalcEmployee & Employee)[];
  rates: CalcRate[];
  housing: CalcHousing[];
  time: (CalcTime & { id: string; source: string; note: string; created_at: string })[];
  items: (CalcItem & { id: string; created_at: string })[];
};

async function loadInputs(tx: Queryable, runId: string): Promise<Inputs> {
  return {
    employees: await tx.query('select * from payroll.employees order by last_name, first_name'),
    rates: await tx.query('select employee_id, pay_type, amount_cents, effective_date from payroll.compensation_rates'),
    housing: await tx.query(
      'select employee_id, annual_amount_cents, effective_date, approval_reference from payroll.housing_allowances',
    ),
    time: await tx.query('select * from payroll.time_entries where run_id = $1 order by work_date nulls last, created_at', [runId]),
    items: await tx.query('select * from payroll.earnings_items where run_id = $1 order by created_at', [runId]),
  };
}

/** Rebuild run lines from current inputs. Only valid while the run is a draft. */
export async function recalculate(tx: Queryable, runId: string) {
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const s = await getSettings(tx);
  const inputs = await loadInputs(tx, runId);
  const result = calculateRun({ run, overtimeMultiplier: Number(s.overtime_multiplier), ...inputs });
  await tx.query('delete from payroll.run_lines where run_id = $1', [runId]);
  for (const l of result.lines) {
    await tx.query(
      `insert into payroll.run_lines (run_id, employee_id, worker_type, category, line_type, description, hours,
         rate_cents, amount_cents, rate_effective_date, sort_order) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [runId, l.employee_id, l.worker_type, l.category, l.line_type, l.description, l.hours, l.rate_cents, l.amount_cents, l.rate_effective_date, l.sort_order],
    );
  }
  await tx.query('update payroll.pay_runs set updated_at = now() where id = $1', [runId]);
  return result;
}

export type PersonBreakdown = {
  employee: Employee;
  lines: Line[];
  totals: PersonTotals;
  flags: string[];
  warnings: string[];
};

export type RunDetail = {
  run: Run;
  people: PersonBreakdown[];
  totals: RunTotals;
  time: Inputs['time'];
  items: Inputs['items'];
  employees: Employee[];
  blockingFlags: { employee: Employee; flags: string[] }[];
  correctedBy: { id: string; run_number: number; status: RunStatus }[];
  correctsRun: { id: string; run_number: number } | null;
};

export async function getRunDetail(tx: Queryable, runId: string): Promise<RunDetail | null> {
  const run = await getRun(tx, runId);
  if (!run) return null;
  const inputs = await loadInputs(tx, runId);
  const lines = await tx.query<Line>('select * from payroll.run_lines where run_id = $1 order by sort_order', [runId]);
  let warnings: { employee_id: string; message: string }[] = [];
  if (run.status === 'draft') {
    const s = await getSettings(tx);
    warnings = calculateRun({ run, overtimeMultiplier: Number(s.overtime_multiplier), ...inputs }).warnings;
  }
  const ids = [...new Set([...lines.map((l) => l.employee_id), ...warnings.map((w) => w.employee_id)])];
  const people = ids
    .map((id) => {
      const employee = inputs.employees.find((e) => e.id === id)!;
      const pl = lines.filter((l) => l.employee_id === id);
      return {
        employee,
        lines: pl,
        totals: totalsFor(pl),
        flags: reviewFlags(employee),
        warnings: warnings.filter((w) => w.employee_id === id).map((w) => w.message),
      };
    })
    .sort((a, b) => {
      const ord = { employee: 0, clergy: 1, contractor: 2 } as const;
      return ord[a.employee.worker_type] - ord[b.employee.worker_type] || a.employee.last_name.localeCompare(b.employee.last_name);
    });
  const totals: RunTotals = {
    gross: 0,
    reimbursements: 0,
    deductions: 0,
    contractor: 0,
    people: people.filter((p) => p.employee.worker_type !== 'contractor' && p.lines.length).length,
    contractors: people.filter((p) => p.employee.worker_type === 'contractor' && p.lines.length).length,
  };
  for (const p of people) {
    totals.gross += p.totals.gross;
    totals.reimbursements += p.totals.reimbursements;
    totals.deductions += p.totals.deductions;
    totals.contractor += p.totals.contractor;
  }
  const correctedBy = await tx.query<{ id: string; run_number: number; status: RunStatus }>(
    'select id, run_number, status from payroll.pay_runs where corrects_run_id = $1 order by run_number',
    [runId],
  );
  const correctsRun = run.corrects_run_id
    ? await tx.one<{ id: string; run_number: number }>('select id, run_number from payroll.pay_runs where id = $1', [run.corrects_run_id])
    : null;
  return {
    run,
    people,
    totals,
    time: inputs.time,
    items: inputs.items,
    employees: inputs.employees.filter((e) => e.active || ids.includes(e.id)),
    blockingFlags: people.filter((p) => p.flags.length && p.lines.length).map((p) => ({ employee: p.employee, flags: p.flags })),
    correctedBy,
    correctsRun,
  };
}

// ------------------------------------------------------------------ hours and earnings

export async function addTimeEntry(
  tx: Queryable,
  actor: Actor,
  runId: string,
  input: { employee_id: string; work_date: string; regular_hours: string; overtime_hours: string; note: string; approved: boolean },
): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const emp = await tx.one<Employee>('select * from payroll.employees where id = $1', [input.employee_id]);
  if (!emp) throw new UserError('Choose a staff member.');
  if (emp.pay_type !== 'hourly') throw new UserError(`${fullName(emp)} is not paid hourly. Use earnings items for salaried staff and contractors.`);
  const reg = parseHours(input.regular_hours);
  const ot = parseHours(input.overtime_hours);
  if (reg == null || ot == null) throw new UserError('Hours must be numbers with up to two decimals, like 7.5.');
  if (reg + ot <= 0) throw new UserError('Enter some hours.');
  if (input.work_date) {
    if (!isISODate(input.work_date)) throw new UserError('Work date is not valid.');
    if (input.work_date < run.period_start || input.work_date > run.period_end)
      throw new UserError('The work date is outside this pay period.');
  }
  if (ot > 0 && emp.flsa_status === 'exempt') throw new UserError(`${fullName(emp)} is marked exempt from overtime.`);
  const row = await tx.one<{ id: string }>(
    `insert into payroll.time_entries (run_id, employee_id, work_date, regular_hours, overtime_hours, status, source, note,
       created_by, approved_by, approved_at)
     values ($1,$2,$3,$4,$5,$6,'manual',$7,$8,$9,$10) returning id`,
    [
      runId, emp.id, input.work_date || null, reg, ot, input.approved ? 'approved' : 'pending', input.note, actor.id,
      input.approved ? actor.id : null, input.approved ? new Date().toISOString() : null,
    ],
  );
  await audit(tx, actor, 'hours.added', 'pay_run', runId, `Hours for ${fullName(emp)}${input.work_date ? ` on ${input.work_date}` : ''}: ${reg} regular, ${ot} overtime${input.approved ? '' : ' (pending approval)'}`, {
    time_entry_id: row!.id,
    employee_id: emp.id,
    regular_hours: reg,
    overtime_hours: ot,
    approved: input.approved,
  });
  await recalculate(tx, runId);
}

export async function approvePendingHours(tx: Queryable, actor: Actor, runId: string, entryId?: string): Promise<number> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const rows = await tx.query<{ id: string }>(
    `update payroll.time_entries set status = 'approved', approved_by = $2, approved_at = now()
      where run_id = $1 and status = 'pending' and ($3::uuid is null or id = $3) returning id`,
    [runId, actor.id, entryId ?? null],
  );
  if (rows.length) {
    await audit(tx, actor, 'hours.approved', 'pay_run', runId, `Approved ${rows.length} time entr${rows.length === 1 ? 'y' : 'ies'}`, {
      ids: rows.map((r) => r.id),
    });
    await recalculate(tx, runId);
  }
  return rows.length;
}

export async function deleteTimeEntry(tx: Queryable, actor: Actor, runId: string, entryId: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const e = await tx.one<CalcTime & { id: string }>('select * from payroll.time_entries where id = $1 and run_id = $2', [entryId, runId]);
  if (!e) throw new UserError('Time entry not found.');
  await tx.query('delete from payroll.time_entries where id = $1', [entryId]);
  await audit(tx, actor, 'hours.removed', 'pay_run', runId, `Removed time entry (${e.regular_hours} regular, ${e.overtime_hours} overtime${e.work_date ? `, ${e.work_date}` : ''})`, { entry: e });
  await recalculate(tx, runId);
}

/** CSV columns: employee_code, work_date, regular_hours, overtime_hours, note. Rows import as pending. */
export async function importTimeCsv(tx: Queryable, actor: Actor, runId: string, filename: string, text: string): Promise<number> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const { headers, rows } = parseCsvObjects(text);
  const codeKey = ['employee_code', 'employee_id', 'staff_id'].find((h) => headers.includes(h));
  if (!codeKey || !headers.includes('regular_hours'))
    throw new UserError('The CSV needs a header row with at least: employee_code, regular_hours (optional: work_date, overtime_hours, note).');
  if (rows.length === 0) throw new UserError('The CSV has no data rows.');
  if (rows.length > 2000) throw new UserError('That file is too large. Split it into smaller files.');
  const emps = await tx.query<Employee>('select * from payroll.employees');
  const problems: string[] = [];
  const parsed: { emp: Employee; date: string | null; reg: number; ot: number; note: string }[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const emp = emps.find((e) => e.employee_code.toLowerCase() === r[codeKey].toLowerCase());
    if (!emp) return problems.push(`Row ${line}: no staff member with ID "${r[codeKey]}".`);
    if (emp.pay_type !== 'hourly') return problems.push(`Row ${line}: ${fullName(emp)} is not hourly.`);
    const reg = parseHours(r.regular_hours);
    const ot = parseHours(r.overtime_hours);
    if (reg == null || ot == null) return problems.push(`Row ${line}: hours must be numbers.`);
    const date = r.work_date || null;
    if (date && (!isISODate(date) || date < run.period_start || date > run.period_end))
      return problems.push(`Row ${line}: work_date must be YYYY-MM-DD inside the pay period.`);
    if (ot > 0 && emp.flsa_status === 'exempt') return problems.push(`Row ${line}: ${fullName(emp)} is exempt from overtime.`);
    parsed.push({ emp, date, reg, ot, note: r.note ?? '' });
  });
  if (problems.length) throw new UserError(`Nothing was imported. Fix these rows and try again: ${problems.slice(0, 8).join(' ')}`);
  for (const p of parsed) {
    await tx.query(
      `insert into payroll.time_entries (run_id, employee_id, work_date, regular_hours, overtime_hours, status, source, note, created_by)
       values ($1,$2,$3,$4,$5,'pending','csv',$6,$7)`,
      [runId, p.emp.id, p.date, p.reg, p.ot, p.note, actor.id],
    );
  }
  await audit(tx, actor, 'hours.imported', 'pay_run', runId, `Imported ${parsed.length} time entries from ${filename} (pending approval)`, {
    filename,
    rows: parsed.length,
  });
  await recalculate(tx, runId);
  return parsed.length;
}

export const ITEM_KINDS = [
  { value: 'bonus', label: 'Bonus', for: 'staff' },
  { value: 'other_earning', label: 'Other earning', for: 'staff' },
  { value: 'reimbursement', label: 'Reimbursement (non-taxable, with receipts)', for: 'staff' },
  { value: 'deduction', label: 'Deduction', for: 'staff' },
  { value: 'contractor_payment', label: 'Contractor payment', for: 'contractor' },
] as const;

export async function addEarningsItem(
  tx: Queryable,
  actor: Actor,
  runId: string,
  input: { employee_id: string; kind: string; description: string; amount: string },
): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const emp = await tx.one<Employee>('select * from payroll.employees where id = $1', [input.employee_id]);
  if (!emp) throw new UserError('Choose a staff member.');
  const kind = ITEM_KINDS.find((k) => k.value === input.kind);
  if (!kind) throw new UserError('Choose what kind of line item this is.');
  if (emp.worker_type === 'contractor' && kind.for !== 'contractor')
    throw new UserError('Contractors are paid with contractor payments only. Keep them separate from employee payroll.');
  if (emp.worker_type !== 'contractor' && kind.for === 'contractor')
    throw new UserError('Contractor payments are only for contractors.');
  const cents = parseMoney(input.amount);
  if (cents == null || cents <= 0) throw new UserError('Enter a positive dollar amount.');
  if (!input.description) throw new UserError('Add a short description.');
  await tx.query(
    `insert into payroll.earnings_items (run_id, employee_id, kind, description, amount_cents, created_by)
     values ($1,$2,$3,$4,$5,$6)`,
    [runId, emp.id, kind.value, input.description, cents, actor.id],
  );
  await audit(tx, actor, 'earnings.added', 'pay_run', runId, `${kind.label} for ${fullName(emp)}: ${formatMoney(cents)} (${input.description})`, {
    employee_id: emp.id,
    kind: kind.value,
    amount_cents: cents,
    description: input.description,
  });
  await recalculate(tx, runId);
}

export async function deleteEarningsItem(tx: Queryable, actor: Actor, runId: string, itemId: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const item = await tx.one<CalcItem & { id: string }>('select * from payroll.earnings_items where id = $1 and run_id = $2', [itemId, runId]);
  if (!item) throw new UserError('Line item not found.');
  await tx.query('delete from payroll.earnings_items where id = $1', [itemId]);
  await audit(tx, actor, 'earnings.removed', 'pay_run', runId, `Removed ${item.kind.replace('_', ' ')} of ${formatMoney(item.amount_cents)} (${item.description})`, { item });
  await recalculate(tx, runId);
}

// ------------------------------------------------------------------ workflow

export async function submitRun(tx: Queryable, actor: Actor, runId: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  requireDraft(run);
  const result = await recalculate(tx, runId);
  if (result.lines.length === 0) throw new UserError('There is nothing to pay in this run yet.');
  const pending = await tx.one<{ n: number }>("select count(*)::int as n from payroll.time_entries where run_id = $1 and status = 'pending'", [runId]);
  if (pending && pending.n > 0) throw new UserError(`${pending.n} time entries are still pending. Approve or remove them before submitting.`);
  await tx.query(
    `update payroll.pay_runs set status = 'submitted', submitted_by = $2, submitted_at = now(), updated_at = now() where id = $1`,
    [runId, actor.id],
  );
  const detail = await getRunDetail(tx, runId);
  await audit(tx, actor, 'run.submitted', 'pay_run', runId, `Submitted pay run #${run.run_number} for review (gross ${formatMoney(detail!.totals.gross)}, contractors ${formatMoney(detail!.totals.contractor)})`, {
    revision: run.revision,
    totals: detail!.totals,
  });
}

export async function approveRun(tx: Queryable, actor: Actor, runId: string, comment: string): Promise<void> {
  requireRole(actor, 'approver');
  const run = await mustGetRun(tx, runId);
  if (run.status !== 'submitted') throw new UserError('Only a run that is submitted for review can be approved.');
  const s = await getSettings(tx);
  const isPreparer = run.submitted_by === actor.id || run.created_by === actor.id;
  if (isPreparer && s.require_separate_approver)
    throw new UserError(
      'Separate approval is required. Someone other than the person who prepared this run must approve it. (An admin can change this in Settings.)',
    );
  const detail = (await getRunDetail(tx, runId))!;
  if (detail.blockingFlags.length)
    throw new UserError(
      `Clear these review flags before approving: ${detail.blockingFlags
        .map((b) => `${fullName(b.employee)} (${b.flags.join('; ')})`)
        .join(', ')}.`,
    );
  await tx.query(
    `update payroll.pay_runs set status = 'approved', approved_by = $2, approved_at = now(), approved_revision = revision,
       self_approved = $3, return_reason = null, updated_at = now() where id = $1`,
    [runId, actor.id, isPreparer],
  );
  await audit(
    tx,
    actor,
    'run.approved',
    'pay_run',
    runId,
    `Approved pay run #${run.run_number} (gross ${formatMoney(detail.totals.gross)}, contractors ${formatMoney(detail.totals.contractor)})${isPreparer ? '. NOTE: the same person prepared and approved this run.' : ''}`,
    { revision: run.revision, totals: detail.totals, self_approved: isPreparer, comment },
  );
}

export async function returnRun(tx: Queryable, actor: Actor, runId: string, reason: string): Promise<void> {
  requireRole(actor, 'approver');
  const run = await mustGetRun(tx, runId);
  if (run.status !== 'submitted') throw new UserError('Only a run that is submitted for review can be returned.');
  if (!reason) throw new UserError('Give a reason so the admin knows what to fix.');
  await tx.query(
    `update payroll.pay_runs set status = 'draft', return_reason = $2, returned_by = $3, returned_at = now(),
       submitted_by = null, submitted_at = null, revision = revision + 1, updated_at = now() where id = $1`,
    [runId, reason, actor.id],
  );
  await audit(tx, actor, 'run.returned', 'pay_run', runId, `Returned pay run #${run.run_number} to draft: ${reason}`, { reason });
}

/** An approved run that needs changes goes back to draft, and the old approval no longer counts. */
export async function reopenRun(tx: Queryable, actor: Actor, runId: string, reason: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  if (run.status !== 'approved' && run.status !== 'submitted')
    throw new UserError('Only a submitted or approved run (not yet exported) can be reopened.');
  if (!reason) throw new UserError('Say what needs to change.');
  await tx.query(
    `update payroll.pay_runs set status = 'draft', approved_by = null, approved_at = null, approved_revision = null,
       self_approved = false, submitted_by = null, submitted_at = null, revision = revision + 1,
       return_reason = $2, returned_by = $3, returned_at = now(), updated_at = now() where id = $1`,
    [runId, `Reopened by admin: ${reason}`, actor.id],
  );
  await audit(tx, actor, 'run.reopened', 'pay_run', runId, `Reopened pay run #${run.run_number} for changes. ${run.status === 'approved' ? 'Previous approval cleared; a new review is required.' : ''} Reason: ${reason}`, {
    previous_status: run.status,
    previous_approved_by: run.approved_by,
    reason,
  });
}

export async function voidRun(tx: Queryable, actor: Actor, runId: string, reason: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  if (!['draft', 'exported', 'reconciled'].includes(run.status))
    throw new UserError('A run under review must be returned or reopened before it can be voided.');
  if (!reason) throw new UserError('Give a reason for voiding this run.');
  await tx.query(
    `update payroll.pay_runs set status = 'voided', voided_by = $2, voided_at = now(), void_reason = $3, updated_at = now() where id = $1`,
    [runId, actor.id, reason],
  );
  await audit(tx, actor, 'run.voided', 'pay_run', runId, `Voided pay run #${run.run_number} (was ${run.status}): ${reason}. The original record is kept.`, {
    previous_status: run.status,
    reason,
  });
}

export async function createCorrection(
  tx: Queryable,
  actor: Actor,
  runId: string,
  input: { pay_date: string; reason: string },
): Promise<string> {
  requireRole(actor, 'admin');
  const run = await mustGetRun(tx, runId);
  if (!['exported', 'reconciled'].includes(run.status))
    throw new UserError('Corrections are for runs that have already been exported. Before export, reopen the run instead.');
  if (!input.reason) throw new UserError('Describe what is being corrected.');
  if (!isISODate(input.pay_date)) throw new UserError('Enter a pay date for the correction.');
  const row = await tx.one<{ id: string; run_number: number }>(
    `insert into payroll.pay_runs (kind, corrects_run_id, schedule, period_start, period_end, pay_date, notes, created_by)
     values ('correction', $1, $2, $3, $4, $5, $6, $7) returning id, run_number`,
    [run.id, run.schedule, run.period_start, run.period_end, input.pay_date, `Correction of run #${run.run_number}: ${input.reason}`, actor.id],
  );
  const id = row!.id;
  await tx.query(
    `insert into payroll.time_entries (run_id, employee_id, work_date, regular_hours, overtime_hours, status, source, note, created_by, approved_by, approved_at)
     select $1, employee_id, work_date, regular_hours, overtime_hours, status, source, note, $2, approved_by, approved_at
       from payroll.time_entries where run_id = $3`,
    [id, actor.id, run.id],
  );
  await tx.query(
    `insert into payroll.earnings_items (run_id, employee_id, kind, description, amount_cents, created_by)
     select $1, employee_id, kind, description, amount_cents, $2 from payroll.earnings_items where run_id = $3`,
    [id, actor.id, run.id],
  );
  await recalculate(tx, id);
  await audit(tx, actor, 'run.correction_created', 'pay_run', run.id, `Started correction run #${row!.run_number} for run #${run.run_number}: ${input.reason}`, {
    correction_run_id: id,
  });
  await audit(tx, actor, 'run.created', 'pay_run', id, `Created correction run #${row!.run_number} (copy of run #${run.run_number}'s inputs)`, {
    corrects_run_id: run.id,
    reason: input.reason,
  });
  return id;
}

export function canSee(actor: Actor): boolean {
  return hasRole(actor, 'admin', 'approver');
}
