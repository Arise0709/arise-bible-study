import crypto from 'node:crypto';
import type { Queryable } from '../db';
import { totalsFor, type Line } from '../calc';
import { parseCsvObjects, toCsv } from '../csv';
import { centsToDecimal, formatMoney, parseMoney } from '../money';
import { isISODate } from '../schedule';
import { type Actor, UserError, audit, requireRole } from './core';
import { getExportProfile, type ExportProfile } from './settings';
import { fullName, type Employee } from './staff';
import { getRun, type Run } from './runs';

export type ExportRecord = {
  id: string;
  run_id: string;
  profile_name: string;
  kind: 'employee' | 'contractor';
  filename: string;
  row_count: number;
  total_cents: number;
  sha256: string;
  run_revision: number;
  created_at: string;
  created_by_name: string | null;
};

export type ProviderResult = {
  id: string;
  employee_id: string | null;
  employee_code: string;
  gross_cents: number;
  reimbursement_cents: number;
  federal_withholding_cents: number;
  state_withholding_cents: number;
  social_security_cents: number;
  medicare_cents: number;
  other_deductions_cents: number;
  net_pay_cents: number;
  statement_ref: string;
  check_date: string | null;
};

export type ReconItem = {
  id: string;
  employee_id: string | null;
  employee_code: string;
  issue: string;
  expected_cents: number | null;
  actual_cents: number | null;
  status: 'open' | 'acknowledged';
  note: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
};

export const ISSUE_LABELS: Record<string, string> = {
  gross_mismatch: 'Gross pay differs from the approved run',
  reimbursement_mismatch: 'Reimbursement differs from the approved run',
  deduction_mismatch: 'Deductions are lower than the approved deductions',
  missing_from_provider: 'In the approved run but missing from provider results',
  unexpected_in_provider: 'In provider results but not in the approved run',
  net_math: 'Net pay does not add up (gross + reimbursement - withholding - deductions)',
};

// ------------------------------------------------------------------ export

export type Agg = {
  emp: Employee;
  lines: Line[];
};

function fieldValue(field: string, a: Agg, run: Run, profile: ExportProfile): string | number {
  const money = (c: number) => (profile.amount_format === 'cents' ? String(c) : centsToDecimal(c));
  const date = (d: string) => (profile.date_format === 'MM/DD/YYYY' ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d);
  const sum = (type: string) => a.lines.filter((l) => l.line_type === type).reduce((s, l) => s + Number(l.amount_cents), 0);
  const hours = (type: string) =>
    Math.round(a.lines.filter((l) => l.line_type === type).reduce((s, l) => s + Number(l.hours ?? 0), 0) * 100) / 100;
  const latestRate = (type: string) => {
    const ls = a.lines.filter((l) => l.line_type === type).sort((x, y) => String(x.rate_effective_date).localeCompare(String(y.rate_effective_date)));
    return ls.length ? money(Number(ls[ls.length - 1].rate_cents)) : '';
  };
  const t = totalsFor(a.lines);
  switch (field) {
    case 'employee_code': return a.emp.employee_code;
    case 'first_name': return a.emp.first_name;
    case 'last_name': return a.emp.last_name;
    case 'full_name': return fullName(a.emp);
    case 'email': return a.emp.email;
    case 'worker_type': return a.emp.worker_type;
    case 'pay_type': return a.emp.pay_type;
    case 'run_number': return run.run_number;
    case 'period_start': return date(run.period_start);
    case 'period_end': return date(run.period_end);
    case 'pay_date': return date(run.pay_date);
    case 'regular_hours': return hours('regular') || '';
    case 'regular_rate': return latestRate('regular');
    case 'regular_pay': return money(sum('regular'));
    case 'overtime_hours': return hours('overtime') || '';
    case 'overtime_rate': return latestRate('overtime');
    case 'overtime_pay': return money(sum('overtime'));
    case 'rate_effective_date': {
      const d = a.lines.find((l) => l.line_type === 'regular' || l.line_type === 'overtime')?.rate_effective_date;
      return d ? date(String(d)) : '';
    }
    case 'salary': return money(sum('salary'));
    case 'clergy_salary': return money(sum('clergy_salary'));
    case 'housing_allowance': return money(sum('housing_allowance'));
    case 'bonus': return money(sum('bonus'));
    case 'other_earnings': return money(sum('other_earning'));
    case 'gross_earnings': return money(t.gross);
    case 'reimbursement': return money(t.reimbursements);
    case 'deduction': return money(t.deductions);
    case 'contractor_payment': return money(t.contractor);
    default: return '';
  }
}

