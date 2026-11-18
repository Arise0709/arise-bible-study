import type { Queryable } from '../db';
import { parseMoney } from '../money';
import { isISODate, todayISO } from '../schedule';
import { rateOn } from '../calc';
import { type Actor, UserError, audit, requireRole, hasRole } from './core';

export type Employee = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  job_title: string;
  worker_type: 'employee' | 'clergy' | 'contractor';
  pay_type: 'hourly' | 'salary' | 'contract';
  flsa_status: 'nonexempt' | 'exempt' | 'not_applicable';
  start_date: string;
  active: boolean;
  classification_confirmed: boolean;
  classification_confirmed_by: string | null;
  classification_confirmed_at: string | null;
  classification_note: string;
  clergy_config_confirmed: boolean;
  clergy_config_confirmed_by: string | null;
  clergy_config_confirmed_at: string | null;
  clergy_config_note: string;
};

export type Rate = {
  id: string;
  employee_id: string;
  pay_type: 'hourly' | 'salary' | 'contract';
  amount_cents: number;
  effective_date: string;
  reason: string;
  created_at: string;
  created_by_name: string | null;
};

export type Housing = {
  id: string;
  employee_id: string;
  annual_amount_cents: number;
  effective_date: string;
  approval_reference: string;
  approved_by_body: string;
  approved_on: string | null;
  created_at: string;
  created_by_name: string | null;
};

export function fullName(e: Pick<Employee, 'first_name' | 'last_name'>): string {
  return `${e.first_name} ${e.last_name}`;
}

/** Review flags that must be cleared by an approver before a run including this person can be approved. */
export function reviewFlags(e: Employee): string[] {
  const flags: string[] = [];
  if (!e.classification_confirmed) flags.push('Worker classification not confirmed');
  if (e.worker_type === 'clergy' && !e.clergy_config_confirmed)
    flags.push('Clergy compensation setup at the payroll provider not confirmed');
  return flags;
}

export const WORKER_TYPES = [
  { value: 'employee', label: 'Employee (W-2)' },
  { value: 'clergy', label: 'Clergy (minister)' },
  { value: 'contractor', label: 'Contractor (1099)' },
] as const;

export async function listEmployees(tx: Queryable): Promise<(Employee & { current_rate: Rate | null })[]> {
  const emps = await tx.query<Employee>('select * from payroll.employees order by active desc, last_name, first_name');
  const rates = await tx.query<Rate>('select * from payroll.compensation_rates');
  const today = todayISO();
  return emps.map((e) => ({
    ...e,
    current_rate: rateOn(
      rates.filter((r) => r.employee_id === e.id && r.pay_type === e.pay_type),
      today,
    ),
  }));
}

export async function getEmployee(tx: Queryable, id: string): Promise<Employee | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return tx.one<Employee>('select * from payroll.employees where id = $1', [id]);
}

export async function getRates(tx: Queryable, employeeId: string): Promise<Rate[]> {
  return tx.query<Rate>(
    `select r.*, u.display_name as created_by_name from payroll.compensation_rates r
       left join payroll.users u on u.id = r.created_by
      where r.employee_id = $1 order by r.effective_date desc`,
    [employeeId],
  );
}

export async function getHousing(tx: Queryable, employeeId: string): Promise<Housing[]> {
  return tx.query<Housing>(
    `select h.*, u.display_name as created_by_name from payroll.housing_allowances h
       left join payroll.users u on u.id = h.created_by
      where h.employee_id = $1 order by h.effective_date desc`,
    [employeeId],
  );
}

export type EmployeeInput = {
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address_line: string;
  city: string;
  state: string;
  postal_code: string;
  job_title: string;
  worker_type: string;
  pay_type: string;
  flsa_status: string;
  start_date: string;
  active: boolean;
};

