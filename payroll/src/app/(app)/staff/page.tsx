import Link from 'next/link';
import { Badge, Card, Empty, Flash, Money, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { ctxFor, hasRole } from '@/lib/services/core';
import { listEmployees, reviewFlags } from '@/lib/services/staff';

const TYPE = { employee: 'Employee', clergy: 'Clergy', contractor: 'Contractor' } as const;

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin', 'approver']);
  const emps = await withCtx(ctxFor(actor), (tx) => listEmployees(tx));
  const employees = emps.filter((e) => e.worker_type !== 'contractor');
  const contractors = emps.filter((e) => e.worker_type === 'contractor');
  const table = (rows: typeof emps) =>
    rows.length === 0 ? (
      <Empty>None yet.</Empty>
    ) : (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th className="num">Current rate</th>
              <th className="hide-sm">Start date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const flags = reviewFlags(e);
              return (
                <tr key={e.id}>
                  <td>
                    <Link href={`/staff/${e.id}`}>{e.first_name} {e.last_name}</Link>
                    <div className="small muted">{e.employee_code} · {e.job_title}</div>
                  </td>
                  <td>{TYPE[e.worker_type]}<div className="small muted">{e.pay_type}</div></td>
                  <td className="num">
                    {e.current_rate ? (
                      <>
                        <Money cents={e.current_rate.amount_cents} />
                        <span className="small muted">{e.pay_type === 'hourly' ? '/hr' : e.pay_type === 'salary' ? '/yr' : '/period'}</span>
                      </>
                    ) : (
                      <span className="small muted">None</span>
                    )}
                  </td>
                  <td className="hide-sm nowrap">{e.start_date}</td>
                  <td>
                    {e.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}{' '}
                    {flags.length > 0 && <Badge tone="warn">{flags.length} review flag{flags.length > 1 ? 's' : ''}</Badge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Contact details, pay rates and review flags. No Social Security numbers, bank details or tax forms are kept here."
        actions={hasRole(actor, 'admin') ? <Link href="/staff/new" className="btn">Add staff member</Link> : undefined}
      />
      <Flash searchParams={searchParams} />
      <Card title="Employees and clergy">{table(employees)}</Card>
      <Card title="Contractors" actions={<span className="small muted">Paid separately from employee payroll</span>}>{table(contractors)}</Card>
    </>
  );
}
