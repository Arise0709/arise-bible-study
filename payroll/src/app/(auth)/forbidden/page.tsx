import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function Forbidden() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Logo light={false} />
        <h1>Not allowed</h1>
        <p className="muted">Your account does not have access to that page. If you think this is wrong, ask a payroll admin.</p>
        <p><Link href="/" className="btn">Go to my home page</Link></p>
      </div>
    </div>
  );
}
