import type { Queryable, DbContext } from '../db';

/** A signed-in person (or the seed script) performing an action. */
export type Actor = {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
  employee_id: string | null;
};

export type Role = 'admin' | 'approver' | 'staff';

/** An error whose message is safe and useful to show the person who caused it. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function hasRole(actor: Actor, ...roles: Role[]): boolean {
  return roles.some((r) => actor.roles.includes(r));
}

/** Server-side permission check. Every service function calls this first. */
export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!hasRole(actor, ...roles)) {
    throw new UserError(`You do not have permission to do that. It requires the ${roles.join(' or ')} role.`);
  }
}

export function ctxFor(actor: Actor): DbContext {
  return { userId: actor.id, roles: actor.roles, employeeId: actor.employee_id };
}

export async function audit(
  tx: Queryable,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    `insert into payroll.audit_events (actor_user_id, actor_email, action, entity_type, entity_id, summary, details)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [actor?.id ?? null, actor?.email ?? 'system', action, entityType, entityId, summary, JSON.stringify(details)],
  );
}

export function str(v: FormDataEntryValue | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}
