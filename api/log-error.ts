/**
 * Receives anonymous error reports from the app and writes them to the Vercel function logs.
 * Nothing is stored elsewhere. Reports are size-limited, field-limited, and rate-limited per client
 * (the client id is a short one-way hash, never the IP address itself).
 */
import { clientId, rateLimited, sameSite } from './_lib/guard.js'

const FIELDS: Record<string, number> = { message: 300, stack: 1500, path: 120, build: 40, browser: 20, kind: 12 }

export async function POST(request: Request) {
  if (!sameSite(request)) return new Response(null, { status: 403 })
  const raw = await request.text().catch(() => '')
  if (!raw || raw.length > 4000) return new Response(null, { status: 413 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  try {
    if (await rateLimited(`err:${clientId(request)}`, 3600, 30)) return new Response(null, { status: 429 })
  } catch {
    return new Response(null, { status: 503 })
  }
  const report: Record<string, unknown> = { event: 'client_error' }
  for (const [k, max] of Object.entries(FIELDS)) if (typeof body[k] === 'string') report[k] = (body[k] as string).slice(0, max)
  report.mobile = body.mobile === true
  console.error(JSON.stringify(report))
  return new Response(null, { status: 204 })
}
