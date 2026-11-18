import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { hasRole } from '@/lib/services/core';

export default async function Home() {
  const actor = await requireUser();
  redirect(hasRole(actor, 'admin', 'approver') ? '/dashboard' : '/me');
}
