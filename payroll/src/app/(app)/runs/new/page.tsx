import { Card, Field, Flash, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { ctxFor } from '@/lib/services/core';
import { suggestNextPeriod } from '@/lib/services/runs';
import { SCHEDULES } from '@/lib/schedule';
import { createRunAction } from '../../actions';

export default async function NewRun({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin']);
  const p = await withCtx(ctxFor(actor), (tx) => suggestNextPeriod(tx));
  return (
    <>
      <PageHeader title="Start a pay run" crumb={{ href: '/runs', label: 'Pay runs' }} subtitle="Dates are filled in from your pay schedule. Change them if needed." />
      <Flash searchParams={searchParams} />
      <Card>
        <form action={createRunAction}>
          <div className="form-grid">
            <Field label="Pay schedule">
              <select name="schedule" defaultValue={p.schedule}>
                {SCHEDULES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Period start">
              <input type="date" name="period_start" defaultValue={p.start} required />
            </Field>
            <Field label="Period end">
              <input type="date" name="period_end" defaultValue={p.end} required />
            </Field>
            <Field label="Pay date">
              <input type="date" name="pay_date" defaultValue={p.payDate} required />
            </Field>
            <Field label="Notes (optional)" wide>
              <input type="text" name="notes" maxLength={300} />
            </Field>
          </div>
          <p className="muted small">
            Salaried and clergy pay are added automatically from each person’s pay rate in effect on the last day
            of the period. You will add hourly time, bonuses, reimbursements, deductions and contractor payments next.
          </p>
          <div className="form-actions">
            <button className="btn" type="submit">Create draft run</button>
          </div>
        </form>
      </Card>
    </>
  );
}
