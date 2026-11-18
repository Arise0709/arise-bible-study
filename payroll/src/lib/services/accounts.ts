import type { Queryable } from '../db';
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newTotpSecret,
  passwordProblem,
  randomToken,
  sha256,
  verifyPassword,
  verifyTotp,
} from '../crypto';
import { type Actor, UserError, audit, requireRole } from './core';

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
  employee_id: string | null;
  status: 'invited' | 'active' | 'disabled';
  password_hash: string | null;
  invite_token_hash: string | null;
  invite_expires_at: string | null;
  mfa_secret_enc: string | null;
  mfa_enabled_at: string | null;
  mfa_last_step: number | null;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
};

export const SESSION_IDLE_MINUTES = 60;
export const SESSION_MAX_HOURS = 12;
const INVITE_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function needsMfa(roles: string[]): boolean {
  return roles.includes('admin') || roles.includes('approver');
}

export function toActor(u: Pick<UserRow, 'id' | 'email' | 'display_name' | 'roles' | 'employee_id'>): Actor {
  return { id: u.id, email: u.email, display_name: u.display_name, roles: u.roles, employee_id: u.employee_id };
}

async function createSession(tx: Queryable, userId: string, mfaVerified: boolean): Promise<string> {
  const token = randomToken();
  await tx.query(
    `insert into payroll.sessions (token_hash, user_id, mfa_verified, expires_at)
     values ($1, $2, $3, now() + make_interval(hours => $4::int))`,
    [sha256(token), userId, mfaVerified, SESSION_MAX_HOURS],
  );
  return token;
}

// All functions below that take no Actor must be called with the SYSTEM database context.

export type SignInResult =
  | { ok: true; token: string; user: UserRow; next: 'done' | 'mfa_verify' | 'mfa_enroll' }
  | { ok: false; message: string };

/**
 * Failures RETURN rather than throw, so the failed-attempt counter is committed
 * (a thrown error would roll the transaction back and lose it).
 */