function validateEmployee(input: EmployeeInput): void {
  if (!input.first_name || !input.last_name) throw new UserError('First and last name are required.');
  if (!/^[A-Za-z0-9-]{2,20}$/.test(input.employee_code))
    throw new UserError('Staff ID should be 2 to 20 letters, numbers or dashes.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new UserError('Enter a valid email address.');
  if (!isISODate(input.start_date)) throw new UserError('Enter a valid start date.');
  if (!['employee', 'clergy', 'contractor'].includes(input.worker_type)) throw new UserError('Choose a worker type.');
  const okPay =
    (input.worker_type === 'contractor' && input.pay_type === 'contract') ||
    (input.worker_type === 'clergy' && input.pay_type === 'salary') ||
    (input.worker_type === 'employee' && ['hourly', 'salary'].includes(input.pay_type));
  if (!okPay)
    throw new UserError(
      'Pay type does not fit the worker type. Employees are hourly or salaried, clergy are salaried, contractors are paid by contract.',
    );
  if (!['nonexempt', 'exempt', 'not_applicable'].includes(input.flsa_status)) throw new UserError('Choose an overtime status.');
  // Unhelpful data the app is designed never to hold.
  const all = [input.first_name, input.last_name, input.job_title, input.address_line, input.employee_code].join(' ');
  if (/\b\d{3}-?\d{2}-?\d{4}\b/.test(all))
    throw new UserError(
      'That looks like a Social Security or account number. Arise Payroll does not store those. Use the payroll provider’s secure onboarding instead.',
    );
}

export async function createEmployee(
  tx: Queryable,
  actor: Actor,
  input: EmployeeInput,
  firstRate: { amount: string; effective_date: string },
): Promise<string> {
  requireRole(actor, 'admin');
  validateEmployee(input);
  const exists = await tx.one('select 1 from payroll.employees where employee_code = $1', [input.employee_code]);
  if (exists) throw new UserError(`Staff ID ${input.employee_code} is already in use.`);
  const row = await tx.one<{ id: string }>(
    `insert into payroll.employees (employee_code, first_name, last_name, email, phone, address_line, city, state,
       postal_code, job_title, worker_type, pay_type, flsa_status, start_date, active)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [
      input.employee_code, input.first_name, input.last_name, input.email.toLowerCase(), input.phone,
      input.address_line, input.city, input.state || 'AL', input.postal_code, input.job_title,
      input.worker_type, input.pay_type, input.flsa_status, input.start_date, input.active,
    ],
  );
  const id = row!.id;
  await audit(tx, actor, 'staff.created', 'employee', id, `Added ${input.first_name} ${input.last_name} (${input.employee_code})`, {
    worker_type: input.worker_type,
    pay_type: input.pay_type,
  });
  if (firstRate.amount)
    await addRate(tx, actor, id, {
      amount: firstRate.amount,
      effective_date: firstRate.effective_date || input.start_date,
      reason: 'Starting pay',
    });
  return id;
}

export async function updateEmployee(tx: Queryable, actor: Actor, id: string, input: EmployeeInput): Promise<void> {
  requireRole(actor, 'admin');
  validateEmployee(input);
  const before = await getEmployee(tx, id);
  if (!before) throw new UserError('Staff record not found.');
  if (before.pay_type !== input.pay_type || before.worker_type !== input.worker_type) {
    // A change of worker type or pay basis needs a fresh classification review.
    await tx.query(
      `update payroll.employees set classification_confirmed = false, classification_confirmed_by = null,
         classification_confirmed_at = null, clergy_config_confirmed = false, clergy_config_confirmed_by = null,
         clergy_config_confirmed_at = null where id = $1`,
      [id],
    );
  }
  await tx.query(
    `update payroll.employees set employee_code=$2, first_name=$3, last_name=$4, email=$5, phone=$6, address_line=$7,
       city=$8, state=$9, postal_code=$10, job_title=$11, worker_type=$12, pay_type=$13, flsa_status=$14,
       start_date=$15, active=$16, updated_at=now() where id=$1`,
    [
      id, input.employee_code, input.first_name, input.last_name, input.email.toLowerCase(), input.phone,
      input.address_line, input.city, input.state, input.postal_code, input.job_title, input.worker_type,
      input.pay_type, input.flsa_status, input.start_date, input.active,
    ],
  );
  const changes: Record<string, unknown> = {};
  for (const k of Object.keys(input) as (keyof EmployeeInput)[]) {
    if (String(before[k as keyof Employee]) !== String(input[k])) changes[k] = { from: before[k as keyof Employee], to: input[k] };
  }
  if (Object.keys(changes).length)
    await audit(tx, actor, 'staff.updated', 'employee', id, `Updated ${fullName(input)}: ${Object.keys(changes).join(', ')}`, changes);
}

export async function addRate(
  tx: Queryable,
  actor: Actor,
  employeeId: string,
  input: { amount: string; effective_date: string; reason: string },
): Promise<void> {
  requireRole(actor, 'admin');
  const emp = await getEmployee(tx, employeeId);
  if (!emp) throw new UserError('Staff record not found.');
  const cents = parseMoney(input.amount);
  if (cents == null || cents < 0) throw new UserError('Enter the amount in dollars, like 18.50 or 52000.');
  if (!isISODate(input.effective_date)) throw new UserError('Enter the date the new rate takes effect.');
  if (emp.pay_type === 'hourly' && cents > 50_000) throw new UserError('That hourly rate looks too high. Check the amount.');
  if (emp.pay_type === 'salary' && cents > 0 && cents < 100_000)
    throw new UserError('Salaries are entered as an annual amount, like 52000.');
  const dup = await tx.one('select 1 from payroll.compensation_rates where employee_id = $1 and effective_date = $2', [
    employeeId,
    input.effective_date,
  ]);
  if (dup)
    throw new UserError(
      'A rate already starts on that date. Rate history cannot be edited; add the correction with the next day as its effective date and note the reason.',
    );
  // Protect history that has already been paid.
  const locked = await tx.one<{ run_number: number }>(
    `select r.run_number from payroll.pay_runs r
       where r.status in ('submitted','approved','exported','reconciled') and r.period_end >= $1
         and exists (select 1 from payroll.run_lines l where l.run_id = r.id and l.employee_id = $2)
       order by r.period_end desc limit 1`,
    [input.effective_date, employeeId],
  );
  if (locked && !input.reason)
    throw new UserError(
      `Pay run #${locked.run_number} already covers that date. Enter a reason; past runs will not change, so use a correction run if back pay is owed.`,
    );
  await tx.query(
    `insert into payroll.compensation_rates (employee_id, pay_type, amount_cents, effective_date, reason, created_by)
     values ($1,$2,$3,$4,$5,$6)`,
    [employeeId, emp.pay_type, cents, input.effective_date, input.reason, actor.id],
  );
  await audit(
    tx,
    actor,
    'rate.added',
    'employee',
    employeeId,
    `New ${emp.pay_type} rate for ${fullName(emp)}: ${input.amount} effective ${input.effective_date}`,
    { amount_cents: cents, effective_date: input.effective_date, reason: input.reason, pay_type: emp.pay_type },
  );
}

export async function addHousingAllowance(
  tx: Queryable,
  actor: Actor,
  employeeId: string,
  input: { annual_amount: string; effective_date: string; approval_reference: string; approved_by_body: string; approved_on: string },
): Promise<void> {
  requireRole(actor, 'admin');
  const emp = await getEmployee(tx, employeeId);
  if (!emp) throw new UserError('Staff record not found.');
  if (emp.worker_type !== 'clergy') throw new UserError('Housing allowances apply to clergy only.');
  const cents = parseMoney(input.annual_amount);
  if (cents == null || cents < 0) throw new UserError('Enter the annual designated amount in dollars.');
  if (!isISODate(input.effective_date)) throw new UserError('Enter the effective date.');
  if (!input.approval_reference)
    throw new UserError('Enter the approval reference (for example, the board resolution or minutes date).');
  if (input.approved_on && !isISODate(input.approved_on)) throw new UserError('Approval date is not a valid date.');
  if (input.approved_on && input.approved_on > input.effective_date)
    throw new UserError('A housing allowance must be designated before the period it covers. The approval date is after the effective date.');
  const dup = await tx.one('select 1 from payroll.housing_allowances where employee_id=$1 and effective_date=$2', [
    employeeId,
    input.effective_date,
  ]);
  if (dup) throw new UserError('A housing allowance designation already starts on that date.');
  await tx.query(
    `insert into payroll.housing_allowances (employee_id, annual_amount_cents, effective_date, approval_reference,
       approved_by_body, approved_on, created_by) values ($1,$2,$3,$4,$5,$6,$7)`,
    [employeeId, cents, input.effective_date, input.approval_reference, input.approved_by_body, input.approved_on || null, actor.id],
  );
  // Any change to clergy pay needs the provider setup confirmed again.
  await tx.query(
    `update payroll.employees set clergy_config_confirmed = false, clergy_config_confirmed_by = null,
       clergy_config_confirmed_at = null where id = $1`,
    [employeeId],
  );
  await audit(
    tx,
    actor,
    'housing_allowance.added',
    'employee',
    employeeId,
    `Housing allowance for ${fullName(emp)}: ${input.annual_amount}/yr effective ${input.effective_date} (ref: ${input.approval_reference})`,
    { annual_amount_cents: cents, ...input },
  );
}

export async function confirmClassification(
  tx: Queryable,
  actor: Actor,
  employeeId: string,
  note: string,
): Promise<void> {
  requireRole(actor, 'approver');
  const emp = await getEmployee(tx, employeeId);
  if (!emp) throw new UserError('Staff record not found.');
  if (!note) throw new UserError('Add a short note on how the classification was confirmed and by whom.');
  await tx.query(
    `update payroll.employees set classification_confirmed = true, classification_confirmed_by = $2,
       classification_confirmed_at = now(), classification_note = $3, updated_at = now() where id = $1`,
    [employeeId, actor.id, note],
  );
  await audit(tx, actor, 'staff.classification_confirmed', 'employee', employeeId, `Confirmed worker classification for ${fullName(emp)}`, {
    worker_type: emp.worker_type,
    note,
  });
}

export async function confirmClergyConfig(tx: Queryable, actor: Actor, employeeId: string, note: string): Promise<void> {
  requireRole(actor, 'approver');
  const emp = await getEmployee(tx, employeeId);
  if (!emp) throw new UserError('Staff record not found.');
  if (emp.worker_type !== 'clergy') throw new UserError('This person is not set up as clergy.');
  if (!note) throw new UserError('Describe how the provider has this minister set up (for example, FICA and housing allowance handling).');
  await tx.query(
    `update payroll.employees set clergy_config_confirmed = true, clergy_config_confirmed_by = $2,
       clergy_config_confirmed_at = now(), clergy_config_note = $3, updated_at = now() where id = $1`,
    [employeeId, actor.id, note],
  );
  await audit(tx, actor, 'staff.clergy_config_confirmed', 'employee', employeeId, `Confirmed clergy provider setup for ${fullName(emp)}`, {
    note,
  });
}

export async function clearReviewFlag(
  tx: Queryable,
  actor: Actor,
  employeeId: string,
  which: 'classification' | 'clergy',
): Promise<void> {
  if (!hasRole(actor, 'admin', 'approver')) requireRole(actor, 'admin');
  const emp = await getEmployee(tx, employeeId);
  if (!emp) throw new UserError('Staff record not found.');
  if (which === 'classification')
    await tx.query(
      `update payroll.employees set classification_confirmed=false, classification_confirmed_by=null, classification_confirmed_at=null where id=$1`,
      [employeeId],
    );
  else
    await tx.query(
      `update payroll.employees set clergy_config_confirmed=false, clergy_config_confirmed_by=null, clergy_config_confirmed_at=null where id=$1`,
      [employeeId],
    );
  await audit(tx, actor, `staff.${which}_flag_reopened`, 'employee', employeeId, `Reopened ${which} review for ${fullName(emp)}`);
}
