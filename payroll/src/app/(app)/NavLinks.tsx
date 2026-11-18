'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={path === i.href || path.startsWith(i.href + '/') ? 'active' : ''}>
          {i.label}
        </Link>
      ))}
    </>
  );
}
