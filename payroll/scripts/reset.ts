/**
 * Wipe and rebuild the DEMO database. Refuses to touch a database that has real accounts.
 *   Embedded demo database: deletes ./.data/pglite, then migrates and seeds.
 *   Postgres/Supabase: requires RESET_CONFIRM=wipe-demo-database and only demo accounts present.
 */
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getDriver, pgliteDir } from '../src/lib/db-driver';
import { DEMO_DOMAIN } from '../src/lib/demo';

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    fs.rmSync(pgliteDir(), { recursive: true, force: true });
    console.log('Removed the embedded demo database.');
  } else {
    if (process.env.RESET_CONFIRM !== 'wipe-demo-database')
      throw new Error('To reset a Postgres database set RESET_CONFIRM=wipe-demo-database. This deletes ALL payroll data.');
    const driver = await getDriver();
    const rows = await driver
      .query<{ email: string }>('select email from payroll.users')
      .catch(() => [] as { email: string }[]);
    if (rows.some((r) => !r.email.endsWith(`@${DEMO_DOMAIN}`)))
      throw new Error('Real accounts exist in this database. Refusing to reset.');
    await driver.exec('drop schema if exists payroll cascade; drop schema if exists payroll_meta cascade;');
    await driver.close();
    console.log('Dropped payroll schemas.');
  }
  execSync('npx tsx scripts/seed.ts', { stdio: 'inherit' });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