export async function signIn(tx: Queryable, emailRaw: string, password: string): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase();
  const generic = { ok: false as const, message: 'That email and password did not match an active account.' };
  const user = await tx.one<UserRow>('select * from payroll.users where email = $1', [email]);
  if (!user) {
    verifyPassword(password, null);
    return generic;
  }
  if (user.locked_until && new Date(user.locked_until) > new Date())
    return { ok: false, message: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes, or ask a payroll admin.` };
  if (user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    await tx.query(
      `update payroll.users set failed_logins = $2::int,
         locked_until = case when $2::int >= $3::int then now() + make_interval(mins => $4::int) else locked_until end where id = $1`,
      [user.id, failed, MAX_FAILED, LOCK_MINUTES],
    );
    await audit(tx, null, 'auth.sign_in_failed', 'user', user.id, `Failed sign-in for ${email}${failed >= MAX_FAILED ? ' (account locked)' : ''}`);
    return generic;
  }
  await tx.query('update payroll.users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1', [user.id]);
  const mfa = needsMfa(user.roles);
  const token = await createSession(tx, user.id, !mfa);
  await audit(tx, toActor(user), 'auth.signed_in', 'user', user.id, `Signed in${mfa ? ' (MFA pending)' : ''}`);
  return { ok: true, token, user, next: !mfa ? 'done' : user.mfa_enabled_at ? 'mfa_verify' : 'mfa_enroll' };
}

export type SessionInfo = { user: UserRow; mfaVerified: boolean; tokenHash: string };

export async function lookupSession(tx: Queryable, token: string): Promise<SessionInfo | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = sha256(token);
  const row = await tx.one<{ user_id: string; mfa_verified: boolean; last_seen_at: string; expires_at: string }>(
    'select user_id, mfa_verified, last_seen_at, expires_at from payroll.sessions where token_hash = $1',
    [tokenHash],
  );
  if (!row) return null;
  const idleLimit = Date.now() - SESSION_IDLE_MINUTES * 60_000;
  if (new Date(row.expires_at).getTime() < Date.now() || new Date(row.last_seen_at).getTime() < idleLimit) {
    await tx.query('delete from payroll.sessions where token_hash = $1', [tokenHash]);
    return null;
  }
  const user = await tx.one<UserRow>('select * from payroll.users where id = $1', [row.user_id]);
  if (!user || user.status !== 'active') return null;
  await tx.query('update payroll.sessions set last_seen_at = now() where token_hash = $1', [tokenHash]);
  return { user, mfaVerified: row.mfa_verified, tokenHash };
}

export async function signOut(tx: Queryable, token: string): Promise<void> {
  await tx.query('delete from payroll.sessions where token_hash = $1', [sha256(token)]);
}

/** Start MFA enrollment: create (or reuse) an unconfirmed secret. Returns the plain secret to show once. */
export async function beginMfaEnrollment(tx: Queryable, session: SessionInfo): Promise<string> {
  if (session.user.mfa_enabled_at) throw new UserError('MFA is already set up for this account.');
  if (session.user.mfa_secret_enc) return decryptSecret(session.user.mfa_secret_enc);
  const secret = newTotpSecret();
  await tx.query('update payroll.users set mfa_secret_enc = $2 where id = $1', [session.user.id, encryptSecret(secret)]);
  return secret;
}

/** Returns an error message, or null on success. Returns instead of throwing so lockout counts persist. */
export async function verifyMfaCode(tx: Queryable, session: SessionInfo, code: string): Promise<string | null> {
  const u = session.user;
  if (!u.mfa_secret_enc) return 'Set up MFA first.';
  if (u.locked_until && new Date(u.locked_until) > new Date()) return 'Too many failed attempts. Try again later.';
  const step = verifyTotp(decryptSecret(u.mfa_secret_enc), code, u.mfa_last_step);
  if (step == null) {
    const failed = u.failed_logins + 1;
    await tx.query(
      `update payroll.users set failed_logins = $2::int,
         locked_until = case when $2::int >= $3::int then now() + make_interval(mins => $4::int) else locked_until end where id = $1`,
      [u.id, failed, MAX_FAILED, LOCK_MINUTES],
    );
    if (failed >= MAX_FAILED) await tx.query('delete from payroll.sessions where user_id = $1', [u.id]);
    await audit(tx, toActor(u), 'auth.mfa_failed', 'user', u.id, 'Incorrect MFA code');
    return 'That code did not work. Codes change every 30 seconds; use the newest one.';
  }
  const enrolling = !u.mfa_enabled_at;
  await tx.query(
    `update payroll.users set mfa_last_step = $2, failed_logins = 0, mfa_enabled_at = coalesce(mfa_enabled_at, now()) where id = $1`,
    [u.id, step],
  );
  await tx.query('update payroll.sessions set mfa_verified = true where token_hash = $1', [session.tokenHash]);
  await audit(tx, toActor(u), enrolling ? 'auth.mfa_enrolled' : 'auth.mfa_verified', 'user', u.id, enrolling ? 'Set up MFA' : 'Verified MFA');
  return null;
}

// ---------------------------------------------------------------- invites

export async function getInvite(tx: Queryable, token: string): Promise<UserRow | null> {
  if (!token || token.length > 100) return null;
  const u = await tx.one<UserRow>(
    `select * from payroll.users where invite_token_hash = $1 and status = 'invited' and invite_expires_at > now()`,
    [sha256(token)],
  );
  return u;
}

export async function acceptInvite(tx: Queryable, token: string, password: string, confirm: string) {
  const u = await getInvite(tx, token);
  if (!u) throw new UserError('This invite link is invalid or has expired. Ask a payroll admin for a new one.');
  const problem = passwordProblem(password);
  if (problem) throw new UserError(problem);
  if (password !== confirm) throw new UserError('The two passwords do not match.');
  await tx.query(
    `update payroll.users set password_hash = $2, status = 'active', invite_token_hash = null, invite_expires_at = null,
       updated_at = now() where id = $1`,
    [u.id, hashPassword(password)],
  );
  await audit(tx, toActor(u), 'auth.invite_accepted', 'user', u.id, `${u.email} accepted their invite`);
  return signIn(tx, u.email, password);
}

const ROLE_SET = ['admin', 'approver', 'staff'];

export async function inviteUser(
  tx: Queryable,
  actor: Actor,
  input: { email: string; display_name: string; roles: string[]; employee_id: string | null },
): Promise<string> {
  requireRole(actor, 'admin');
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email address.');
  if (!input.display_name) throw new UserError('Enter a name.');
  const roles = input.roles.filter((r) => ROLE_SET.includes(r));
  if (!roles.length) throw new UserError('Choose at least one role.');
  if (roles.includes('staff') && !input.employee_id) throw new UserError('Link a staff record so this person can see their own pay statements.');
  const existing = await tx.one('select 1 from payroll.users where email = $1', [email]);
  if (existing) throw new UserError('Someone with that email already has an account.');
  if (input.employee_id) {
    const linked = await tx.one('select 1 from payroll.users where employee_id = $1', [input.employee_id]);
    if (linked) throw new UserError('That staff record is already linked to another account.');
  }
  const token = randomToken();
  const row = await tx.one<{ id: string }>(
    `insert into payroll.users (email, display_name, roles, employee_id, status, invite_token_hash, invite_expires_at, created_by)
     values ($1,$2,$3,$4,'invited',$5, now() + make_interval(days => $6::int), $7) returning id`,
    [email, input.display_name, roles, input.employee_id, sha256(token), INVITE_DAYS, actor.id],
  );
  await audit(tx, actor, 'user.invited', 'user', row!.id, `Invited ${email} as ${roles.join(', ')}`, { roles, employee_id: input.employee_id });
  return token;
}

export async function reissueInvite(tx: Queryable, actor: Actor, userId: string): Promise<string> {
  requireRole(actor, 'admin');
  const u = await tx.one<UserRow>('select * from payroll.users where id = $1', [userId]);
  if (!u || u.status !== 'invited') throw new UserError('Only pending invites can be re-sent.');
  const token = randomToken();
  await tx.query(
    `update payroll.users set invite_token_hash = $2, invite_expires_at = now() + make_interval(days => $3::int) where id = $1`,
    [userId, sha256(token), INVITE_DAYS],
  );
  await audit(tx, actor, 'user.invite_reissued', 'user', userId, `New invite link for ${u.email}`);
  return token;
}

export async function updateUserAccess(
  tx: Queryable,
  actor: Actor,
  userId: string,
  input: { roles: string[]; status: 'active' | 'disabled' | 'invited' },
): Promise<void> {
  requireRole(actor, 'admin');
  const u = await tx.one<UserRow>('select * from payroll.users where id = $1', [userId]);
  if (!u) throw new UserError('Account not found.');
  const roles = input.roles.filter((r) => ROLE_SET.includes(r));
  if (!roles.length) throw new UserError('Choose at least one role.');
  if (roles.includes('staff') && !u.employee_id) throw new UserError('The staff role needs a linked staff record.');
  if (u.id === actor.id && (!roles.includes('admin') || input.status === 'disabled'))
    throw new UserError('You cannot remove your own admin access. Ask another admin.');
  const status = u.status === 'invited' ? 'invited' : input.status;
  await tx.query('update payroll.users set roles = $2, status = $3, updated_at = now() where id = $1', [userId, roles, status]);
  if (status === 'disabled' || roles.join() !== u.roles.join())
    await tx.query('delete from payroll.sessions where user_id = $1', [userId]);
  await audit(tx, actor, 'user.access_changed', 'user', userId, `Access for ${u.email}: roles ${roles.join(', ')}, ${status}`, {
    from: { roles: u.roles, status: u.status },
    to: { roles, status },
  });
}

export async function resetMfa(tx: Queryable, actor: Actor, userId: string): Promise<void> {
  requireRole(actor, 'admin');
  const u = await tx.one<UserRow>('select * from payroll.users where id = $1', [userId]);
  if (!u) throw new UserError('Account not found.');
  await tx.query(
    'update payroll.users set mfa_secret_enc = null, mfa_enabled_at = null, mfa_last_step = null where id = $1',
    [userId],
  );
  await tx.query('delete from payroll.sessions where user_id = $1', [userId]);
  await audit(tx, actor, 'user.mfa_reset', 'user', userId, `Reset MFA for ${u.email}; they must set it up again at next sign-in`);
}

export async function listUsers(tx: Queryable, actor: Actor) {
  requireRole(actor, 'admin');
  return tx.query<UserRow & { employee_name: string | null }>(
    `select u.*, e.first_name || ' ' || e.last_name as employee_name from payroll.users u
       left join payroll.employees e on e.id = u.employee_id order by u.status, u.display_name`,
  );
}
