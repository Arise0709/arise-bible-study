import Link from 'next/link';
import { Card, Empty, Money, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { formatDate } from '@/lib/schedule';
import { ctxFor } from '@/lib/services/core';
import { getEmployee } from '@/lib/services/staff';
import { myStatements } from '@/lib/services/statements';

export default async function MyPay() {
  const actor = await requireUser();
  const { emp, statements } = await withCtx(ctxFor(actor), async (tx) => ({
    emp: actor.employee_id ? await getEmployee(tx, actor.employee_id) : null,
    statements: await myStatements(tx, actor),
  }));
  return (
    <>
      <PageHeader title="My pay" subtitle="Your profile and the pay statements published from the payroll provider." />
      {!emp ? (
        <Card><Empty>Your account is not linked to a staff record. Ask a payroll admin.</Empty></Card>
      ) : (
        <div className="grid grid-2">
          <Card title="My profile">
            <dl className="kv">
              <dt>Name</dt><dd>{emp.first_name} {emp.last_name}</dd>
              <dt>Staff ID</dt><dd>{emp.employee_code}</dd>
              <dt>Role</dt><dd>{emp.job_title}</dd>
              <dt>Email</dt><dd>{emp.email}</dd>
              <dt>Phone</dt><dd>{emp.phone || '—'}</dd>
              <dt>Start date</dt><dd>{formatDate(emp.start_date)}</dd>
            </dl>
            <p className="small muted" style={{ marginTop: '0.75rem' }}>
              To change your address, tax withholding or direct deposit, use the payroll provider’s employee portal or contact the church office.
            </p>
          </Card>
          <Card title="Pay statements">
            {statements.length === 0 ? (
              <Empty>No statements published yet.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Pay date</th><th className="num">Gross</th><th className="num">Net pay</th></tr></thead>
                  <tbody>
                    {statements.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/me/statements/${s.id}`}>{formatDate(s.pay_date)}</Link>
                          {s.run_status === 'voided' && <div className="badge badge-voided">Voided</div>}
                        </td>
                        <td className="num"><Money cents={s.gross_cents} /></td>
                        <td className="num"><Money cents={s.net_pay_cents} strong /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
