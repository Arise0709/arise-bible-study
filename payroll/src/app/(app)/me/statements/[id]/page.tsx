import { notFound } from 'next/navigation';
import { Card, Money, PageHeader } from '@/components/ui';
import { PrintButton } from '@/components/PrintButton';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/schedule';
import { ctxFor, hasRole } from '@/lib/services/core';
import { getStatementFor } from '@/lib/services/statements';

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  const s = await withCtx(ctxFor(actor), (tx) => getStatementFor(tx, actor, id));
  // Someone else's statement looks exactly like one that does not exist.
  if (!s) notFound();
  const contractor = s.worker_type === 'contractor';
  const withholding = [
    ['Federal income tax', s.federal_withholding_cents],
    ['Alabama income tax', s.state_withholding_cents],
    ['Social Security', s.social_security_cents],
    ['Medicare', s.medicare_cents],
    ['Other deductions', s.other_deductions_cents],
  ] as const;
  return (
    <>
      <PageHeader
        crumb={hasRole(actor, 'admin', 'approver') && s.employee_id !== actor.employee_id ? { href: `/runs/${s.run_id}`, label: `Pay run #${s.run_number}` } : { href: '/me', label: 'My pay' }}
        title={contractor ? 'Payment statement' : 'Pay statement'}
        actions={<PrintButton />}
      />
      {s.run_status === 'voided' && <div className="notice notice-danger">This pay run was voided. Contact the church office about this statement.</div>}
      <Card>
        <div className="statement">
          <div className="statement-head">
            <div>
              <h2>{s.first_name} {s.last_name}</h2>
              <p className="small muted">Staff ID {s.employee_code}</p>
              <dl className="kv" style={{ marginTop: '0.5rem' }}>
                <dt>Pay date</dt><dd>{formatDate(s.pay_date)}</dd>
                <dt>Pay period</dt><dd>{formatDate(s.period_start)} – {formatDate(s.period_end)}</dd>
                <dt>Provider ref.</dt><dd className="mono">{s.statement_ref || '—'}</dd>
              </dl>
            </div>
            <div className="net-box">
              <div className="stat-label">Net pay</div>
              <div className="stat-value">{formatMoney(s.net_pay_cents)}</div>
            </div>
          </div>
          <h3>Earnings</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {s.earnings_detail.filter((d) => d.category === 'earning' || d.category === 'contractor').map((d, i) => (
                  <tr key={i}>
                    <td>{d.description}{d.hours ? <span className="small muted"> · {d.hours} hrs{d.rate_cents ? ` @ ${formatMoney(d.rate_cents)}/hr` : ''}</span> : null}</td>
                    <td className="num"><Money cents={d.amount_cents} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Gross pay</td><td className="num"><Money cents={s.gross_cents} /></td></tr>
                {s.reimbursement_cents > 0 && (
                  <tr>
                    <td>
                      Reimbursements (non-taxable, not part of gross)
                      {s.earnings_detail.filter((d) => d.category === 'reimbursement').map((d, i) => (
                        <div key={i} className="small muted" style={{ fontWeight: 400 }}>{d.description}</div>
                      ))}
                    </td>
                    <td className="num"><Money cents={s.reimbursement_cents} /></td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
          {!contractor && (
            <>
              <h3 style={{ marginTop: '1rem' }}>Withholding and deductions</h3>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {withholding.map(([label, v]) => (
                      <tr key={label}><td>{label}</td><td className="num">−<Money cents={v} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="small muted" style={{ marginTop: '1rem' }}>
            Withholding and net pay are the payroll provider’s final figures. Published {formatDateTime(s.published_at)}.
          </p>
        </div>
      </Card>
    </>
  );
}
