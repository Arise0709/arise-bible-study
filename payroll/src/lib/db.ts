import { getDriver, type Queryable } from './db-driver';

export type { Queryable } from './db-driver';

/** Who is acting. Drives the row level security policies in the database. */
export type DbContext = {
  userId: string | null;
  roles: string[]; // 'admin' | 'approver' | 'staff' | 'system'
  employeeId: string | null;
};

export const SYSTEM: DbContext = { userId: null, roles: ['system'], employeeId: null };

/**
 * Run fn inside one transaction as the limited payroll_app role, with the caller's identity set
 * for the row level security policies. All application data access goes through here.
 */
export async function withCtx<T>(ctx: DbContext, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const driver = await getDriver();
  return driver.transaction(async (tx) => {
    await tx.query(
      `select set_config('app.user_id', $1, true), set_config('app.roles', $2, true),
              set_config('app.employee_id', $3, true)`,
      [ctx.userId ?? '', ctx.roles.join(','), ctx.employeeId ?? ''],
    );
    await tx.query('set local role payroll_app');
    return fn(tx);
  });
}
