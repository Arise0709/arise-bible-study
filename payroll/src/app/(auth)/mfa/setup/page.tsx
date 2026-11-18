import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { Logo } from '@/components/Logo';
import { Flash } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { SYSTEM, withCtx } from '@/lib/db';
import { otpauthUrl } from '@/lib/crypto';
import { beginMfaEnrollment, needsMfa } from '@/lib/services/accounts';
import { signOutAction, verifyMfaAction } from '../../actions';

export default async function MfaSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.mfa_enabled_at) redirect(s.mfaVerified ? '/' : '/mfa');
  if (!needsMfa(s.user.roles)) redirect('/');
  const secret = await withCtx(SYSTEM, (tx) => beginMfaEnrollment(tx, s));
  const qr = await QRCode.toDataURL(otpauthUrl(secret, s.user.email), { margin: 1, width: 200 });
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo light={false} />
        <h1>Set up two-step verification</h1>
        <p className="muted small">
          Payroll admins and approvers must use an authenticator app (such as Google Authenticator, Microsoft
          Authenticator, 1Password or Authy). Scan this code, then enter the 6-digit code it shows.
        </p>
        <div style={{ marginTop: '1rem' }}>
          <Flash searchParams={searchParams} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code for your authenticator app" className="qr" />
        <details className="small">
          <summary>Can’t scan? Enter this key instead</summary>
          <p className="mono" data-testid="mfa-secret">{secret.match(/.{1,4}/g)?.join(' ')}</p>
        </details>
        <form action={verifyMfaAction}>
          <label className="field">
            <span className="field-label">Code from your app</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required />
          </label>
          <button className="btn" type="submit">Turn on verification</button>
        </form>
        <form action={signOutAction} style={{ marginTop: '0.5rem' }}>
          <button className="btn btn-secondary" type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
