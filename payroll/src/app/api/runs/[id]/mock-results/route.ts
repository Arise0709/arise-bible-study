import { userForApi } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { isDemoMode } from '@/lib/demo';
import { ctxFor } from '@/lib/services/core';
import { mockProviderResultsCsv } from '@/lib/services/provider';

/** DEMO ONLY: a fictional provider results file for an exported run. Disabled unless DEMO_MODE=true. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) return new Response('Not found', { status: 404 });
  const actor = await userForApi(['admin']);
  if (!actor) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const csv = await withCtx(ctxFor(actor), (tx) => mockProviderResultsCsv(tx, id));
  return new Response(`# DEMO ONLY - fictional provider results. Not tax calculations.\n${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="DEMO-provider-results-${id.slice(0, 8)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
