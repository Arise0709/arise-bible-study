import 'server-only';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { withCtx } from './db';
import { requireUser } from './auth';
import { UserError, ctxFor, type Actor, type Role } from './services/core';
import type { Queryable } from './db';

/** Add ?notice= or ?error= to a path, keeping any #section anchor at the end where it belongs. */
export function withParam(path: string, key: string, value: string): string {
  const [beforeHash, hash = ''] = path.split('#');
  const [base, query = ''] = beforeHash.split('?');
  const p = new URLSearchParams(query);
  p.delete('error');
  p.delete('notice');
  p.set(key, value.slice(0, 600));
  return `${base}?${p.toString()}${hash ? `#${hash}` : ''}`;
}

export function errorMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  const pg = e as { code?: string; message?: string };
  if (pg?.code === 'P0001' && pg.message) return pg.message; // raised by our database guard triggers
  if (pg?.code === '23505') return 'That would create a duplicate record.';
  if (pg?.code === '42501') return 'The database refused that change (permission denied).';
  console.error(e);
  return 'Something went wrong and nothing was saved. Try again, and check the audit log if it keeps happening.';
}

/**
 * Standard server action wrapper: check the role, run the work in one transaction as that
 * person, then come back to `back` with a notice or an error message.
 */
export async function act<T>(
  opts: { roles: Role[]; back: string; success?: string | ((r: T) => string); next?: (r: T) => string },
  fn: (tx: Queryable, actor: Actor) => Promise<T>,
): Promise<never> {
  const actor = await requireUser(opts.roles);
  let dest: string;
  try {
    const result = await withCtx(ctxFor(actor), (tx) => fn(tx, actor));
    const msg = typeof opts.success === 'function' ? opts.success(result) : opts.success;
    const target = opts.next ? opts.next(result) : opts.back;
    dest = msg ? withParam(target, 'notice', msg) : target;
  } catch (e) {
    unstable_rethrow(e);
    dest = withParam(opts.back, 'error', errorMessage(e));
  }
  revalidatePath('/', 'layout');
  redirect(dest);
}

export function back(formData: FormData, fallback: string): string {
  const b = formData.get('_back');
  return typeof b === 'string' && b.startsWith('/') && !b.startsWith('//') ? b : fallback;
}
