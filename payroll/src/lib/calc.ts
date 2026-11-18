/**
 * Draft gross pay calculation. Pure functions: no database, no framework.
 *
 * This produces GROSS earnings, reimbursements, deductions entered by the admin, and contractor
 * payments. It does not calculate tax withholding or net pay. Those come back from the payroll
 * provider and are imported during reconciliation.
 */
import { hoursTimesRate } from './money';
import { periodsPerYear, type Schedule } from './schedule';

export type WorkerType = 'employee' | 'clergy' | 'contractor';
export type PayType = 'hourly' | 'salary' | 'contract';
export type Category = 'earning' | 'reimbursement' | 'deduction' | 'contractor';

export type CalcEmployee = {
  id: string;
  worker_type: WorkerType;
  pay_type: PayType;
  start_date: string;
  active: boolean;
};
export type CalcRate = { employee_id: string; pay_type: PayType; amount_cents: number; effective_date: string };
export type CalcHousing = {
  employee_id: string;
  annual_amount_cents: number;
  effective_date: string;
  approval_reference: string;
};
export type CalcTime = {
  employee_id: string;
  work_date: string | null;
  regular_hours: number;
  overtime_hours: number;
  status: 'pending' | 'approved';
};
export type CalcItem = {
  employee_id: string;
  kind: 'bonus' | 'other_earning' | 'reimbursement' | 'deduction' | 'contractor_payment';
  description: string;
  amount_cents: number;
};
export type CalcRun = { schedule: Schedule; period_start: string; period_end: string };

export type Line = {
  employee_id: string;
  worker_type: WorkerType;
  category: Category;
  line_type: string;
  description: string;
  hours: number | null;
  rate_cents: number | null;
  amount_cents: number;
  rate_effective_date: string | null;
  sort_order: number;
};

export type CalcResult = { lines: Line[]; warnings: { employee_id: string; message: string }[] };

/** The rate in effect on `date`: the latest effective_date on or before it. */
export function rateOn<T extends { effective_date: string }>(rows: T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.effective_date <= date && (!best || r.effective_date > best.effective_date)) best = r;
  }
  return best;
}

export const ITEM_CATEGORY: Record<CalcItem['kind'], Category> = {
  bonus: 'earning',
  other_earning: 'earning',
  reimbursement: 'reimbursement',
  deduction: 'deduction',
  contractor_payment: 'contractor',
};

