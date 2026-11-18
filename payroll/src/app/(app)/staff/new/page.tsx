import { Card, Field, Flash, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { createEmployeeAction } from '../../actions';
import { EmployeeFields } from '../EmployeeFields';

export default async function NewStaff({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser(['admin']);
  return (
    <>
      <PageHeader title="Add staff member" crumb={{ href: '/staff', label: 'Staff' }} />
      <Flash searchParams={searchParams} />
      <div className="notice notice-info">
        Do not enter Social Security numbers, bank accounts or tax forms here. Send the new hire through your payroll provider’s secure onboarding for those.
      </div>
      <Card>
        <form action={createEmployeeAction}>
          <EmployeeFields />
          <h3 style={{ marginTop: '1.25rem' }}>Starting pay</h3>
          <div className="form-grid" style={{ marginTop: '0.5rem' }}>
            <Field label="Amount ($)" hint="Hourly: rate per hour. Salary and clergy: annual total (clergy includes any housing allowance). Contractor: standing fee per period, or 0.">
              <input type="text" name="rate_amount" inputMode="decimal" required />
            </Field>
            <Field label="Effective date" hint="Defaults to the start date.">
              <input type="date" name="rate_effective" />
            </Field>
          </div>
          <p className="small muted">New records start with an unconfirmed classification flag. An approver must confirm it before this person can be paid.</p>
          <div className="form-actions">
            <button className="btn" type="submit">Add staff member</button>
          </div>
        </form>
      </Card>
    </>
  );
}
