import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Flash } from '@/components/ui';
import { getSession } from '@/lib/auth';
import { currentStep, totpAt } from '@/lib/crypto';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from '@/lib/demo';
import { signInAction } from '../actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await getSession();
  if (s?.mfaVerified) redirect('/');
  const sp = await searchParams;
  const demo = isDemoMode();
  const step = currentStep();
  return (
    <div className="auth-wrap">
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div className="auth-card">
          <Logo light={false} />
          <h1>Arise Payroll</h1>
          <p className="muted small">Authorized church staff only. Accounts are by invitation.</p>
          <div style={{ marginTop: '1rem' }}>
            <Flash searchParams={searchParams} />
          </div>
          <form action={signInAction}>
            <label className="field">
              <span className="field-label">Email</span>
              <input type="email" name="email" autoComplete="username" required defaultValue={sp.email ?? ''} />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input type="password" name="password" autoComplete="current-password" required />
            </label>
            <button className="btn" type="submit">Sign in</button>
          </form>
          <p className="muted small" style={{ marginTop: '1rem' }}>
            Forgot your password or lost your authenticator? Ask a payroll admin to reset your access.
          </p>
        </div>
        {demo && (
          <div className="demo-panel" aria-label="Demo accounts">
            <h2>Demo accounts (fictional)</h2>
            <p>
              Password for all: <code>{DEMO_PASSWORD}</code>. MFA codes refresh every 30 seconds.{' '}
              <a href="/login" className="btn btn-sm">Refresh codes</a>
            </p>
            <table>
              <tbody>
                {DEMO_ACCOUNTS.map((a) => (
                  <tr key={a.email}>
                    <td>
                      <code>{a.email}</code>
                      <div>{a.role}</div>
                    </td>
                    <td className="num" data-mfa-for={a.email}>{a.mfa ? <code>{totpAt(a.mfa, step)}</code> : 'no MFA'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small">Demo mode is on. Turn it off (DEMO_MODE=false) before entering real staff.</p>
          </div>
        )}
      </div>
    </div>
  );
}