export function buildExportCsv(
  run: Run,
  profile: ExportProfile,
  people: Agg[],
  kind: 'employee' | 'contractor',
  approvedBy: string,
): { csv: string; total: number } {
  const rows: unknown[][] = [];
  if (profile.include_banner)
    rows.push([
      `# REVIEW COPY - Arise Payroll ${kind === 'contractor' ? 'CONTRACTOR PAYMENTS' : 'EMPLOYEE PAYROLL'} - Run #${run.run_number} - ` +
        `Period ${run.period_start} to ${run.period_end} - Pay date ${run.pay_date} - Approved by ${approvedBy} - ` +
        `Not a payment instruction. Check every figure in your payroll provider before submitting.`,
    ]);
  rows.push(profile.columns.map((c) => c.header));
  let total = 0;
  for (const p of people) {
    const t = totalsFor(p.lines);
    total += kind === 'contractor' ? t.contractor : t.gross;
    for (const seg of rateSegments(p)) rows.push(profile.columns.map((c) => fieldValue(c.field, seg, run, profile)));
  }
  return { csv: toCsv(rows), total };
}

/**
 * When an hourly rate changed inside the period, write one row per rate so each row's
 * hours x rate equals its pay. The first row also carries every non-hourly line. Summing any
 * money column across rows still gives the person's total.
 */
export function rateSegments(a: Agg): Agg[] {
  const hourly = (l: Line) => l.line_type === 'regular' || l.line_type === 'overtime';
  const dates = [...new Set(a.lines.filter(hourly).map((l) => String(l.rate_effective_date)))].sort();
  if (dates.length <= 1) return [a];
  return dates.map((d, i) => ({
    emp: a.emp,
    lines: a.lines.filter((l) => (hourly(l) ? String(l.rate_effective_date) === d : i === 0)),
  }));
}

export async function exportRun(tx: Queryable, actor: Actor, runId: string): Promise<string[]> {
  requireRole(actor, 'admin');
  const run = await getRun(tx, runId);
  if (!run) throw new UserError('Pay run not found.');
  if (run.status !== 'approved') throw new UserError('Only an approved run can be exported.');
  if (run.approved_revision !== run.revision) throw new UserError('This run changed after approval. It needs a new review.');
  const profile = await getExportProfile(tx);
  const lines = await tx.query<Line>('select * from payroll.run_lines where run_id = $1 order by sort_order', [runId]);
  const emps = await tx.query<Employee>('select * from payroll.employees');
  const byEmp = new Map<string, Agg>();
  for (const l of lines) {
    const emp = emps.find((e) => e.id === l.employee_id)!;
    const a = byEmp.get(emp.id) ?? { emp, lines: [] };
    a.lines.push(l);
    byEmp.set(emp.id, a);
  }
  const all = [...byEmp.values()].sort((a, b) => a.emp.last_name.localeCompare(b.emp.last_name));
  const groups: ['employee' | 'contractor', Agg[]][] = [
    ['employee', all.filter((a) => a.emp.worker_type !== 'contractor')],
    ['contractor', all.filter((a) => a.emp.worker_type === 'contractor')],
  ];
  const ids: string[] = [];
  for (const [kind, people] of groups) {
    if (!people.length) continue;
    const { csv, total } = buildExportCsv(run, profile, people, kind, run.approved_by_name ?? 'approver');
    const filename = `ARISE-REVIEW_run-${String(run.run_number).padStart(4, '0')}_${run.period_start}_to_${run.period_end}_${kind === 'contractor' ? 'contractor-payments' : 'employee-payroll'}.csv`;
    const sha = crypto.createHash('sha256').update(csv).digest('hex');
    const row = await tx.one<{ id: string }>(
      `insert into payroll.exports (run_id, profile_id, profile_name, kind, filename, content, row_count, total_cents, sha256, run_revision, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [runId, profile.id, profile.name, kind, filename, csv, people.length, total, sha, run.revision, actor.id],
    );
    ids.push(row!.id);
  }
  await tx.query(`update payroll.pay_runs set status = 'exported', updated_at = now() where id = $1`, [runId]);
  await audit(tx, actor, 'run.exported', 'pay_run', runId, `Exported pay run #${run.run_number} for the payroll provider (${ids.length} file${ids.length === 1 ? '' : 's'}, layout "${profile.name}")`, {
    export_ids: ids,
    revision: run.revision,
  });
  return ids;
}

