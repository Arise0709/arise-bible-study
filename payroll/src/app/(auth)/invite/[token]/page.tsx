import { Logo } from '@/components/Logo';
import { Flash } from '@/components/ui';
import { SYSTEM, withCtx } from '@/lib/db';
import { getInvite, needsMfa } from '@/lib/services/accounts';
import { acceptInviteAction } from '../../actions';

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token } = await params;
  const invite = await withCtx(SYSTEM, (tx) => getInvite(tx, decodeURIComponent(token)));
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo light={false} />
        <h1>Welcome to Arise Payroll</h1>
        <div style={{ marginTop: '1rem' }}>
          <Flash searchParams={searchParams} />
        </div>
        {!invite ? (
          <p className="notice notice-danger">This invite link is invalid or has expired. Ask a payroll admin for a new one.</p>
        ) : (
          <>
            <p className="muted small">
              {invite.display_name}, choose a password for <strong>{invite.email}</strong>.
              {needsMfa(invite.roles) && ' Next you will set up two-step verification with an authenticator app.'}
            </p>
            <form action={acceptInviteAction}>
              <input type="hidden" name="token" value={decodeURIComponent(token)} />
              <label className="field">
                <span className="field-label">New password</span>
                <input type="password" name="password" autoComplete="new-password" minLength={12} required />
                <span className="hint">At least 12 characters, with letters and numbers.</span>
              </label>
              <label className="field">
                <span className="field-label">Confirm password</span>
                <input type="password" name="confirm" autoComplete="new-password" minLength={12} required />
              </label>
              <button className="btn" type="submit">Create my account</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
