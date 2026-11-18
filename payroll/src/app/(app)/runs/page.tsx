import Link from 'next/link';
import { Card, Empty, Flash, Money, PageHeader, StatusBadge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { ctxFor, hasRole } from '@/lib/services/core';
import { listRuns } from '@/lib/services/runs';
import { formatDate, scheduleLabel } from '@/lib/schedule';

export default async function RunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin', 'approver']);
  const runs = await withCtx(ctxFor(actor), (tx) => listRuns(tx, 200));
  return (
    <>
      <PageHeader
        title="Pay runs"
        subtitle="Draft → Submitted for review → Approved → Exported → Reconciled"
        actions={hasRole(actor, 'admin') ? <Link className="btn" href="/runs/new">Start a pay run</Link> : undefined}
      />
      <Flash searchParams={searchParams} />
      <Card>
        {runs.length === 0 ? (
          <Empty>No pay runs yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Period</th>
                  <th>Pay date</th>
                  <th className="hide-sm">Schedule</th>
                  <th>Status</th>
                  <th className="num">Employee gross</th>
                  <th className="num">Contractors</th>
                  <th className="hide-sm">Prepared / approved</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/runs/${r.id}`}>#{r.run_number}</Link>
                      {r.kind === 'correction' && <div className="small muted">Correction</div>}
                    </td>
                    <td className="nowrap">{formatDate(r.period_start)} – {formatDate(r.period_end)}</td>
                    <td className="nowrap">{formatDate(r.pay_date)}</td>
                    <td className="hide-sm">{scheduleLabel(r.schedule).split(' (')[0]}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num"><Money cents={r.gross} /></td>
                    <td className="num"><Money cents={r.contractor} /></td>
                    <td className="hide-sm small">
                      {r.created_by_name ?? '—'} / {r.approved_by_name ?? '—'}
                      {r.self_approved && <div className="badge badge-tone-warn">Same person</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