export async function listExports(tx: Queryable, runId: string): Promise<ExportRecord[]> {
  return tx.query<ExportRecord>(
    `select e.id, e.run_id, e.profile_name, e.kind, e.filename, e.row_count, e.total_cents, e.sha256, e.run_revision,
            e.created_at, u.display_name as created_by_name
       from payroll.exports e left join payroll.users u on u.id = e.created_by
      where e.run_id = $1 order by e.created_at, (e.kind = 'contractor')`,
    [runId],
  );
}

export async function getExportFile(tx: Queryable, actor: Actor, exportId: string) {
  requireRole(actor, 'admin', 'approver');
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) return null;
  const row = await tx.one<{ filename: string; content: string; run_id: string }>(
    'select filename, content, run_id from payroll.exports where id = $1',
    [exportId],
  );
  if (row) await audit(tx, actor, 'export.downloaded', 'pay_run', row.run_id, `Downloaded ${row.filename}`);
  return row;
}

export async function recordBatchRef(tx: Queryable, actor: Actor, runId: string, ref: string): Promise<void> {
  requireRole(actor, 'admin');
  const run = await getRun(tx, runId);
  if (!run) throw new UserError('Pay run not found.');
  if (run.status !== 'exported') throw new UserError('Record the provider batch reference after the run is exported.');
  if (!/^[\w./:#-]{2,80}$/.test(ref)) throw new UserError('Enter the batch or payroll ID exactly as the provider shows it.');
  await tx.query(
    `update payroll.pay_runs set provider_batch_ref = $2, provider_batch_recorded_by = $3, provider_batch_recorded_at = now(), updated_at = now() where id = $1`,
    [runId, ref, actor.id],
  );
  await audit(tx, actor, 'run.batch_recorded', 'pay_run', runId, `Recorded provider batch reference ${ref}${run.provider_batch_ref ? ` (was ${run.provider_batch_ref})` : ''}`, {
    ref,
    previous: run.provider_batch_ref,
  });
}

// ------------------------------------------------------------------ import and reconcile

export const RESULT_COLUMNS = [
  'employee_code',
  'gross_pay',
  'reimbursement',
  'federal_withholding',
  'state_withholding',
  'social_security',
  'medicare',
  'other_deductions',
  'net_pay',
  'statement_ref',
  'check_date',
];

export async function importProviderResults(
  tx: Queryable,
  actor: Actor,
  runId: string,
  filename: string,
  text: string,
): Promise<{ rows: number; issues: number }> {
  requireRole(actor, 'admin');
  const run = await getRun(tx, runId);
  if (!run) throw new UserError('Pay run not found.');
  if (run.status !== 'exported') throw new UserError('Provider results can be imported only after export and before reconciliation.');
  const { headers, rows } = parseCsvObjects(text);
  const codeKey = ['employee_code', 'employee_id', 'staff_id'].find((h) => headers.includes(h));
  const missing = ['gross_pay', 'net_pay'].filter((h) => !headers.includes(h));
  if (!codeKey || missing.length)
    throw new UserError(`The results file needs these columns: ${RESULT_COLUMNS.join(', ')}. Missing: ${[!codeKey ? 'employee_code' : '', ...missing].filter(Boolean).join(', ')}.`);
  if (!rows.length) throw new UserError('The results file has no data rows.');
  const emps = await tx.query<Employee>('select * from payroll.employees');
  const problems: string[] = [];
  const parsed = rows.map((r, i) => {
    const m = (k: string) => {
      if (!r[k]) return 0;
      const v = parseMoney(r[k]);
      if (v == null) problems.push(`Row ${i + 2}: "${k}" is not a dollar amount.`);
      return v ?? 0;
    };
    const emp = emps.find((e) => e.employee_code.toLowerCase() === r[codeKey].toLowerCase()) ?? null;
    if (r.check_date && !isISODate(r.check_date)) problems.push(`Row ${i + 2}: check_date must be YYYY-MM-DD.`);
    return {
      emp,
      code: r[codeKey],
      gross: m('gross_pay'),
      reimb: m('reimbursement'),
      fed: m('federal_withholding'),
      state: m('state_withholding'),
      ss: m('social_security'),
      med: m('medicare'),
      other: m('other_deductions'),
      net: m('net_pay'),
      ref: r.statement_ref ?? '',
      date: r.check_date || null,
    };
  });
  if (problems.length) throw new UserError(`Nothing was imported. ${problems.slice(0, 8).join(' ')}`);
  const dupes = parsed.map((p) => p.code.toLowerCase()).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupes.length) throw new UserError(`Each person should appear once. Duplicated: ${[...new Set(dupes)].join(', ')}.`);

  await tx.query('update payroll.provider_imports set is_current = false where run_id = $1', [runId]);
  const imp = await tx.one<{ id: string }>(
    `insert into payroll.provider_imports (run_id, filename, content, row_count, imported_by) values ($1,$2,$3,$4,$5) returning id`,
    [runId, filename, text, parsed.length, actor.id],
  );
  for (const p of parsed) {
    await tx.query(
      `insert into payroll.provider_results (import_id, run_id, employee_id, employee_code, gross_cents, reimbursement_cents,
         federal_withholding_cents, state_withholding_cents, social_security_cents, medicare_cents, other_deductions_cents,
         net_pay_cents, statement_ref, check_date) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [imp!.id, runId, p.emp?.id ?? null, p.code, p.gross, p.reimb, p.fed, p.state, p.ss, p.med, p.other, p.net, p.ref, p.date],
    );
  }
  const issues = await compareResults(tx, runId, imp!.id);
  await audit(tx, actor, 'provider.results_imported', 'pay_run', runId, `Imported provider results from ${filename}: ${parsed.length} people, ${issues} difference${issues === 1 ? '' : 's'} flagged`, {
    import_id: imp!.id,
    rows: parsed.length,
    issues,
  });
  return { rows: parsed.length, issues };
}

async function compareResults(tx: Queryable, runId: string, importId: string): Promise<number> {
  const lines = await tx.query<Line>('select * from payroll.run_lines where run_id = $1', [runId]);
  const results = await tx.query<ProviderResult>('select * from payroll.provider_results where import_id = $1', [importId]);
  const emps = await tx.query<Employee>('select * from payroll.employees');
  const expected = new Map<string, ReturnType<typeof totalsFor> & { emp: Employee }>();
  for (const id of new Set(lines.map((l) => l.employee_id))) {
    expected.set(id, { ...totalsFor(lines.filter((l) => l.employee_id === id)), emp: emps.find((e) => e.id === id)! });
  }
  const issues: { employee_id: string | null; code: string; issue: string; expected: number | null; actual: number | null }[] = [];
  for (const [id, exp] of expected) {
    const r = results.find((x) => x.employee_id === id);
    const expGross = exp.emp.worker_type === 'contractor' ? exp.contractor : exp.gross;
    if (!r) {
      issues.push({ employee_id: id, code: exp.emp.employee_code, issue: 'missing_from_provider', expected: expGross, actual: null });
      continue;
    }
    if (r.gross_cents !== expGross)
      issues.push({ employee_id: id, code: exp.emp.employee_code, issue: 'gross_mismatch', expected: expGross, actual: r.gross_cents });
    if (r.reimbursement_cents !== exp.reimbursements)
      issues.push({ employee_id: id, code: exp.emp.employee_code, issue: 'reimbursement_mismatch', expected: exp.reimbursements, actual: r.reimbursement_cents });
    // Provider deductions can include benefits we do not track, so only flag when they are LOWER
    // than what was approved here (an approved deduction was probably not applied).
    if (r.other_deductions_cents < exp.deductions)
      issues.push({ employee_id: id, code: exp.emp.employee_code, issue: 'deduction_mismatch', expected: exp.deductions, actual: r.other_deductions_cents });
    const computedNet =
      r.gross_cents + r.reimbursement_cents - r.federal_withholding_cents - r.state_withholding_cents -
      r.social_security_cents - r.medicare_cents - r.other_deductions_cents;
    if (Math.abs(computedNet - r.net_pay_cents) > 1)
      issues.push({ employee_id: id, code: exp.emp.employee_code, issue: 'net_math', expected: computedNet, actual: r.net_pay_cents });
  }
  for (const r of results) {
    if (!r.employee_id || !expected.has(r.employee_id))
      issues.push({ employee_id: r.employee_id, code: r.employee_code, issue: 'unexpected_in_provider', expected: null, actual: r.gross_cents });
  }
  for (const i of issues) {
    await tx.query(
      `insert into payroll.reconciliation_items (run_id, import_id, employee_id, employee_code, issue, expected_cents, actual_cents)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [runId, importId, i.employee_id, i.code, i.issue, i.expected, i.actual],
    );
  }
  return issues.length;
}

export async function getReconciliation(tx: Queryable, runId: string) {
  const imp = await tx.one<{ id: string; filename: string; row_count: number; imported_at: string; imported_by_name: string | null }>(
    `select i.id, i.filename, i.row_count, i.imported_at, u.display_name as imported_by_name
       from payroll.provider_imports i left join payroll.users u on u.id = i.imported_by
      where i.run_id = $1 and i.is_current order by i.imported_at desc limit 1`,
    [runId],
  );
  if (!imp) return null;
  const results = await tx.query<ProviderResult & { first_name: string | null; last_name: string | null }>(
    `select r.*, e.first_name, e.last_name from payroll.provider_results r
       left join payroll.employees e on e.id = r.employee_id where r.import_id = $1 order by e.last_name nulls last`,
    [imp.id],
  );
  const items = await tx.query<ReconItem>(
    `select i.*, u.display_name as resolved_by_name from payroll.reconciliation_items i
       left join payroll.users u on u.id = i.resolved_by where i.import_id = $1 order by i.created_at`,
    [imp.id],
  );
  return { import: imp, results, items };
}

export async function acknowledgeDifference(tx: Queryable, actor: Actor, runId: string, itemId: string, note: string): Promise<void> {
  requireRole(actor, 'admin', 'approver');
  const run = await getRun(tx, runId);
  if (!run || run.status !== 'exported') throw new UserError('Differences can only be resolved while the run is exported.');
  if (note.length < 5) throw new UserError('Explain why the difference is acceptable (for example, what the provider confirmed).');
  const item = await tx.one<ReconItem>("select * from payroll.reconciliation_items where id = $1 and run_id = $2 and status = 'open'", [itemId, runId]);
  if (!item) throw new UserError('That difference is not open.');
  await tx.query(
    `update payroll.reconciliation_items set status = 'acknowledged', note = $2, resolved_by = $3, resolved_at = now() where id = $1`,
    [itemId, note, actor.id],
  );
  await audit(tx, actor, 'reconcile.difference_acknowledged', 'pay_run', runId, `Accepted difference for ${item.employee_code} (${ISSUE_LABELS[item.issue]}): ${note}`, {
    item_id: itemId,
    expected_cents: item.expected_cents,
    actual_cents: item.actual_cents,
    note,
  });
}

export async function reconcileRun(tx: Queryable, actor: Actor, runId: string): Promise<number> {
  requireRole(actor, 'admin');
  const run = await getRun(tx, runId);
  if (!run) throw new UserError('Pay run not found.');
  if (run.status !== 'exported') throw new UserError('Only an exported run can be reconciled.');
  if (!run.provider_batch_ref) throw new UserError('Record the provider batch reference first.');
  const rec = await getReconciliation(tx, runId);
  if (!rec) throw new UserError('Import the provider results first.');
  const open = rec.items.filter((i) => i.status === 'open');
  if (open.length) throw new UserError(`${open.length} difference${open.length === 1 ? ' is' : 's are'} still open. Fix the import or accept each one with a note.`);
  const lines = await tx.query<Line>('select * from payroll.run_lines where run_id = $1 order by sort_order', [runId]);
  let published = 0;
  for (const r of rec.results) {
    if (!r.employee_id) continue;
    const detail = lines
      .filter((l) => l.employee_id === r.employee_id)
      .map((l) => ({ description: l.description, category: l.category, hours: l.hours, rate_cents: l.rate_cents, amount_cents: l.amount_cents }));
    await tx.query(
      `insert into payroll.pay_statements (run_id, employee_id, provider_result_id, pay_date, period_start, period_end,
         gross_cents, reimbursement_cents, federal_withholding_cents, state_withholding_cents, social_security_cents,
         medicare_cents, other_deductions_cents, net_pay_cents, statement_ref, earnings_detail, published_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict (run_id, employee_id) do nothing`,
      [
        runId, r.employee_id, r.id, r.check_date ?? run.pay_date, run.period_start, run.period_end, r.gross_cents,
        r.reimbursement_cents, r.federal_withholding_cents, r.state_withholding_cents, r.social_security_cents,
        r.medicare_cents, r.other_deductions_cents, r.net_pay_cents, r.statement_ref, JSON.stringify(detail), actor.id,
      ],
    );
    published++;
  }
  await tx.query(
    `update payroll.pay_runs set status = 'reconciled', reconciled_by = $2, reconciled_at = now(), updated_at = now() where id = $1`,
    [runId, actor.id],
  );
  const net = rec.results.reduce((s, r) => s + r.net_pay_cents, 0);
  await audit(tx, actor, 'run.reconciled', 'pay_run', runId, `Reconciled pay run #${run.run_number} against provider batch ${run.provider_batch_ref}; published ${published} pay statements (provider net ${formatMoney(net)})`, {
    import_id: rec.import.id,
    accepted_differences: rec.items.length,
    published,
  });
  return published;
}

/**
 * DEMO ONLY. Builds a fictional provider results file that matches an exported run, with made-up
 * withholding so the reconciliation screens have something to show. These numbers are NOT tax
 * calculations and must never be used for real pay.
 */
export async function mockProviderResultsCsv(tx: Queryable, runId: string): Promise<string> {
  const run = await getRun(tx, runId);
  if (!run) throw new UserError('Pay run not found.');
  const lines = await tx.query<Line>('select * from payroll.run_lines where run_id = $1', [runId]);
  const emps = await tx.query<Employee>('select * from payroll.employees');
  const rows: unknown[][] = [RESULT_COLUMNS];
  const ids = [...new Set(lines.map((l) => l.employee_id))];
  for (const id of ids) {
    const emp = emps.find((e) => e.id === id)!;
    const pl = lines.filter((l) => l.employee_id === id);
    const t = totalsFor(pl);
    let gross = t.gross;
    let fed = 0, state = 0, ss = 0, med = 0;
    if (emp.worker_type === 'contractor') {
      gross = t.contractor;
    } else if (emp.worker_type === 'clergy') {
      const housing = pl.filter((l) => l.line_type === 'housing_allowance').reduce((s, l) => s + Number(l.amount_cents), 0);
      fed = Math.round((gross - housing) * 0.1); // fictional voluntary withholding
      state = Math.round((gross - housing) * 0.04);
    } else {
      fed = Math.round(gross * 0.09);
      state = Math.round(gross * 0.04);
      ss = Math.round(gross * 0.062);
      med = Math.round(gross * 0.0145);
    }
    const other = t.deductions;
    const net = gross + t.reimbursements - fed - state - ss - med - other;
    rows.push([
      emp.employee_code, centsToDecimal(gross), centsToDecimal(t.reimbursements), centsToDecimal(fed), centsToDecimal(state),
      centsToDecimal(ss), centsToDecimal(med), centsToDecimal(other), centsToDecimal(net),
      `DEMO-${run.run_number}-${emp.employee_code}`, run.pay_date,
    ]);
  }
  return toCsv(rows);
}
