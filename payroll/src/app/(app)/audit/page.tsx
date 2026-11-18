import Link from 'next/link';
import { Card, Empty, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { formatDateTime } from '@/lib/schedule';
import { ctxFor } from '@/lib/services/core';

const FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'rate', label: 'Pay rates and housing' },
  { value: 'hours', label: 'Hours and earnings' },
  { value: 'run', label: 'Submissions, approvals, corrections' },
  { value: 'export', label: 'Exports and provider results' },
  { value: 'access', label: 'Sign-ins and access' },
];
const MATCH: Record<string, string> = {
  rate: "action like 'rate.%' or action like 'housing_allowance.%' or action like 'staff.%'",
  hours: "action like 'hours.%' or action like 'earnings.%'",
  run: "action like 'run.%' and action not in ('run.exported','run.batch_recorded','run.reconciled')",
  export: "action in ('run.exported','run.batch_recorded','run.reconciled') or action like 'export.%' or action like 'provider.%' or action like 'reconcile.%'",
  access: "action like 'auth.%' or action like 'user.%' or action like 'settings.%' or action like 'export_layout.%'",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin', 'approver']);
  const sp = await searchParams;
  const filter = sp.f && MATCH[sp.f] ? sp.f : '';
  const rows = await withCtx(ctxFor(actor), (tx) =>
    tx.query<{ id: number; at: string; actor_email: string; action: string; entity_type: string; entity_id: string | null; summary: string }>(
      `select id, at, actor_email, action, entity_type, entity_id, summary from payroll.audit_events
        ${filter ? `where ${MATCH[filter]}` : ''} order by at desc, id desc limit 300`,
    ),
  );
  const link = (r: (typeof rows)[number]) =>
    r.entity_type === 'pay_run' && r.entity_id ? `/runs/${r.entity_id}` : r.entity_type === 'employee' && r.entity_id ? `/staff/${r.entity_id}` : null;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every change to rates, hours, approvals, exports, corrections and access. Entries cannot be edited or deleted." />
      <div className="row" style={{ marginBottom: '1rem' }}>
        {FILTERS.map((f) => (
          <Link key={f.value} href={f.value ? `/audit?f=${f.value}` : '/audit'} className={`btn btn-sm ${filter === f.value ? '' : 'btn-secondary'}`}>
            {f.label}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <Empty>No entries.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>Who</th><th>What</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const href = link(r);
                  return (
                    <tr key={r.id}>
                      <td className="nowrap small">{formatDateTime(r.at)}</td>
                      <td className="small">{r.actor_email}</td>
                      <td>
                        {href ? <Link href={href}>{r.summary}</Link> : r.summary}
                        <div className="small muted mono">{r.action}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">Showing the latest 300 entries.</p>
      </Card>
    </>
  );
}
