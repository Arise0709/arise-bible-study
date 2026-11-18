import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Flash } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { signOutAction, verifyMfaAction } from '../actions';

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.mfaVerified) redirect('/');
  if (!s.user.mfa_enabled_at) redirect('/mfa/setup');
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo light={false} />
        <h1>Two-step verification</h1>
        <p className="muted small">Enter the 6-digit code from your authenticator app for {s.user.email}.</p>
        <div style={{ marginTop: '1rem' }}>
          <Flash searchParams={searchParams} />
        </div>
        <form action={verifyMfaAction}>
          <label className="field">
            <span className="field-label">Authentication code</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
          </label>
          <button className="btn" type="submit">Verify</button>
        </form>
        <form action={signOutAction} style={{ marginTop: '0.5rem' }}>
          <button className="btn btn-secondary" type="submit">Use a different account</button>
        </form>
      </div>
    </div>
  );
}
