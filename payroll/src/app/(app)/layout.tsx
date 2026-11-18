import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/services/core';
import { isDemoMode } from '@/lib/demo';
import { signOutAction } from '../(auth)/actions';
import { NavLinks } from './NavLinks';

const ROLE_NAMES: Record<string, string> = { admin: 'Payroll Admin', approver: 'Payroll Approver', staff: 'Staff' };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  const office = hasRole(actor, 'admin', 'approver');
  const items = [
    ...(office
      ? [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/runs', label: 'Pay runs' },
          { href: '/staff', label: 'Staff' },
          { href: '/audit', label: 'Audit log' },
        ]
      : []),
    ...(hasRole(actor, 'admin') ? [{ href: '/settings', label: 'Settings' }] : []),
    ...(actor.employee_id ? [{ href: '/me', label: 'My pay' }] : []),
  ];
  return (
    <>
      {isDemoMode() && (
        <div className="demo-ribbon">DEMO MODE · fictional data · no money moves and nothing is filed</div>
      )}
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            <Logo />
            <span className="brand-app">Payroll</span>
          </Link>
          <div className="user-chip">
            <span>
              <strong>{actor.display_name}</strong>{' '}
              <span className="hide-sm">· {actor.roles.map((r) => ROLE_NAMES[r] ?? r).join(' + ')}</span>
            </span>
            <form action={signOutAction}>
              <button className="linkbtn" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        <div className="nav-inner">
          <NavLinks items={items} />
        </div>
      </nav>
      <main className="container">{children}</main>
      <p className="footer-note">
        Arise Payroll prepares and reviews payroll. Withholding, net pay, payments and tax filings are handled by
        the payroll provider. Social Security numbers, bank details and tax forms are never stored here.
      </p>
    </>
  );
}
