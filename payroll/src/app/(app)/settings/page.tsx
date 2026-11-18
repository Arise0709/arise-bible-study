import Link from 'next/link';
import { cookies } from 'next/headers';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Badge, Card, Field, Flash, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { SCHEDULES, formatDateTime } from '@/lib/schedule';
import { ctxFor } from '@/lib/services/core';
import { listUsers } from '@/lib/services/accounts';
import { EXPORT_FIELDS, getExportProfile, getSettings } from '@/lib/services/settings';
import { listEmployees } from '@/lib/services/staff';
import * as A from '../actions';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireUser(['admin']);
  const { s, profile, users, emps } = await withCtx(ctxFor(actor), async (tx) => ({
    s: await getSettings(tx),
    profile: await getExportProfile(tx),
    users: await listUsers(tx, actor),
    emps: await listEmployees(tx),
  }));
  let invite: { email: string; link: string } | null = null;
  try {
    const raw = (await cookies()).get('arise_invite_link')?.value;
    invite = raw ? JSON.parse(raw) : null;
  } catch {
    invite = null;
  }
  const unlinked = emps.filter((e) => !users.some((u) => u.employee_id === e.id));
  const roleBoxes = (current: string[] = []) => (
    <div className="row">
      {[
        ['admin', 'Payroll Admin'],
        ['approver', 'Payroll Approver'],
        ['staff', 'Staff'],
      ].map(([v, l]) => (
        <label key={v} className="check">
          <input type="checkbox" name="roles" value={v} defaultChecked={current.includes(v)} /> {l}
        </label>
      ))}
    </div>
  );

  return (
    <>
      <PageHeader title="Settings" subtitle={<>Before entering real staff, work through the <Link href="/settings/checklist">confirmation checklist</Link>.</>} />
      <Flash searchParams={searchParams} />

      <Card title="Payroll rules">
        <form action={A.updateSettingsAction}>
          <div className="form-grid">
            <Field label="Organization"><input type="text" name="org_name" defaultValue={s.org_name} required /></Field>
            <Field label="Pay schedule">
              <select name="pay_schedule" defaultValue={s.pay_schedule}>
                {SCHEDULES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="First day of any pay period" hint="Anchors weekly and biweekly periods."><input type="date" name="schedule_anchor_start" defaultValue={s.schedule_anchor_start} required /></Field>
            <Field label="Payday (days after period ends)"><input type="number" name="payday_offset_days" min={0} max={30} defaultValue={s.payday_offset_days} required /></Field>
            <Field label="Overtime multiplier" hint="Confirm with your provider (FLSA: 1.5x over 40 hours/week)."><input type="text" name="overtime_multiplier" defaultValue={String(s.overtime_multiplier)} required /></Field>
          </div>
          <label className="check" style={{ marginTop: '0.75rem' }}>
            <input type="checkbox" name="require_separate_approver" defaultChecked={s.require_separate_approver} />
            <span>
              <strong>Require separate approval.</strong> The person who prepares a run cannot approve it. If you turn this off for a small team, any run
              prepared and approved by the same person is marked and recorded in the audit log.
            </span>
          </label>
          <div className="form-actions"><ConfirmButton>Save payroll rules</ConfirmButton></div>
        </form>
        <div className="notice notice-info small" style={{ marginTop: '1rem' }}>
          <strong>Locked in this version:</strong> live money movement <Badge tone="danger">Off</Badge> · tax filing <Badge tone="danger">Off</Badge>. These are
          enforced by the database and cannot be switched on from the app.
        </div>
      </Card>

      <Card title="Export layout for the payroll provider" id="export">
        <form action={A.updateExportProfileAction}>
          <div className="form-grid">
            <Field label="Layout name"><input type="text" name="name" defaultValue={profile.name} required /></Field>
            <Field label="Dates">
              <select name="date_format" defaultValue={profile.date_format}>
                <option value="YYYY-MM-DD">2026-11-27</option>
                <option value="MM/DD/YYYY">11/27/2026</option>
              </select>
            </Field>
            <Field label="Amounts">
              <select name="amount_format" defaultValue={profile.amount_format}>
                <option value="dollars">Dollars (1234.56)</option>
                <option value="cents">Cents (123456)</option>
              </select>
            </Field>
            <Field label="Columns, one per line: Header = field" wide hint="Match the header names to your provider’s import template.">
              <textarea name="columns" rows={14} defaultValue={profile.columns.map((c) => `${c.header} = ${c.field}`).join('\n')} />
            </Field>
          </div>
          <label className="check" style={{ marginTop: '0.5rem' }}>
            <input type="checkbox" name="include_banner" defaultChecked={profile.include_banner} /> Start the file with a “REVIEW COPY” line (turn off only if the provider’s
            import rejects it)
          </label>
          <details style={{ marginTop: '0.75rem' }}>
            <summary className="small">Available fields</summary>
            <ul className="small">
              {EXPORT_FIELDS.map((f) => <li key={f.field}><code>{f.field}</code> · {f.label}</li>)}
            </ul>
          </details>
          <div className="form-actions"><ConfirmButton>Save layout</ConfirmButton></div>
        </form>
      </Card>

      <Card title="People and access" id="users">
        {invite && (
          <div className="notice notice-info">
            Invite link for <strong>{invite.email}</strong> (valid 7 days, shown only here for 10 minutes). Send it privately:
            <div className="mono" data-testid="invite-link" style={{ marginTop: '0.4rem' }}>{invite.link}</div>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Person</th><th>Access</th><th className="hide-sm">MFA</th><th className="hide-sm">Last sign-in</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.display_name}
                    <div className="small muted">{u.email}{u.employee_name ? ` · staff record: ${u.employee_name}` : ''}</div>
                  </td>
                  <td>
                    <form action={A.updateAccessAction}>
                      <input type="hidden" name="user_id" value={u.id} />
                      {roleBoxes(u.roles)}
                      <div className="row" style={{ marginTop: '0.3rem' }}>
                        {u.status === 'invited' ? (
                          <Badge tone="info">Invite pending</Badge>
                        ) : (
                          <select name="status" defaultValue={u.status} style={{ maxWidth: 140, minHeight: 32, padding: '0.2rem 0.4rem' }}>
                            <option value="active">Active</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        )}
                        <ConfirmButton className="btn btn-sm btn-secondary">Save</ConfirmButton>
                      </div>
                    </form>
                  </td>
                  <td className="hide-sm small">
                    {u.mfa_enabled_at ? <Badge tone="ok">On</Badge> : u.roles.some((r) => r !== 'staff') ? <Badge tone="warn">Required at sign-in</Badge> : <span className="muted">Not required</span>}
                  </td>
                  <td className="hide-sm small">{formatDateTime(u.last_login_at) || '—'}</td>
                  <td className="nowrap">
                    {u.status === 'invited' && (
                      <form action={A.reissueInviteAction}><input type="hidden" name="user_id" value={u.id} /><button className="btn-link small" type="submit">New invite link</button></form>
                    )}
                    {u.mfa_enabled_at && (
                      <form action={A.resetMfaAction}>
                        <input type="hidden" name="user_id" value={u.id} />
                        <ConfirmButton className="btn-link small" confirm={`Reset MFA for ${u.email}? They will set it up again at next sign-in.`}>Reset MFA</ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={A.inviteUserAction} style={{ marginTop: '1.25rem' }}>
          <h3>Invite someone</h3>
          <p className="small muted">Sign-in is invite-only. Admins and approvers must set up an authenticator app (MFA) on first sign-in.</p>
          <div className="form-grid" style={{ marginTop: '0.5rem' }}>
            <Field label="Name"><input type="text" name="display_name" required /></Field>
            <Field label="Email"><input type="email" name="email" required /></Field>
            <Field label="Staff record (for the Staff role)">
              <select name="employee_id" defaultValue="">
                <option value="">None</option>
                {unlinked.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} ({e.employee_code})</option>)}
              </select>
            </Field>
            <Field label="Roles" wide>{roleBoxes(['staff'])}</Field>
          </div>
          <div className="form-actions"><ConfirmButton>Create invite</ConfirmButton></div>
        </form>
      </Card>
    </>
  );
}
