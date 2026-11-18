import type { Queryable } from '../db';
import { type Actor, hasRole } from './core';

export type Statement = {
  id: string;
  run_id: string;
  employee_id: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  gross_cents: number;
  reimbursement_cents: number;
  federal_withholding_cents: number;
  state_withholding_cents: number;
  social_security_cents: number;
  medicare_cents: number;
  other_deductions_cents: number;
  net_pay_cents: number;
  statement_ref: string;
  earnings_detail: { description: string; category: string; hours: number | null; rate_cents: number | null; amount_cents: number }[];
  published_at: string;
  run_number: number;
  run_status: string;
  provider_batch_ref: string | null;
  first_name: string;
  last_name: string;
  employee_code: string;
  worker_type: string;
};

const SELECT = `
  select s.*, r.run_number, r.status as run_status, r.provider_batch_ref,
         e.first_name, e.last_name, e.employee_code, e.worker_type
    from payroll.pay_statements s
    join payroll.pay_runs r on r.id = s.run_id
    join payroll.employees e on e.id = s.employee_id`;

/**
 * A staff member's own statements. The employee_id filter is checked here AND by the
 * row level security policy on pay_statements, so either one alone keeps statements private.
 */
export async function myStatements(tx: Queryable, actor: Actor): Promise<Statement[]> {
  if (!actor.employee_id) return [];
  return tx.query<Statement>(`${SELECT} where s.employee_id = $1 order by s.pay_date desc`, [actor.employee_id]);
}

export async function getStatementFor(tx: Queryable, actor: Actor, id: string): Promise<Statement | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await tx.one<Statement>(`${SELECT} where s.id = $1`, [id]);
  if (!s) return null;
  if (s.employee_id === actor.employee_id) return s;
  if (hasRole(actor, 'admin', 'approver')) return s;
  return null;
}

export async function statementsForRun(tx: Queryable, runId: string): Promise<Statement[]> {
  return tx.query<Statement>(`${SELECT} where s.run_id = $1 order by e.last_name`, [runId]);
}
