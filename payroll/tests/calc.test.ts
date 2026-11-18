import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRun, rateOn, totalsFor } from '../src/lib/calc';
import { parseMoney, formatMoney, hoursTimesRate } from '../src/lib/money';
import { nextPayday, periodContaining } from '../src/lib/schedule';
import { parseCsv, toCsv } from '../src/lib/csv';
import { base32Decode, totpAt, verifyTotp, hashPassword, verifyPassword } from '../src/lib/crypto';

const run = { schedule: 'biweekly' as const, period_start: '2026-11-09', period_end: '2026-11-22' };
const emp = (id: string, worker_type: 'employee' | 'clergy' | 'contractor', pay_type: 'hourly' | 'salary' | 'contract') => ({
  id, worker_type, pay_type, start_date: '2020-01-01', active: true,
});

test('money parsing and formatting', () => {
  assert.equal(parseMoney('1,234.5'), 123450);
  assert.equal(parseMoney('$18.50'), 1850);
  assert.equal(parseMoney('12.345'), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(-5), '-$0.05');
  assert.equal(hoursTimesRate(7.5, 1925), 14438); // 144.375 rounds half up
});

test('rate in effect is the latest on or before the date', () => {
  const rates = [{ effective_date: '2026-01-01', v: 1 }, { effective_date: '2026-11-16', v: 2 }];
  assert.equal(rateOn(rates, '2026-11-15')?.v, 1);
  assert.equal(rateOn(rates, '2026-11-16')?.v, 2);
  assert.equal(rateOn(rates, '2025-12-31'), null);
});

test('hourly pay uses the rate in effect on each work date, overtime at 1.5x', () => {
  const r = calculateRun({
    run, overtimeMultiplier: 1.5, employees: [emp('h', 'employee', 'hourly')], housing: [], items: [],
    rates: [
      { employee_id: 'h', pay_type: 'hourly', amount_cents: 1850, effective_date: '2025-01-01' },
      { employee_id: 'h', pay_type: 'hourly', amount_cents: 1925, effective_date: '2026-11-16' },
    ],
    time: [
      { employee_id: 'h', work_date: '2026-11-13', regular_hours: 40, overtime_hours: 0, status: 'approved' },
      { employee_id: 'h', work_date: '2026-11-20', regular_hours: 40, overtime_hours: 2.5, status: 'approved' },
      { employee_id: 'h', work_date: '2026-11-21', regular_hours: 8, overtime_hours: 0, status: 'pending' },
    ],
  });
  const t = totalsFor(r.lines);
  assert.equal(t.gross, 74000 + 77000 + 7219); // 2.5 x 19.25 x 1.5 = 72.1875 -> 72.19
  assert.equal(t.regularHours, 80);
  assert.ok(r.warnings.some((w) => w.message.includes('not approved')), 'pending hours are excluded with a warning');
});

test('clergy pay splits total compensation into salary and designated housing', () => {
  const r = calculateRun({
    run, overtimeMultiplier: 1.5, employees: [emp('c', 'clergy', 'salary')], time: [], items: [],
    rates: [{ employee_id: 'c', pay_type: 'salary', amount_cents: 6_240_000, effective_date: '2026-01-01' }],
    housing: [{ employee_id: 'c', annual_amount_cents: 1_800_000, effective_date: '2026-01-01', approval_reference: 'Res 1' }],
  });
  const housing = r.lines.find((l) => l.line_type === 'housing_allowance')!;
  const salary = r.lines.find((l) => l.line_type === 'clergy_salary')!;
  assert.equal(housing.amount_cents, 69231);
  assert.equal(salary.amount_cents + housing.amount_cents, 240000);
});

test('salaried pay is annual / periods per year, contractors and items stay in their categories', () => {
  const r = calculateRun({
    run, overtimeMultiplier: 1.5, employees: [emp('s', 'employee', 'salary'), emp('k', 'contractor', 'contract')], time: [], housing: [],
    rates: [
      { employee_id: 's', pay_type: 'salary', amount_cents: 4_850_000, effective_date: '2026-01-05' },
      { employee_id: 'k', pay_type: 'contract', amount_cents: 0, effective_date: '2025-01-01' },
    ],
    items: [
      { employee_id: 's', kind: 'reimbursement', description: 'Supplies', amount_cents: 4218 },
      { employee_id: 's', kind: 'deduction', description: 'Shirt', amount_cents: 2500 },
      { employee_id: 'k', kind: 'contractor_payment', description: 'Invoice', amount_cents: 65000 },
    ],
  });
  const s = totalsFor(r.lines.filter((l) => l.employee_id === 's'));
  const k = totalsFor(r.lines.filter((l) => l.employee_id === 'k'));
  assert.deepEqual([s.gross, s.reimbursements, s.deductions, s.contractor], [186538, 4218, 2500, 0]);
  assert.deepEqual([k.gross, k.contractor], [0, 65000]);
});

test('mid-period salary change is flagged', () => {
  const r = calculateRun({
    run, overtimeMultiplier: 1.5, employees: [emp('s', 'employee', 'salary')], time: [], housing: [], items: [],
    rates: [
      { employee_id: 's', pay_type: 'salary', amount_cents: 4_000_000, effective_date: '2026-01-01' },
      { employee_id: 's', pay_type: 'salary', amount_cents: 5_000_000, effective_date: '2026-11-16' },
    ],
  });
  assert.ok(r.warnings.some((w) => w.message.includes('prorated')));
});

test('pay schedules', () => {
  assert.deepEqual(periodContaining('biweekly', '2026-11-18', '2026-11-09', 5), { start: '2026-11-09', end: '2026-11-22', payDate: '2026-11-27' });
  assert.deepEqual(periodContaining('weekly', '2026-11-18', '2026-11-09', 5), { start: '2026-11-16', end: '2026-11-22', payDate: '2026-11-27' });
  assert.equal(periodContaining('semimonthly', '2026-02-20', '2026-11-09', 0).end, '2026-02-28');
  assert.equal(periodContaining('monthly', '2026-11-18', '2026-11-09', 0).start, '2026-11-01');
  assert.equal(nextPayday('biweekly', '2026-11-18', '2026-11-09', 5).payDate, '2026-11-27');
  assert.equal(nextPayday('biweekly', '2026-11-12', '2026-11-09', 5).payDate, '2026-11-13'); // last period not paid yet
});

test('CSV round trip and formula injection guard', () => {
  const csv = toCsv([['a', 'b, c', 'say "hi"'], ['=SUM(A1)', '-12.50', '@x']]);
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['a', 'b, c', 'say "hi"']);
  assert.deepEqual(rows[1], ["'=SUM(A1)", '-12.50', "'@x"]);
});

test('TOTP matches RFC 6238 and blocks replay', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  const now = 1111111109 * 1000;
  const step = verifyTotp(secret, '081804', null, now);
  assert.equal(step, Math.floor(1111111109 / 30));
  assert.equal(verifyTotp(secret, '081804', step, now), null, 'same code cannot be used twice');
});

test('password hashing', () => {
  const h = hashPassword('correct horse 123');
  assert.ok(verifyPassword('correct horse 123', h));
  assert.ok(!verifyPassword('wrong', h));
});
