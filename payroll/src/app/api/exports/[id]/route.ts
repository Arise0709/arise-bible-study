import { userForApi } from '@/lib/auth';
import { withCtx } from '@/lib/db';
import { ctxFor } from '@/lib/services/core';
import { getExportFile } from '@/lib/services/provider';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await userForApi(['admin', 'approver']);
  if (!actor) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const file = await withCtx(ctxFor(actor), (tx) => getExportFile(tx, actor, id));
  if (!file) return new Response('Not found', { status: 404 });
  return new Response(file.content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
