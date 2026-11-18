'use server';
import { redirect, unstable_rethrow } from 'next/navigation';
import { SYSTEM, withCtx } from '@/lib/db';
import { clearSessionCookie, getSession, getSessionToken, setSessionCookie } from '@/lib/auth';
import { acceptInvite, signIn, signOut, verifyMfaCode, type SignInResult } from '@/lib/services/accounts';
import { str } from '@/lib/services/core';
import { errorMessage } from '@/lib/action';

function q(path: string, params: Record<string, string>) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

async function finish(result: SignInResult, failPath: string, extra: Record<string, string> = {}): Promise<never> {
  if (!result.ok) redirect(q(failPath, { ...extra, error: result.message }));
  await setSessionCookie(result.token);
  redirect(result.next === 'mfa_verify' ? '/mfa' : result.next === 'mfa_enroll' ? '/mfa/setup' : '/');
}

export async function signInAction(formData: FormData) {
  const email = str(formData.get('email'));
  const password = typeof formData.get('password') === 'string' ? (formData.get('password') as string) : '';
  if (!email || !password) redirect(q('/login', { error: 'Enter your email and password.', email }));
  const result = await withCtx(SYSTEM, (tx) => signIn(tx, email, password));
  await finish(result, '/login', { email });
}

export async function verifyMfaAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect('/login');
  const back = session.user.mfa_enabled_at ? '/mfa' : '/mfa/setup';
  const err = await withCtx(SYSTEM, (tx) => verifyMfaCode(tx, session, str(formData.get('code'))));
  if (err) redirect(q(back, { error: err }));
  redirect('/');
}

export async function acceptInviteAction(formData: FormData) {
  const token = str(formData.get('token'));
  let result: SignInResult;
  try {
    result = await withCtx(SYSTEM, (tx) =>
      acceptInvite(tx, token, String(formData.get('password') ?? ''), String(formData.get('confirm') ?? '')),
    );
  } catch (e) {
    unstable_rethrow(e);
    redirect(q(`/invite/${encodeURIComponent(token)}`, { error: errorMessage(e) }));
  }
  await finish(result, '/login');
}

export async function signOutAction() {
  const token = await getSessionToken();
  if (token) await withCtx(SYSTEM, (tx) => signOut(tx, token));
  await clearSessionCookie();
  redirect('/login?notice=' + encodeURIComponent('You are signed out.'));
}
