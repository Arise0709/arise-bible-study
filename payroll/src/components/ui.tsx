import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatMoney } from '@/lib/money';
import { STATUS_STEPS, type RunStatus } from '@/lib/services/runs';

export function PageHeader({ title, subtitle, actions, crumb }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumb?: { href: string; label: string } }) {
  return (
    <div className="page-header">
      <div>
        {crumb && (
          <Link href={crumb.href} className="crumb">
            ← {crumb.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, id, tone }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; tone?: 'warn' | 'danger' | 'ok' }) {
  return (
    <section className={`card${tone ? ` card-${tone}` : ''}`} id={id}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, href }: { label: string; value: ReactNode; sub?: ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="stat stat-link">
      {inner}
    </Link>
  ) : (
    <div className="stat">{inner}</div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted for review',
  approved: 'Approved',
  exported: 'Exported',
  reconciled: 'Reconciled',
  voided: 'Voided',
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'danger' | 'ok' | 'info' }) {
  return <span className={`badge badge-tone-${tone}`}>{children}</span>;
}

export function Money({ cents, strong }: { cents: number | null | undefined; strong?: boolean }) {
  const s = formatMoney(cents ?? 0);
  return <span className={`money${strong ? ' strong' : ''}`}>{s}</span>;
}

export function Stepper({ status }: { status: RunStatus }) {
  // A reconciled run is finished: every step shows as done.
  const idx = status === 'reconciled' ? STATUS_STEPS.length : STATUS_STEPS.findIndex((s) => s.status === status);
  return (
    <ol className={`stepper${status === 'voided' ? ' stepper-voided' : ''}`} aria-label="Pay run progress">
      {STATUS_STEPS.map((s, i) => (
        <li key={s.status} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          <span className="dot">{i < idx ? '✓' : i + 1}</span>
          <span className="step-label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export async function Flash({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? sp.error : null;
  const notice = typeof sp.notice === 'string' ? sp.notice : null;
  if (!error && !notice) return null;
  return (
    <div className={`flash ${error ? 'flash-error' : 'flash-ok'}`} role={error ? 'alert' : 'status'}>
      {error ?? notice}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function Back({ to }: { to: string }) {
  return <input type="hidden" name="_back" value={to} />;
}
