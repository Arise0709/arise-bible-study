// Database driver. No "server-only" import here so the setup scripts can use it too.
//
// DATABASE_URL set   -> node-postgres against Supabase (or any Postgres 15+)
// DATABASE_URL empty -> PGlite, an embedded Postgres stored in ./.data/pglite (demo / local)
import fs from 'node:fs';
import path from 'node:path';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

export interface Driver {
  kind: 'pglite' | 'postgres';
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Owner-level access for migrations only. */
  exec(sql: string): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

// Uniform value types across both drivers:
//   int8 -> number, numeric -> number, date -> 'YYYY-MM-DD', timestamptz -> ISO string
const OID = { int8: 20, numeric: 1700, date: 1082, timestamptz: 1184, timestamp: 1114 };

function parseTimestamp(v: string): string {
  let s = v.replace(' ', 'T');
  if (/[+-]\d\d$/.test(s)) s += ':00';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}
const parsers: Record<number, (v: string) => unknown> = {
  [OID.int8]: (v) => Number(v),
  [OID.numeric]: (v) => Number(v),
  [OID.date]: (v) => v,
  [OID.timestamptz]: parseTimestamp,
  [OID.timestamp]: parseTimestamp,
};

function wrap(q: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): Queryable {
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q(sql, params)).rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []) {
      const rows = (await q(sql, params)).rows as T[];
      return rows[0] ?? null;
    },
  };
}

export function pgliteDir(): string {
  return process.env.PGLITE_DIR || path.join(process.cwd(), '.data', 'pglite');
}

async function createPglite(): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = pgliteDir();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = new PGlite(dir, { parsers });
  await db.waitReady;
  return {
    kind: 'pglite',
    transaction: (fn) => db.transaction((tx) => fn(wrap((s, p) => tx.query(s, p)))),
    exec: async (sql) => {
      await db.exec(sql);
    },
    query: async <T,>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[],
    close: () => db.close(),
  };
}

async function createPg(url: string): Promise<Driver> {
  const pg = (await import('pg')).default;
  for (const [oid, fn] of Object.entries(parsers)) pg.types.setTypeParser(Number(oid), fn as (v: string) => unknown);
  // Local Postgres needs no TLS. For Supabase, download the project's CA certificate
  // (Project Settings > Database > SSL) and point DATABASE_CA_CERT at it so the server
  // certificate is verified. Without it the connection is still encrypted but unverified.
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const caPath = process.env.DATABASE_CA_CERT?.trim();
  const ssl = isLocal
    ? undefined
    : caPath
      ? { ca: fs.readFileSync(caPath, 'utf8'), rejectUnauthorized: true }
      : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl });
  return {
    kind: 'postgres',
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(wrap((s, p) => client.query(s, p as unknown[])));
        await client.query('commit');
        return result;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    query: async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    close: () => pool.end(),
  };
}

type G = typeof globalThis & { __arisePayrollDriver?: Promise<Driver> };

export function getDriver(): Promise<Driver> {
  const g = globalThis as G;
  if (!g.__arisePayrollDriver) {
    const url = process.env.DATABASE_URL?.trim();
    g.__arisePayrollDriver = (async () => {
      const driver = url ? await createPg(url) : await createPglite();
      // The embedded demo database migrates itself. Supabase is migrated explicitly
      // with `npm run db:migrate` so schema changes are always a deliberate step.
      if (driver.kind === 'pglite') {
        const { migrate } = await import('./migrate');
        await migrate(driver, { quiet: true });
      }
      return driver;
    })();
    g.__arisePayrollDriver.catch(() => {
      g.__arisePayrollDriver = undefined;
    });
  }
  return g.__arisePayrollDriver;
}
