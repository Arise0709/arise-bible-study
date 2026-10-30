/**
 * Abuse protection for the AI endpoint (files under api/_lib are not deployed as endpoints).
 *
 * - Access code: requests must carry the code set in AI_ACCESS_CODE. Without that variable the AI
 *   stays locked (fails closed). Codes are compared in constant time.
 * - Rate limits, enforced on the server:
 *     per client per minute (AI_LIMIT_PER_MINUTE, default 6)
 *     whole site per day   (AI_LIMIT_PER_DAY, default 60)
 *     wrong codes per client per hour (10), then a lockout
 *   Counters live in Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) are set,
 *   so every server instance shares them. Otherwise they fall back to this instance's memory.
 * - Same-site check on the Origin header as an extra layer only, never on its own.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export interface Limits {
  perMinute: number
  perDay: number
  failedPerHour: number
}

export function limits(): Limits {
  const n = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : d)
  return {
    perMinute: n(process.env.AI_LIMIT_PER_MINUTE, 6),
    perDay: n(process.env.AI_LIMIT_PER_DAY, 60),
    failedPerHour: 10,
  }
}

/* ---------------- counters ---------------- */

const memory = new Map<string, { count: number; resetAt: number }>()

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

export function limiterKind(): 'shared' | 'memory' {
  return redisConfig() ? 'shared' : 'memory'
}

/** Increments a fixed-window counter and returns the new count. */
async function hit(key: string, windowSec: number, peek = false): Promise<number> {
  const bucket = Math.floor(Date.now() / 1000 / windowSec)
  const k = `abs:${key}:${bucket}`
  const r = redisConfig()
  if (r) {
    const cmds = peek ? [['GET', k]] : [['INCR', k], ['EXPIRE', k, String(windowSec * 2)]]
    const res = await fetch(`${r.url}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${r.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(cmds),
    })
    if (!res.ok) throw new Error(`rate limit store returned ${res.status}`)
    const out = (await res.json()) as { result: unknown }[]
    return Number(out[0]?.result ?? 0)
  }
  const now = Date.now()
  const cur = memory.get(k)
  if (!cur || cur.resetAt < now) {
    if (peek) return 0
    memory.set(k, { count: 1, resetAt: now + windowSec * 1000 })
    if (memory.size > 5000) for (const [mk, mv] of memory) if (mv.resetAt < now) memory.delete(mk)
    return 1
  }
  if (!peek) cur.count++
  return cur.count
}

/** General-purpose limiter for other endpoints: true when `key` has gone over `max` in the window. */
export async function rateLimited(key: string, windowSec: number, max: number): Promise<boolean> {
  return (await hit(key, windowSec)) > max
}

export function __resetForTests() {
  memory.clear()
}

/* ---------------- helpers ---------------- */

export function clientId(req: Request): string {
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  // store a short hash, not the address itself
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

function sameCode(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** True when the Origin header (if any) is this same site. An extra layer, not authorization. */
export function sameSite(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser clients still need the access code and rate limits
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export type GuardResult = { ok: true } | { ok: false; status: number; error: string; retryAfter?: number }

/** Checks the access code and rate limits. Call before doing any paid work. */
export async function guard(req: Request): Promise<GuardResult> {
  const expected = process.env.AI_ACCESS_CODE
  if (!expected) return { ok: false, status: 503, error: 'The AI assistant is locked on this deployment. The site owner needs to set AI_ACCESS_CODE in the Vercel project settings.' }
  if (!sameSite(req)) return { ok: false, status: 403, error: 'Requests must come from this site.' }

  const L = limits()
  const who = clientId(req)
  try {
    if ((await hit(`fail:${who}`, 3600, true)) >= L.failedPerHour) {
      return { ok: false, status: 429, error: 'Too many wrong access codes. Try again in an hour.', retryAfter: 3600 }
    }
    const given = req.headers.get('x-ai-access-code') ?? ''
    if (!given || !sameCode(given, expected)) {
      await hit(`fail:${who}`, 3600)
      return { ok: false, status: 401, error: given ? 'That AI access code is not correct. Check it in Settings.' : 'Enter the AI access code in Settings to use the assistant.' }
    }
    if ((await hit(`min:${who}`, 60)) > L.perMinute) {
      return { ok: false, status: 429, error: 'Too many requests. Wait a minute and try again.', retryAfter: 60 }
    }
    if ((await hit('day:all', 86400)) > L.perDay) {
      return { ok: false, status: 429, error: "Today's AI limit for this site has been reached. It resets at midnight UTC.", retryAfter: 3600 }
    }
  } catch {
    // If the shared counter store is down, refuse rather than run without limits.
    return { ok: false, status: 503, error: 'The AI assistant is temporarily unavailable. Try again shortly.' }
  }
  return { ok: true }
}

/** Checks only the access code (for the Settings "Check code" button). Wrong codes still count toward lockout. */
export async function checkCode(req: Request): Promise<boolean> {
  const expected = process.env.AI_ACCESS_CODE
  const given = req.headers.get('x-ai-access-code') ?? ''
  if (!expected || !given) return false
  const who = clientId(req)
  if ((await hit(`fail:${who}`, 3600, true)) >= limits().failedPerHour) return false
  const ok = sameCode(given, expected)
  if (!ok) await hit(`fail:${who}`, 3600)
  return ok
}
