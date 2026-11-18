import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Badge, Card, Empty, Field, Flash, Money, PageHeader, Stat, StatusBadge, Stepper } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { isDemoMode } from '@/lib/demo';
import { formatMoney } from '@/lib/money';
import { addDays, formatDate, formatDateTime, scheduleLabel, todayISO } from '@/lib/schedule';
import { ctxFor, hasRole } from '@/lib/services/core';
import { ISSUE_LABELS, RESULT_COLUMNS, getReconciliation, listExports } from '@/lib/services/provider';
import { ITEM_KINDS, getRunDetail } from '@/lib/services/runs';
import { getSettings } from '@/lib/services/settings';
import { fullName } from '@/lib/services/staff';
import { statementsForRun } from '@/lib/services/statements';
import * as A from '../../actions';

const WORKER_LABEL = { employee: 'Employee', clergy: 'Clergy', contractor: 'Contractor' } as const;

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireUser(['admin', 'approver']);
  const { id } = await params;
  const data = await withCtx(ctxFor(actor), async (tx) => {
    const detail = await getRunDetail(tx, id);
    if (!detail) return null;
    return {
      detail,
      settings: await getSettings(tx),
      exports: await listExports(tx, id),
      recon: await getReconciliation(tx, id),
      statements: detail.run.status === 'reconciled' || detail.run.status === 'voided' ? await statementsForRun(tx, id) : [],
      history: await tx.query<{ id: number; at: string; actor_email: string; summary: string }>(
        `select id, at, actor_email, summary from payroll.audit_events where entity_type = 'pay_run' and entity_id = $1 order by at desc, id desc limit 100`,
        [id],
      ),
    };
  });
  if (!data) notFound();
  const { detail, settings, exports, recon, statements, history } = data;
  const { run, people, totals } = detail;
  const isAdmin = hasRole(actor, 'admin');
  const isApprover = hasRole(actor, 'approver');
  const draft = run.status === 'draft';
  const canEdit = draft && isAdmin;
  const preparedBySelf = run.submitted_by === actor.id || run.created_by === actor.id;
  const hourly = detail.employees.filter((e) => e.pay_type === 'hourly');
  const pending = detail.time.filter((t) => t.status === 'pending');
  const empName = (eid: string) => {
    const e = detail.employees.find((x) => x.id === eid) ?? people.find((p) => p.employee.id === eid)?.employee;
    return e ? fullName(e) : 'Unknown';
  };
  const openIssues = recon?.items.filter((i) => i.status === 'open') ?? [];

  return (
    <>
      <PageHeader
        crumb={{ href: '/runs', label: 'Pay runs' }}
        title={`Pay run #${run.run_number}${run.kind === 'correction' ? ' (correction)' : ''}`}
        subtitle={
          <>
            {formatDate(run.period_start)} – {formatDate(run.period_end)} · Pay date <strong>{formatDate(run.pay_date)}</strong> ·{' '}
            {scheduleLabel(run.schedule)}
          </>
        }
        actions={<StatusBadge status={run.status} />}
      />
      <Flash searchParams={searchParams} />
      <Stepper status={run.status} />

      {/* ------------------------------------------------ banners */}
      {run.status === 'voided' && (
        <div className="notice notice-danger">
          <strong>Voided</strong> by {run.voided_by_name} on {formatDateTime(run.voided_at)}: {run.void_reason}. This record is kept for history.
        </div>
      )}
      {detail.correctsRun && (
        <div className="notice notice-info">
          This run corrects <Link href={`/runs/${detail.correctsRun.id}`}>run #{detail.correctsRun.run_number}</Link>. {run.notes}
        </div>
      )}
      {detail.correctedBy.length > 0 && (
        <div className="notice notice-info">
          Corrections:{' '}
          {detail.correctedBy.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ', '}
              <Link href={`/runs/${c.id}`}>run #{c.run_number}</Link> ({c.status})
            </span>
          ))}
        </div>
      )}
      {draft && run.return_reason && (
        <div className="notice notice-warn">
          <strong>Returned for changes</strong>
          {run.returned_by_name ? ` by ${run.returned_by_name}` : ''} on {formatDateTime(run.returned_at)}: {run.return_reason}
        </div>
      )}
      {run.notes && !detail.correctsRun && <p className="muted small">Note: {run.notes}</p>}
      {run.self_approved && (
        <div className="notice notice-warn">
          <strong>Same-person approval:</strong> {run.approved_by_name} both prepared and approved this run. Separate approval was turned off in
          Settings at the time. This is recorded in the audit log.
        </div>
      )}

      {/* ------------------------------------------------ totals */}
      <div className="stats">
        <Stat label="Employee gross pay" value={<Money cents={totals.gross} />} sub={`${totals.people} employee${totals.people === 1 ? '' : 's'} and clergy`} />
        <Stat label="Reimbursements" value={<Money cents={totals.reimbursements} />} sub="Non-taxable, paid with payroll" />
        <Stat label="Deductions entered" value={<Money cents={totals.deductions} />} sub="Before provider withholding" />
        <Stat label="Contractor payments" value={<Money cents={totals.contractor} />} sub={`${totals.contractors} contractor${totals.contractors === 1 ? '' : 's'} · kept separate`} />
      </div>
      <p className="muted small" style={{ marginTop: '-0.4rem' }}>
        Gross pay is calculated here. Tax withholding and net pay come from the payroll provider and are imported during reconciliation.
      </p>

      {/* ------------------------------------------------ review flags */}
      {detail.blockingFlags.length > 0 && !['exported', 'reconciled', 'voided'].includes(run.status) && (
        <Card title="Review flags" tone="warn">
          <p className="small">These must be confirmed by a payroll approver before this run can be approved.</p>
          {detail.blockingFlags.map((b) => (
            <div key={b.employee.id} style={{ marginTop: '0.75rem' }}>
              <strong>{fullName(b.employee)}</strong> <Badge tone="info">{WORKER_LABEL[b.employee.worker_type]}</Badge>
              {b.flags.map((f) => {
                const which = f.startsWith('Clergy') ? 'clergy' : 'classification';
                return (
                  <div key={f} className="notice notice-warn">
                    {f}
                    {isApprover ? (
                      <form action={A.confirmFlagAction} className="row" style={{ marginTop: '0.5rem' }}>
                        <input type="hidden" name="id" value={b.employee.id} />
                        <input type="hidden" name="which" value={which} />
                        <input type="hidden" name="_back" value={`/runs/${run.id}`} />
                        <input
                          type="text"
                          name="note"
                          required
                          placeholder={which === 'clergy' ? 'How the provider has this minister set up' : 'How and with whom this was confirmed'}
                          style={{ flex: 1, minWidth: 220 }}
                        />
                        <ConfirmButton className="btn btn-sm">Confirm</ConfirmButton>
                      </form>
                    ) : (
                      <div className="small">An approver must confirm this.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </Card>
      )}

      {/* ------------------------------------------------ workflow actions */}
      {run.status !== 'voided' && (
        <Card title="Next step">
          {draft && isAdmin && (
            <>
              <p className="small">
                Check the breakdown below. When everything is right, submit it for review. It will lock until an approver approves it or sends it back.
              </p>
              {pending.length > 0 && <div className="notice notice-warn">{pending.length} time entries still need approval before you can submit.</div>}
              <div className="form-actions">
                <form action={A.submitRunAction}>
                  <input type="hidden" name="run_id" value={run.id} />
                  <ConfirmButton confirm={`Submit run #${run.run_number} for review? Gross ${formatMoney(totals.gross)}, contractors ${formatMoney(totals.contractor)}.`}>
                    Submit for review
                  </ConfirmButton>
                </form>
                <details>
                  <summary className="btn btn-danger btn-sm">Void this draft</summary>
                  <form action={A.voidRunAction} className="row" style={{ marginTop: '0.5rem' }}>
                    <input type="hidden" name="run_id" value={run.id} />
                    <input type="text" name="reason" placeholder="Reason" required />
                    <ConfirmButton className="btn btn-danger btn-sm" confirm="Void this draft run?">Void draft</ConfirmButton>
                  </form>
                </details>
              </div>
            </>
          )}
          {draft && !isAdmin && <p className="small muted">The payroll admin is preparing this run.</p>}

          {run.status === 'submitted' && (
            <>
              <p className="small">
                Submitted by <strong>{run.submitted_by_name}</strong> on {formatDateTime(run.submitted_at)}.
              </p>
              {isApprover ? (
                <>
                  {preparedBySelf && settings.require_separate_approver && (
                    <div className="notice notice-warn">You prepared this run. Separate approval is required, so another approver must approve it.</div>
                  )}
                  {preparedBySelf && !settings.require_separate_approver && (
                    <div className="notice notice-warn">You prepared this run. If you approve it, the same-person approval is recorded.</div>
                  )}
                  <div className="grid grid-2">
                    <form action={A.approveRunAction}>
                      <input type="hidden" name="run_id" value={run.id} />
                      <Field label="Approval note (optional)">
                        <input type="text" name="comment" maxLength={300} />
                      </Field>
                      <div className="form-actions">
                        <ConfirmButton
                          className="btn btn-ok"
                          confirm={`Approve run #${run.run_number}? Gross ${formatMoney(totals.gross)}, reimbursements ${formatMoney(totals.reimbursements)}, contractors ${formatMoney(totals.contractor)}.`}
                        >
                          Approve pay run
                        </ConfirmButton>
                      </div>
                    </form>
                    <form action={A.returnRunAction}>
                      <input type="hidden" name="run_id" value={run.id} />
                      <Field label="Return with a reason">
                        <input type="text" name="reason" required placeholder="What needs to change?" />
                      </Field>
                      <div className="form-actions">
                        <ConfirmButton className="btn btn-secondary">Return to admin</ConfirmButton>
                      </div>
                    </form>
                  </div>
                </>
              ) : (
                <p className="small muted">Waiting for a payroll approver.</p>
              )}
              {isAdmin && <ReopenForm runId={run.id} label="Pull back to draft" />}
            </>
          )}

          {run.status === 'approved' && (
            <>
              <p className="small">
                Approved by <strong>{run.approved_by_name}</strong> on {formatDateTime(run.approved_at)}.
              </p>
              {isAdmin ? (
                <>
                  <div className="form-actions">
                    <form action={A.exportRunAction}>
                      <input type="hidden" name="run_id" value={run.id} />
                      <ConfirmButton confirm="Create the review CSV for the payroll provider? The run will lock as exported; later changes need a correction run.">
                        Export review CSV
                      </ConfirmButton>
                    </form>
                  </div>
                  <ReopenForm runId={run.id} label="Needs changes? Reopen as draft (requires new approval)" />
                </>
              ) : (
                <p className="small muted">A payroll admin will export it for the provider.</p>
              )}
            </>
          )}

          {run.status === 'exported' && (
            <p className="small">
              Exported. Enter the payroll in your provider using the review CSV, record the provider’s batch reference, then import the provider’s results
              below to reconcile.
            </p>
          )}

          {run.status === 'reconciled' && (
            <p className="small">
              Reconciled by <strong>{run.reconciled_by_name}</strong> on {formatDateTime(run.reconciled_at)} against provider batch{' '}
              <strong>{run.provider_batch_ref}</strong>. {statements.length} pay statements are published to staff.
            </p>
          )}

          {isAdmin && (run.status === 'exported' || run.status === 'reconciled') && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary className="btn btn-secondary btn-sm">Correct or void this run</summary>
              <div className="grid grid-2" style={{ marginTop: '0.75rem' }}>
                <form action={A.correctionAction}>
                  <input type="hidden" name="run_id" value={run.id} />
                  <h3>Start a correction run</h3>
                  <p className="small muted">
                    Copies this run’s hours and line items into a new draft linked to this one. Adjust it to match what the provider needs (full replacement or
                    difference only), then send it through review again. This run stays as it is.
                  </p>
                  <div className="form-grid">
                    <Field label="What is being corrected?">
                      <input type="text" name="reason" required />
                    </Field>
                    <Field label="Correction pay date">
                      <input type="date" name="pay_date" defaultValue={addDays(todayISO(), 3)} required />
                    </Field>
                  </div>
                  <div className="form-actions">
                    <ConfirmButton className="btn btn-secondary btn-sm">Start correction run</ConfirmButton>
                  </div>
                </form>
                <form action={A.voidRunAction}>
                  <input type="hidden" name="run_id" value={run.id} />
                  <h3>Void this run</h3>
                  <p className="small muted">
                    Use only if the provider batch was cancelled or voided. The record and its exports are kept and marked void.
                  </p>
                  <Field label="Reason">
                    <input type="text" name="reason" required />
                  </Field>
                  <div className="form-actions">
                    <ConfirmButton className="btn btn-danger btn-sm" confirm="Void this run? This cannot be undone. The record is kept.">
                      Void run
                    </ConfirmButton>
                  </div>
                </form>
              </div>
            </details>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ breakdown */}
      <Card title="Breakdown by person" id="breakdown">
        {people.length === 0 ? (
          <Empty>No one is being paid in this run yet.</Empty>
        ) : (
          people.map((p) => (
            <details key={p.employee.id} className="person" open={p.warnings.length > 0 || people.length <= 4}>
              <summary>
                <span className="person-name">{fullName(p.employee)}</span>
                <Badge tone={p.employee.worker_type === 'contractor' ? 'warn' : p.employee.worker_type === 'clergy' ? 'info' : 'neutral'}>
                  {WORKER_LABEL[p.employee.worker_type]} · {p.employee.pay_type}
                </Badge>
                {p.flags.length > 0 && <Badge tone="warn">Review flag</Badge>}
                <span className="person-total">
                  <Money cents={p.employee.worker_type === 'contractor' ? p.totals.contractor : p.totals.gross} />
                </span>
              </summary>
              <div className="person-body">
                {p.warnings.map((w) => (
                  <div key={w} className="notice notice-warn small">{w}</div>
                ))}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="num">Hours</th>
                        <th className="num">Rate</th>
                        <th className="hide-sm">Rate effective</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            {l.description}
                            {l.category !== 'earning' && (
                              <div className="small muted">{l.category === 'reimbursement' ? 'Reimbursement' : l.category === 'deduction' ? 'Deduction' : 'Contractor payment'}</div>
                            )}
                          </td>
                          <td className="num">{l.hours ?? ''}</td>
                          <td className="num">
                            {l.rate_cents != null
                              ? l.line_type === 'regular' || l.line_type === 'overtime'
                                ? `${formatMoney(l.rate_cents)}/hr`
                                : `${formatMoney(l.rate_cents)}/yr`
                              : ''}
                          </td>
                          <td className="hide-sm small">{l.rate_effective_date ? formatDate(l.rate_effective_date) : ''}</td>
                          <td className="num">
                            {l.category === 'deduction' ? '−' : ''}
                            <Money cents={l.amount_cents} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      {p.employee.worker_type === 'contractor' ? (
                        <tr>
                          <td colSpan={4}>Contractor payment total</td>
                          <td className="num"><Money cents={p.totals.contractor} /></td>
                        </tr>
                      ) : (
                        <>
                          <tr>
                            <td colSpan={4}>Gross earnings</td>
                            <td className="num"><Money cents={p.totals.gross} /></td>
                          </tr>
                          {(p.totals.reimbursements > 0 || p.totals.deductions > 0) && (
                            <tr>
                              <td colSpan={4} className="small" style={{ fontWeight: 400 }}>
                                Plus reimbursements {formatMoney(p.totals.reimbursements)} · less deductions {formatMoney(p.totals.deductions)} · withholding set by provider
                              </td>
                              <td />
                            </tr>
                          )}
                        </>
                      )}
                    </tfoot>
                  </table>
                </div>
              </div>
            </details>
          ))
        )}
      </Card>

      {/* ------------------------------------------------ hours */}
      <Card title="Hours" id="hours" actions={canEdit && pending.length > 0 ? (
        <form action={A.approveHoursAction}>
          <input type="hidden" name="run_id" value={run.id} />
          <ConfirmButton className="btn btn-sm">Approve all {pending.length} pending</ConfirmButton>
        </form>
      ) : undefined}>
        {detail.time.length === 0 ? (
          <Empty>No hours entered.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Date</th>
                  <th className="num">Regular</th>
                  <th className="num">Overtime</th>
                  <th>Status</th>
                  <th className="hide-sm">Note</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {detail.time.map((t) => (
                  <tr key={t.id}>
                    <td>{empName(t.employee_id)}</td>
                    <td className="nowrap">{t.work_date ? formatDate(t.work_date) : 'Whole period'}</td>
                    <td className="num">{Number(t.regular_hours).toFixed(2)}</td>
                    <td className="num">{Number(t.overtime_hours).toFixed(2)}</td>
                    <td>
                      <Badge tone={t.status === 'approved' ? 'ok' : 'warn'}>{t.status === 'approved' ? 'Approved' : 'Pending'}</Badge>
                      {t.source === 'csv' && <span className="small muted"> CSV</span>}
                    </td>
                    <td className="hide-sm small">{t.note}</td>
                    {canEdit && (
                      <td className="nowrap">
                        {t.status === 'pending' && (
                          <form action={A.approveHoursAction} className="inline-form">
                            <input type="hidden" name="run_id" value={run.id} />
                            <input type="hidden" name="entry_id" value={t.id} />
                            <button className="btn-link" type="submit">Approve</button>
                          </form>
                        )}{' '}
                        <form action={A.deleteTimeAction} className="inline-form">
                          <input type="hidden" name="run_id" value={run.id} />
                          <input type="hidden" name="entry_id" value={t.id} />
                          <button className="btn-link" type="submit">Remove</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="grid grid-2" style={{ marginTop: '1rem' }}>
            <form action={A.addTimeAction}>
              <h3>Enter hours</h3>
              <input type="hidden" name="run_id" value={run.id} />
              <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                <Field label="Hourly staff member">
                  <select name="employee_id" required>
                    {hourly.map((e) => (
                      <option key={e.id} value={e.id}>{fullName(e)}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Work date" hint="Leave blank for a period total">
                  <input type="date" name="work_date" min={run.period_start} max={run.period_end} />
                </Field>
                <Field label="Regular hours">
                  <input type="text" name="regular_hours" inputMode="decimal" placeholder="8" />
                </Field>
                <Field label="Overtime hours">
                  <input type="text" name="overtime_hours" inputMode="decimal" placeholder="0" />
                </Field>
                <Field label="Note" wide>
                  <input type="text" name="note" maxLength={200} />
                </Field>
              </div>
              <label className="check" style={{ marginTop: '0.6rem' }}>
                <input type="checkbox" name="approved" defaultChecked /> These hours are approved by the supervisor
              </label>
              <div className="form-actions">
                <ConfirmButton className="btn btn-sm">Add hours</ConfirmButton>
              </div>
            </form>
            <form action={A.importTimeAction}>
              <h3>Upload hours (CSV)</h3>
              <input type="hidden" name="run_id" value={run.id} />
              <p className="small muted">
                Columns: <code>employee_code, work_date, regular_hours, overtime_hours, note</code>. Dates as YYYY-MM-DD. Uploaded hours come in as pending
                until you approve them. Nothing imports if any row has a problem.
              </p>
              <input type="file" name="file" accept=".csv,text/csv" required />
              <div className="form-actions">
                <ConfirmButton className="btn btn-secondary btn-sm">Upload CSV</ConfirmButton>
              </div>
            </form>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ earnings items */}
      <Card title="Bonuses, reimbursements, deductions and contractor payments" id="earnings">
        {detail.items.length === 0 ? (
          <Empty>No line items.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id}>
                    <td>{empName(i.employee_id)}</td>
                    <td>{ITEM_KINDS.find((k) => k.value === i.kind)?.label.split(' (')[0]}</td>
                    <td>{i.description}</td>
                    <td className="num"><Money cents={i.amount_cents} /></td>
                    {canEdit && (
                      <td>
                        <form action={A.deleteItemAction} className="inline-form">
                          <input type="hidden" name="run_id" value={run.id} />
                          <input type="hidden" name="item_id" value={i.id} />
                          <button className="btn-link" type="submit">Remove</button>
                        </form>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <form action={A.addItemAction} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="run_id" value={run.id} />
            <div className="form-grid">
              <Field label="Staff member">
                <select name="employee_id" required>
                  {detail.employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {fullName(e)} ({WORKER_LABEL[e.worker_type]})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Type" hint="Contractors can only receive contractor payments.">
                <select name="kind" required>
                  {ITEM_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>{k.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Description">
                <input type="text" name="description" required maxLength={200} placeholder="e.g. Mileage, receipt #123" />
              </Field>
              <Field label="Amount ($)">
                <input type="text" name="amount" inputMode="decimal" required placeholder="0.00" />
              </Field>
            </div>
            <div className="form-actions">
              <ConfirmButton className="btn btn-sm">Add line item</ConfirmButton>
            </div>
          </form>
        )}
      </Card>

      {/* ------------------------------------------------ provider handoff */}
      {(exports.length > 0 || run.status === 'exported') && (
        <Card title="Payroll provider handoff" id="handoff">
          <div className="notice notice-info small">
            Arise Payroll does not send money or file taxes. Enter this payroll in your provider using the review file, then bring the provider’s results back here.
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th className="hide-sm">Layout</th>
                  <th className="num">Rows</th>
                  <th className="num">Total</th>
                  <th className="hide-sm">Created</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <a href={`/api/exports/${e.id}`} download>{e.filename}</a>
                      <div className="small muted">{e.kind === 'contractor' ? 'Contractor payments (separate from payroll)' : 'Employee and clergy payroll'}</div>
                    </td>
                    <td className="hide-sm">{e.profile_name}</td>
                    <td className="num">{e.row_count}</td>
                    <td className="num"><Money cents={e.total_cents} /></td>
                    <td className="hide-sm small">
                      {formatDateTime(e.created_at)} by {e.created_by_name}
                      <div className="mono" title="SHA-256 fingerprint of the file">{e.sha256.slice(0, 16)}…</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '1rem' }}>
            <h3>Provider batch reference</h3>
            {run.provider_batch_ref ? (
              <p>
                <strong className="mono">{run.provider_batch_ref}</strong>{' '}
                <span className="small muted">recorded {formatDateTime(run.provider_batch_recorded_at)}</span>
              </p>
            ) : (
              <p className="small muted">Not recorded yet.</p>
            )}
            {isAdmin && run.status === 'exported' && (
              <form action={A.batchRefAction} className="row">
                <input type="hidden" name="run_id" value={run.id} />
                <input type="text" name="ref" required placeholder="Batch or payroll ID from the provider" style={{ maxWidth: 320 }} defaultValue={run.provider_batch_ref ?? ''} />
                <ConfirmButton className="btn btn-sm btn-secondary">{run.provider_batch_ref ? 'Update' : 'Save'} reference</ConfirmButton>
              </form>
            )}
          </div>
        </Card>
      )}

      {/* ------------------------------------------------ reconcile */}
      {(run.status === 'exported' || recon) && (
        <Card title="Reconcile provider results" id="reconcile">
          {isAdmin && run.status === 'exported' && (
            <form action={A.importResultsAction} style={{ marginBottom: '1rem' }}>
              <input type="hidden" name="run_id" value={run.id} />
              <p className="small muted">
                Upload the provider’s final results as CSV. Columns: <code>{RESULT_COLUMNS.join(', ')}</code> (dollar amounts). A new upload replaces the
                previous one. Differences from the approved run are flagged below.
              </p>
              <div className="row">
                <input type="file" name="file" accept=".csv,text/csv" required />
                <ConfirmButton className="btn btn-sm">Import results</ConfirmButton>
                {isDemoMode() && (
                  <a className="btn btn-secondary btn-sm" href={`/api/runs/${run.id}/mock-results`} download>
                    Download mock provider results (demo)
                  </a>
                )}
              </div>
            </form>
          )}
          {!recon ? (
            <Empty>No provider results imported yet.</Empty>
          ) : (
            <>
              <p className="small">
                Using <strong>{recon.import.filename}</strong> ({recon.import.row_count} people), imported {formatDateTime(recon.import.imported_at)} by{' '}
                {recon.import.imported_by_name}.
              </p>
              {recon.items.length === 0 ? (
                <div className="notice notice-info">✓ Provider results match the approved run for every person.</div>
              ) : (
                <div style={{ marginBottom: '1rem' }}>
                  <h3>Differences</h3>
                  {recon.items.map((i) => (
                    <div key={i.id} className={`notice ${i.status === 'open' ? 'notice-danger' : 'notice-info'}`}>
                      <strong>{i.employee_code}</strong>: {ISSUE_LABELS[i.issue]}.{' '}
                      {i.expected_cents != null && <>Approved {formatMoney(i.expected_cents)}. </>}
                      {i.actual_cents != null && <>Provider {formatMoney(i.actual_cents)}. </>}
                      {i.status === 'acknowledged' ? (
                        <div className="small">Accepted by {i.resolved_by_name}: {i.note}</div>
                      ) : (
                        run.status === 'exported' && (
                          <form action={A.acknowledgeAction} className="row" style={{ marginTop: '0.4rem' }}>
                            <input type="hidden" name="run_id" value={run.id} />
                            <input type="hidden" name="item_id" value={i.id} />
                            <input type="text" name="note" required minLength={5} placeholder="Why this is correct" style={{ flex: 1, minWidth: 200 }} />
                            <ConfirmButton className="btn btn-sm btn-secondary">Accept difference</ConfirmButton>
                          </form>
                        )
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th className="num">Gross</th>
                      <th className="num">Reimb.</th>
                      <th className="num">Federal</th>
                      <th className="num">Alabama</th>
                      <th className="num">Soc. Sec.</th>
                      <th className="num">Medicare</th>
                      <th className="num">Other ded.</th>
                      <th className="num">Net pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.results.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.first_name ? `${r.first_name} ${r.last_name}` : <em>Unknown</em>}
                          <div className="small muted">{r.employee_code}</div>
                        </td>
                        <td className="num"><Money cents={r.gross_cents} /></td>
                        <td className="num"><Money cents={r.reimbursement_cents} /></td>
                        <td className="num"><Money cents={r.federal_withholding_cents} /></td>
                        <td className="num"><Money cents={r.state_withholding_cents} /></td>
                        <td className="num"><Money cents={r.social_security_cents} /></td>
                        <td className="num"><Money cents={r.medicare_cents} /></td>
                        <td className="num"><Money cents={r.other_deductions_cents} /></td>
                        <td className="num"><Money cents={r.net_pay_cents} strong /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isAdmin && run.status === 'exported' && (
                <div className="form-actions">
                  <form action={A.reconcileAction}>
                    <input type="hidden" name="run_id" value={run.id} />
                    <ConfirmButton
                      className="btn btn-ok"
                      confirm="Mark this run reconciled and publish pay statements to staff? Statements use the provider’s figures."
                    >
                      Mark reconciled and publish statements
                    </ConfirmButton>
                  </form>
                  {!run.provider_batch_ref && <span className="small muted">Record the provider batch reference first.</span>}
                  {openIssues.length > 0 && <span className="small muted">{openIssues.length} difference(s) still open.</span>}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {statements.length > 0 && (
        <Card title="Published pay statements">
          <ul>
            {statements.map((s) => (
              <li key={s.id}>
                <Link href={`/me/statements/${s.id}`}>
                  {s.first_name} {s.last_name}
                </Link>{' '}
                · net {formatMoney(s.net_pay_cents)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Run history">
        {history.length === 0 ? (
          <Empty>No activity yet.</Empty>
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

function ReopenForm({ runId, label }: { runId: string; label: string }) {
  return (
    <details style={{ marginTop: '0.75rem' }}>
      <summary className="btn btn-secondary btn-sm">{label}</summary>
      <form action={A.reopenRunAction} className="row" style={{ marginTop: '0.5rem' }}>
        <input type="hidden" name="run_id" value={runId} />
        <input type="text" name="reason" required placeholder="What needs to change?" style={{ flex: 1, minWidth: 220 }} />
        <ConfirmButton className="btn btn-secondary btn-sm" confirm="Reopen as a draft? Any approval is cleared and a new review is required.">
          Reopen as draft
        </ConfirmButton>
      </form>
    </details>
  );
}
