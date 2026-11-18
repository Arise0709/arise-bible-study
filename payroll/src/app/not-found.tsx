import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="container">
      <div className="card">
        <h1>Not found</h1>
        <p className="muted">That page does not exist, or you do not have access to it.</p>
        <p><Link href="/">Go to your home page</Link></p>
      </div>
    </main>
  );
}