export function calculateRun(input: {
  run: CalcRun;
  overtimeMultiplier: number;
  employees: CalcEmployee[];
  rates: CalcRate[];
  housing: CalcHousing[];
  time: CalcTime[];
  items: CalcItem[];
}): CalcResult {
  const { run } = input;
  const ppy = periodsPerYear(run.schedule);
  const lines: Line[] = [];
  const warnings: CalcResult['warnings'] = [];

  for (const emp of input.employees) {
    const hasInputs =
      input.time.some((t) => t.employee_id === emp.id) || input.items.some((i) => i.employee_id === emp.id);
    if (emp.start_date > run.period_end) continue;
    if (!emp.active && !hasInputs) continue;

    const rates = input.rates.filter((r) => r.employee_id === emp.id && r.pay_type === emp.pay_type);
    const push = (l: Omit<Line, 'employee_id' | 'worker_type'>) =>
      lines.push({ employee_id: emp.id, worker_type: emp.worker_type, ...l });
    const warn = (message: string) => warnings.push({ employee_id: emp.id, message });

    const midPeriodChange = rates.find((r) => r.effective_date > run.period_start && r.effective_date <= run.period_end);

    if (emp.pay_type === 'hourly') {
      // Each day's hours are paid at the rate in effect on that day, so a mid-period raise
      // is applied exactly. Entries without a date use the rate on the last day of the period.
      const groups = new Map<string, { rate: CalcRate; regular: number; overtime: number }>();
      for (const t of input.time.filter((t) => t.employee_id === emp.id)) {
        if (t.status !== 'approved') continue;
        const on = t.work_date ?? run.period_end;
        const rate = rateOn(rates, on);
        if (!rate) {
          warn(`No hourly rate in effect on ${on}. Those hours are not included.`);
          continue;
        }
        const g = groups.get(rate.effective_date) ?? { rate, regular: 0, overtime: 0 };
        g.regular += Number(t.regular_hours);
        g.overtime += Number(t.overtime_hours);
        groups.set(rate.effective_date, g);
      }
      const pending = input.time.filter((t) => t.employee_id === emp.id && t.status === 'pending');
      if (pending.length) warn(`${pending.length} time entr${pending.length === 1 ? 'y is' : 'ies are'} not approved and not included.`);
      let sort = 0;
      for (const g of [...groups.values()].sort((a, b) => a.rate.effective_date.localeCompare(b.rate.effective_date))) {
        const regular = Math.round(g.regular * 100) / 100;
        const overtime = Math.round(g.overtime * 100) / 100;
        if (regular > 0)
          push({
            category: 'earning',
            line_type: 'regular',
            description: 'Regular hours',
            hours: regular,
            rate_cents: g.rate.amount_cents,
            amount_cents: hoursTimesRate(regular, g.rate.amount_cents),
            rate_effective_date: g.rate.effective_date,
            sort_order: sort++,
          });
        if (overtime > 0) {
          // Round once, on the final amount (hours x base rate x multiplier), not on the rate.
          const otRate = Math.round(g.rate.amount_cents * input.overtimeMultiplier);
          push({
            category: 'earning',
            line_type: 'overtime',
            description: `Overtime hours (${input.overtimeMultiplier}x)`,
            hours: overtime,
            rate_cents: otRate,
            amount_cents: Math.round((Math.round(overtime * 100) * g.rate.amount_cents * input.overtimeMultiplier) / 100),
            rate_effective_date: g.rate.effective_date,
            sort_order: sort++,
          });
        }
      }
    } else if (emp.pay_type === 'salary') {
      const rate = rateOn(rates, run.period_end);
      if (!rate) {
        warn('No salary in effect for this period. Add a pay rate.');
      } else {
        if (midPeriodChange)
          warn(
            `Salary changed on ${midPeriodChange.effective_date}, inside this period. The new salary is used for the whole period. Add an adjustment if it should be prorated.`,
          );
        const perPeriod = Math.round(rate.amount_cents / ppy);
        if (emp.worker_type === 'clergy') {
          const h = rateOn(
            input.housing.filter((x) => x.employee_id === emp.id),
            run.period_end,
          );
          let housing = h ? Math.round(h.annual_amount_cents / ppy) : 0;
          if (housing > perPeriod) {
            warn('Designated housing allowance is larger than total compensation. Capped at total compensation.');
            housing = perPeriod;
          }
          push({
            category: 'earning',
            line_type: 'clergy_salary',
            description: 'Clergy salary',
            hours: null,
            rate_cents: rate.amount_cents,
            amount_cents: perPeriod - housing,
            rate_effective_date: rate.effective_date,
            sort_order: 0,
          });
          if (housing > 0 && h)
            push({
              category: 'earning',
              line_type: 'housing_allowance',
              description: `Housing allowance (designated, ref: ${h.approval_reference})`,
              hours: null,
              rate_cents: h.annual_amount_cents,
              amount_cents: housing,
              rate_effective_date: h.effective_date,
              sort_order: 1,
            });
        } else {
          push({
            category: 'earning',
            line_type: 'salary',
            description: 'Salary',
            hours: null,
            rate_cents: rate.amount_cents,
            amount_cents: perPeriod,
            rate_effective_date: rate.effective_date,
            sort_order: 0,
          });
        }
      }
    } else if (emp.pay_type === 'contract') {
      const fee = rateOn(rates, run.period_end);
      const hasPayments = input.items.some((i) => i.employee_id === emp.id && i.kind === 'contractor_payment');
      if (fee && fee.amount_cents > 0 && !hasPayments)
        push({
          category: 'contractor',
          line_type: 'contractor_fee',
          description: 'Contract fee (standing)',
          hours: null,
          rate_cents: fee.amount_cents,
          amount_cents: fee.amount_cents,
          rate_effective_date: fee.effective_date,
          sort_order: 0,
        });
    }

    let sort = 10;
    for (const item of input.items.filter((i) => i.employee_id === emp.id)) {
      push({
        category: ITEM_CATEGORY[item.kind],
        line_type: item.kind,
        description: item.description,
        hours: null,
        rate_cents: null,
        amount_cents: item.amount_cents,
        rate_effective_date: null,
        sort_order: sort++,
      });
    }
  }
  return { lines, warnings };
}

export type PersonTotals = {
  gross: number;
  reimbursements: number;
  deductions: number;
  contractor: number;
  regularHours: number;
  overtimeHours: number;
};

export function totalsFor(lines: Pick<Line, 'category' | 'amount_cents' | 'line_type' | 'hours'>[]): PersonTotals {
  const t: PersonTotals = { gross: 0, reimbursements: 0, deductions: 0, contractor: 0, regularHours: 0, overtimeHours: 0 };
  for (const l of lines) {
    const amt = Number(l.amount_cents);
    if (l.category === 'earning') t.gross += amt;
    else if (l.category === 'reimbursement') t.reimbursements += amt;
    else if (l.category === 'deduction') t.deductions += amt;
    else if (l.category === 'contractor') t.contractor += amt;
    if (l.line_type === 'regular') t.regularHours += Number(l.hours ?? 0);
    if (l.line_type === 'overtime') t.overtimeHours += Number(l.hours ?? 0);
  }
  t.regularHours = Math.round(t.regularHours * 100) / 100;
  t.overtimeHours = Math.round(t.overtimeHours * 100) / 100;
  return t;
}
