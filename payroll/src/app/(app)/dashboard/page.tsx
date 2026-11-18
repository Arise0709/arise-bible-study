import Link from 'next/link';
import { Card, Empty, Flash, Money, PageHeader, Stat, StatusBadge } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { ctxFor, hasRole } from '@/lib/services/core';
import { listRuns } from '@/lib/services/runs';
import { getSettings } from '@/lib/services/settings';
import { listEmployees, reviewFlags } from '@/lib/services/staff';
import { daysBetween, formatDate, nextPayday, periodContaining, scheduleLabel, todayISO } from '@/lib/schedule';

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin', 'approver']);
  const { settings, runs, emps } = await withCtx(ctxFor(actor), async (tx) => ({
    settings: await getSettings(tx),
    runs: await listRuns(tx, 12),
    emps: await listEmployees(tx),
  }));
  const today = todayISO();
  const current = periodContaining(settings.pay_schedule, today, settings.schedule_anchor_start, settings.payday_offset_days);
  const payday = nextPayday(settings.pay_schedule, today, settings.schedule_anchor_start, settings.payday_offset_days);
  const daysAway = daysBetween(today, payday.payDate);
  const drafts = runs.filter((r) => r.status === 'draft');
  const awaiting = runs.filter((r) => r.status === 'submitted');
  const toExport = runs.filter((r) => r.status === 'approved');
  const toReconcile = runs.filter((r) => r.status === 'exported');
  const flagged = emps.filter((e) => e.active && reviewFlags(e).length);
  const draftGross = drafts.reduce((s, r) => s + r.gross, 0);
  const draftContract = drafts.reduce((s, r) => s + r.contractor, 0);
  const isApprover = hasRole(actor, 'approver');

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${settings.org_name} · ${scheduleLabel(settings.pay_schedule)} payroll`}
        actions={hasRole(actor, 'admin') ? <Link className="btn" href="/runs/new">Start a pay run</Link> : undefined}
      />
      <Flash searchParams={searchParams} />
      <div className="stats">
        <Stat label="Next payday" value={formatDate(payday.payDate)} sub={daysAway === 0 ? 'Today' : `In ${daysAway} day${daysAway === 1 ? '' : 's'} · period ending ${formatDate(payday.end)}`} />
        <Stat label="Current pay period" value={`${formatDate(current.start).replace(/, \d{4}$/, '')} – ${formatDate(current.end)}`} sub={scheduleLabel(settings.pay_schedule)} />
        <Stat
          label="Draft payroll"
          value={<Money cents={draftGross} />}
          sub={drafts.length ? `${drafts.length} draft run${drafts.length === 1 ? '' : 's'} · contractors ${formatMoneyText(draftContract)}` : 'No drafts in progress'}
          href={drafts[0] ? `/runs/${drafts[0].id}` : undefined}
        />
        <Stat
          label="Awaiting approval"
          value={awaiting.length}
          sub={awaiting.length ? (isApprover ? 'Ready for your review' : 'With an approver') : 'Nothing waiting'}
          href={awaiting[0] ? `/runs/${awaiting[0].id}` : undefined}
        />
      </div>

      {(toExport.length > 0 || toReconcile.length > 0 || flagged.length > 0) && (
        <Card title="Needs attention" tone="warn">
          <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
            {toExport.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`}>Run #{r.run_number}</Link> is approved and ready to export.
              </li>
            ))}
            {toReconcile.map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`}>Run #{r.run_number}</Link> is exported. Record the provider batch and import results to reconcile.
              </li>
            ))}
            {flagged.map((e) => (
              <li key={e.id}>
                <Link href={`/staff/${e.id}`}>{e.first_name} {e.last_name}</Link>: {reviewFlags(e).join('; ')}
                {isApprover ? '' : ' (an approver must confirm)'}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Payroll history" actions={<Link href="/runs" className="small">All pay runs →</Link>}>
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
                  <th>Status</th>
                  <th className="num">Employee gross</th>
                  <th className="num">Contractors</th>
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
                    <td><StatusBadge status={r.status} /></td>
                    <td className="num"><Money cents={r.gross} /></td>
                    <td className="num"><Money cents={r.contractor} /></td>
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

function formatMoneyText(c: number) {
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
