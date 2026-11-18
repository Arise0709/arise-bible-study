import fs from 'node:fs';
import path from 'node:path';
import type { Driver } from './db-driver';

export function migrationsDir(): string {
  return path.join(process.cwd(), 'supabase', 'migrations');
}

/** Apply any SQL files in supabase/migrations that have not run yet, in name order. */
export async function migrate(driver: Driver, opts: { quiet?: boolean } = {}): Promise<string[]> {
  await driver.exec(`
    create schema if not exists payroll_meta;
    revoke all on schema payroll_meta from public;
    create table if not exists payroll_meta.migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );`);
  const done = new Set(
    (await driver.query<{ name: string }>('select name from payroll_meta.migrations')).map((r) => r.name),
  );
  const files = fs
    .readdirSync(migrationsDir())
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir(), file), 'utf8');
    await driver.exec(`begin;\n${sql}\n;insert into payroll_meta.migrations(name) values ('${file.replace(/'/g, "''")}');\ncommit;`);
    applied.push(file);
    if (!opts.quiet) console.log(`applied ${file}`);
  }
  if (!opts.quiet && applied.length === 0) console.log('database is up to date');
  return applied;
}
