import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SYSTEM, withCtx } from './db';
import { lookupSession, needsMfa, toActor, SESSION_MAX_HOURS, type SessionInfo } from './services/accounts';
import { type Actor, type Role, hasRole } from './services/core';

const COOKIE = 'arise_session';

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return withCtx(SYSTEM, (tx) => lookupSession(tx, token));
});

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.APP_URL ?? '').startsWith('https://'),
    path: '/',
    maxAge: SESSION_MAX_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/**
 * Gatekeeper for every page and action. Signed in, MFA done if required, and holding one of
 * the given roles, or the request is redirected away. Never trust the browser for any of this.
 */
export async function requireUser(roles?: Role[]): Promise<Actor> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (needsMfa(s.user.roles) && !s.mfaVerified) redirect(s.user.mfa_enabled_at ? '/mfa' : '/mfa/setup');
  const actor = toActor(s.user);
  if (roles && !hasRole(actor, ...roles)) redirect('/forbidden');
  return actor;
}

/** For route handlers: same checks, but returns null instead of redirecting. */
export async function userForApi(roles?: Role[]): Promise<Actor | null> {
  const s = await getSession();
  if (!s) return null;
  if (needsMfa(s.user.roles) && !s.mfaVerified) return null;
  const actor = toActor(s.user);
  if (roles && !hasRole(actor, ...roles)) return null;
  return actor;
}
