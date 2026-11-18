import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Badge, Card, Empty, Field, Flash, Money, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { rateOn } from '@/lib/calc';
import { formatDate, formatDateTime, todayISO } from '@/lib/schedule';
import { ctxFor, hasRole } from '@/lib/services/core';
import { fullName, getEmployee, getHousing, getRates, reviewFlags } from '@/lib/services/staff';
import * as A from '../../actions';
import { EmployeeFields } from '../EmployeeFields';

export default async function StaffDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin', 'approver']);
  const { id } = await params;
  const data = await withCtx(ctxFor(actor), async (tx) => {
    const e = await getEmployee(tx, id);
    if (!e) return null;
    return {
      e,
      rates: await getRates(tx, id),
      housing: await getHousing(tx, id),
      account: await tx.one<{ email: string; status: string; roles: string[] }>('select email, status, roles from payroll.users where employee_id = $1', [id]),
      confirmers: await tx.query<{ id: string; display_name: string }>(
        'select id, display_name from payroll.users where id = any($1::uuid[])',
        [[e.classification_confirmed_by, e.clergy_config_confirmed_by].filter(Boolean)],
      ),
      history: await tx.query<{ id: number; at: string; actor_email: string; summary: string }>(
        `select id, at, actor_email, summary from payroll.audit_events where entity_type = 'employee' and entity_id = $1 order by at desc, id desc limit 50`,
        [id],
      ),
    };
  });
  if (!data) notFound();
  const { e, rates, housing, account, confirmers, history } = data;
  const isAdmin = hasRole(actor, 'admin');
  const isApprover = hasRole(actor, 'approver');
  const today = todayISO();
  const current = rateOn(rates.filter((r) => r.pay_type === e.pay_type), today);
  const flags = reviewFlags(e);
  const who = (uid: string | null) => confirmers.find((c) => c.id === uid)?.display_name ?? '';
  const unit = e.pay_type === 'hourly' ? 'per hour' : e.pay_type === 'salary' ? 'per year' : 'per pay period';

  return (
    <>
      <PageHeader
        crumb={{ href: '/staff', label: 'Staff' }}
        title={fullName(e)}
        subtitle={`${e.employee_code} · ${e.job_title || 'No title'} · started ${formatDate(e.start_date)}`}
        actions={
          <>
            <Badge tone={e.worker_type === 'contractor' ? 'warn' : e.worker_type === 'clergy' ? 'info' : 'neutral'}>{e.worker_type}</Badge>
            {e.active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}
          </>
        }
      />
      <Flash searchParams={searchParams} />

      <Card title="Review flags" tone={flags.length ? 'warn' : 'ok'}>
        <div className="grid grid-2">
          <div>
            <h3>Worker classification</h3>
            {e.classification_confirmed ? (
              <p className="small">
                ✓ Confirmed by {who(e.classification_confirmed_by)} on {formatDateTime(e.classification_confirmed_at)}. <span className="muted">{e.classification_note}</span>
              </p>
            ) : (
              <p className="small notice notice-warn">Not confirmed. Is this person correctly classified as {e.worker_type === 'contractor' ? 'an independent contractor' : e.worker_type === 'clergy' ? 'a minister' : 'an employee'}?</p>
            )}
            <FlagForm id={e.id} which="classification" confirmed={e.classification_confirmed} isApprover={isApprover} canReopen={isAdmin || isApprover} />
          </div>
          {e.worker_type === 'clergy' && (
            <div>
              <h3>Clergy setup at the payroll provider</h3>
              {e.clergy_config_confirmed ? (
                <p className="small">
                  ✓ Confirmed by {who(e.clergy_config_confirmed_by)} on {formatDateTime(e.clergy_config_confirmed_at)}. <span className="muted">{e.clergy_config_note}</span>
                </p>
              ) : (
                <p className="small notice notice-warn">
                  Not confirmed. An approver must confirm how the provider handles this minister’s pay (FICA vs. self-employment tax, housing allowance exclusion,
                  voluntary withholding).
                </p>
              )}
              <FlagForm id={e.id} which="clergy" confirmed={e.clergy_config_confirmed} isApprover={isApprover} canReopen={isAdmin || isApprover} />
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="Pay rate history">
          <p>
            Current: {current ? <><Money cents={current.amount_cents} strong /> {unit}</> : <em>none in effect</em>}
          </p>
          {rates.length === 0 ? (
            <Empty>No rates.</Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Effective</th><th className="num">Amount</th><th>Reason</th></tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">
                        {formatDate(r.effective_date)}
                        {r.effective_date > today && <div><Badge tone="info">Upcoming</Badge></div>}
                      </td>
                      <td className="num"><Money cents={r.amount_cents} /></td>
                      <td className="small">{r.reason}<div className="muted">{r.created_by_name ? `Entered by ${r.created_by_name}` : ''}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdmin && (
            <form action={A.addRateAction} style={{ marginTop: '1rem' }}>
              <input type="hidden" name="id" value={e.id} />
              <h3>Record a rate change</h3>
              <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                <Field label={`New amount ($ ${unit})`}><input type="text" name="amount" inputMode="decimal" required /></Field>
                <Field label="Effective date"><input type="date" name="effective_date" required /></Field>
                <Field label="Reason" wide><input type="text" name="reason" placeholder="e.g. Annual review, board approved" /></Field>
              </div>
              <p className="small muted">History is never overwritten. Past pay runs keep the rate that was in effect.</p>
              <div className="form-actions"><ConfirmButton className="btn btn-sm">Add rate</ConfirmButton></div>
            </form>
          )}
        </Card>

        {e.worker_type === 'clergy' && (
          <Card title="Housing allowance designations">
            <p className="small muted">
              The designated amount is part of the minister’s total pay, approved in advance by the church’s governing body. It is shown as its own line on each run.
            </p>
            {housing.length === 0 ? (
              <Empty>No housing allowance designated.</Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Effective</th><th className="num">Annual</th><th>Approval</th></tr></thead>
                  <tbody>
                    {housing.map((h) => (
                      <tr key={h.id}>
                        <td className="nowrap">{formatDate(h.effective_date)}</td>
                        <td className="num"><Money cents={h.annual_amount_cents} /></td>
                        <td className="small">
                          {h.approval_reference}
                          <div className="muted">{[h.approved_by_body, h.approved_on && `approved ${formatDate(h.approved_on)}`].filter(Boolean).join(' · ')}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {isAdmin && (
              <form action={A.addHousingAction} style={{ marginTop: '1rem' }}>
                <input type="hidden" name="id" value={e.id} />
                <h3>Record an approved designation</h3>
                <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                  <Field label="Annual amount ($)"><input type="text" name="annual_amount" inputMode="decimal" required /></Field>
                  <Field label="Effective date"><input type="date" name="effective_date" required /></Field>
                  <Field label="Approval reference" hint="Resolution or minutes reference"><input type="text" name="approval_reference" required /></Field>
                  <Field label="Approved by"><input type="text" name="approved_by_body" placeholder="Church Board" /></Field>
                  <Field label="Approval date"><input type="date" name="approved_on" /></Field>
                </div>
                <div className="form-actions"><ConfirmButton className="btn btn-sm">Record designation</ConfirmButton></div>
              </form>
            )}
          </Card>
        )}

        <Card title="App account">
          {account ? (
            <p className="small">
              {account.email} · {account.status} · {account.roles.join(', ')}
            </p>
          ) : (
            <p className="small muted">No login yet. {isAdmin ? 'Invite them from Settings → People and access.' : ''}</p>
          )}
        </Card>
      </div>

      <Card title="Profile">
        {isAdmin ? (
          <form action={A.updateEmployeeAction}>
            <input type="hidden" name="id" value={e.id} />
            <EmployeeFields e={e} />
            <div className="form-actions"><ConfirmButton>Save changes</ConfirmButton></div>
          </form>
        ) : (
          <EmployeeFields e={e} readOnly />
        )}
      </Card>

      <Card title="Change history">
        {history.length === 0 ? (
          <Empty>No changes recorded.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="nowrap small">{formatDateTime(h.at)}</td>
                    <td className="small">{h.actor_email}</td>
                    <td>{h.summary}</td>
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

function FlagForm({ id, which, confirmed, isApprover, canReopen }: { id: string; which: 'classification' | 'clergy'; confirmed: boolean; isApprover: boolean; canReopen: boolean }) {
  if (confirmed)
    return canReopen ? (
      <form action={A.reopenFlagAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="which" value={which} />
        <ConfirmButton className="btn btn-secondary btn-sm" confirm="Reopen this review flag? Pay runs including this person cannot be approved until it is confirmed again.">
          Reopen review
        </ConfirmButton>
      </form>
    ) : null;
  if (!isApprover) return <p className="small muted">A payroll approver must confirm this.</p>;
  return (
    <form action={A.confirmFlagAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="which" value={which} />
      <Field label="How was this confirmed?">
        <input type="text" name="note" required placeholder={which === 'clergy' ? 'e.g. Provider set: minister, no FICA withholding, housing excluded' : 'e.g. Reviewed with CPA on 11/20'} />
      </Field>
      <div className="form-actions"><ConfirmButton className="btn btn-sm">Confirm</ConfirmButton></div>
    </form>
  );
}
