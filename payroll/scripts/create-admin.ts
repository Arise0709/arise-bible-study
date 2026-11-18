/**
 * Create the first admin account (accounts are otherwise invite-only).
 *   npm run create-admin -- you@arisechurch.org "Your Name"
 * Prints a one-time invite link, valid 7 days. Gives Admin + Approver roles; remove Approver later
 * in Settings once a separate approver is invited.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SYSTEM, withCtx } from '../src/lib/db';
import { getDriver } from '../src/lib/db-driver';
import { randomToken, sha256 } from '../src/lib/crypto';

for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(' ');
  if (!email || !name) throw new Error('Usage: npm run create-admin -- email@example.org "Full Name"');
  const token = randomToken();
  await withCtx(SYSTEM, async (tx) => {
    await tx.query(
      `insert into payroll.users (email, display_name, roles, status, invite_token_hash, invite_expires_at)
       values ($1, $2, '{admin,approver}', 'invited', $3, now() + interval '7 days')`,
      [email.toLowerCase(), name, sha256(token)],
    );
    await tx.query(
      `insert into payroll.audit_events (actor_email, action, entity_type, summary) values ('setup script', 'user.invited', 'user', $1)`,
      [`Created first admin invite for ${email.toLowerCase()}`],
    );
  });
  const base = (process.env.APP_URL || 'http://localhost:3100').replace(/\/$/, '');
  console.log(`Invite link (valid 7 days, share privately):\n${base}/invite/${token}`);
  await (await getDriver()).close();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
