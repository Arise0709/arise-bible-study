import type { Queryable } from '../db';
import { SCHEDULES, isISODate, type Schedule } from '../schedule';
import { type Actor, UserError, audit, requireRole } from './core';

export type Settings = {
  org_name: string;
  org_city_state: string;
  require_separate_approver: boolean;
  overtime_multiplier: number;
  pay_schedule: Schedule;
  schedule_anchor_start: string;
  payday_offset_days: number;
  active_export_profile_id: string | null;
  live_money_movement: boolean;
  tax_filing: boolean;
};

export type ExportColumn = { header: string; field: string };
export type ExportProfile = {
  id: string;
  name: string;
  description: string;
  columns: ExportColumn[];
  date_format: 'YYYY-MM-DD' | 'MM/DD/YYYY';
  amount_format: 'dollars' | 'cents';
  include_banner: boolean;
};

export const EXPORT_FIELDS: { field: string; label: string }[] = [
  { field: 'employee_code', label: 'Staff ID' },
  { field: 'first_name', label: 'First name' },
  { field: 'last_name', label: 'Last name' },
  { field: 'full_name', label: 'Full name' },
  { field: 'email', label: 'Email' },
  { field: 'worker_type', label: 'Worker type (employee, clergy, contractor)' },
  { field: 'pay_type', label: 'Pay type (hourly, salary, contract)' },
  { field: 'run_number', label: 'Pay run number' },
  { field: 'period_start', label: 'Period start' },
  { field: 'period_end', label: 'Period end' },
  { field: 'pay_date', label: 'Pay date' },
  { field: 'regular_hours', label: 'Regular hours' },
  { field: 'regular_rate', label: 'Regular hourly rate' },
  { field: 'regular_pay', label: 'Regular pay' },
  { field: 'overtime_hours', label: 'Overtime hours' },
  { field: 'overtime_rate', label: 'Overtime rate' },
  { field: 'rate_effective_date', label: 'Date the hourly rate took effect (a raise inside the period makes one row per rate)' },
  { field: 'overtime_pay', label: 'Overtime pay' },
  { field: 'salary', label: 'Salary (non-clergy)' },
  { field: 'clergy_salary', label: 'Clergy salary (excluding housing)' },
  { field: 'housing_allowance', label: 'Clergy housing allowance (designated)' },
  { field: 'bonus', label: 'Bonus' },
  { field: 'other_earnings', label: 'Other earnings' },
  { field: 'gross_earnings', label: 'Gross earnings' },
  { field: 'reimbursement', label: 'Reimbursement (non-taxable)' },
  { field: 'deduction', label: 'Deductions entered in Arise Payroll' },
  { field: 'contractor_payment', label: 'Contractor payment' },
];

export async function getSettings(tx: Queryable): Promise<Settings> {
  const s = await tx.one<Settings>('select * from payroll.settings where id = 1');
  if (!s) throw new Error('Settings row missing. Run the database migrations.');
  return s;
}

export async function updateSettings(
  tx: Queryable,
  actor: Actor,
  input: {
    org_name: string;
    require_separate_approver: boolean;
    overtime_multiplier: string;
    pay_schedule: string;
    schedule_anchor_start: string;
    payday_offset_days: string;
  },
): Promise<void> {
  requireRole(actor, 'admin');
  const before = await getSettings(tx);
  const ot = Number(input.overtime_multiplier);
  if (!Number.isFinite(ot) || ot < 1 || ot > 3) throw new UserError('Overtime multiplier must be between 1 and 3.');
  if (!SCHEDULES.some((s) => s.value === input.pay_schedule)) throw new UserError('Choose a pay schedule.');
  if (!isISODate(input.schedule_anchor_start)) throw new UserError('Enter the first day of a pay period as a date.');
  const offset = Number(input.payday_offset_days);
  if (!Number.isInteger(offset) || offset < 0 || offset > 30) throw new UserError('Payday offset must be 0 to 30 days.');
  if (!input.org_name) throw new UserError('Organization name is required.');

  await tx.query(
    `update payroll.settings set org_name = $1, require_separate_approver = $2, overtime_multiplier = $3,
       pay_schedule = $4, schedule_anchor_start = $5, payday_offset_days = $6, updated_at = now() where id = 1`,
    [input.org_name, input.require_separate_approver, ot, input.pay_schedule, input.schedule_anchor_start, offset],
  );
  const after = await getSettings(tx);
  const changed = Object.fromEntries(
    (Object.keys(after) as (keyof Settings)[])
      .filter((k) => k !== ('updated_at' as keyof Settings) && String(after[k]) !== String(before[k]))
      .map((k) => [k, { from: before[k], to: after[k] }]),
  );
  if (Object.keys(changed).length)
    await audit(tx, actor, 'settings.updated', 'settings', '1', `Changed settings: ${Object.keys(changed).join(', ')}`, changed);
}

export async function getExportProfile(tx: Queryable, id?: string | null): Promise<ExportProfile> {
  const s = await getSettings(tx);
  const p = await tx.one<ExportProfile>('select * from payroll.export_profiles where id = $1', [
    id ?? s.active_export_profile_id,
  ]);
  if (!p) throw new UserError('No export layout is configured. Set one up in Settings.');
  return p;
}

/** Parse the "Header = field" lines from the settings form. */
export function parseColumnSpec(text: string): ExportColumn[] {
  const known = new Set(EXPORT_FIELDS.map((f) => f.field));
  const cols: ExportColumn[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
      const m = line.match(/^(.+?)\s*=\s*([a-z_]+)$/);
      if (!m) throw new UserError(`Line ${i + 1} should look like "Column Header = field_name".`);
      if (!known.has(m[2])) throw new UserError(`Line ${i + 1}: "${m[2]}" is not an available field.`);
      cols.push({ header: m[1].trim(), field: m[2] });
    });
  if (cols.length === 0) throw new UserError('Add at least one column.');
  return cols;
}

export async function updateExportProfile(
  tx: Queryable,
  actor: Actor,
  input: { name: string; columns: string; date_format: string; amount_format: string; include_banner: boolean },
): Promise<void> {
  requireRole(actor, 'admin');
  const profile = await getExportProfile(tx);
  const columns = parseColumnSpec(input.columns);
  if (!['YYYY-MM-DD', 'MM/DD/YYYY'].includes(input.date_format)) throw new UserError('Choose a date format.');
  if (!['dollars', 'cents'].includes(input.amount_format)) throw new UserError('Choose an amount format.');
  if (!input.name) throw new UserError('Give the layout a name.');
  await tx.query(
    `update payroll.export_profiles set name = $2, columns = $3, date_format = $4, amount_format = $5,
       include_banner = $6, updated_at = now() where id = $1`,
    [profile.id, input.name, JSON.stringify(columns), input.date_format, input.amount_format, input.include_banner],
  );
  await audit(tx, actor, 'export_layout.updated', 'export_profile', profile.id, `Updated export layout "${input.name}"`, {
    before: profile,
    after: { ...input, columns },
  });
}
