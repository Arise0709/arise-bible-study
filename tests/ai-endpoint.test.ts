import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake the Anthropic SDK so no real (paid) call is made.
const create = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status = 500
  }
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static RateLimitError = RateLimitError
    static AuthenticationError = AuthenticationError
    beta = { messages: { create } }
  }
  return { default: Anthropic }
})

const { POST, GET } = await import('../api/assist')
const { __resetForTests } = await import('../api/_lib/guard')

const okResponse = {
  stop_reason: 'end_turn',
  model: 'claude-opus-5-5',
  usage: { input_tokens: 100, output_tokens: 50 },
  content: [{ type: 'text', text: JSON.stringify({ sections: [{ heading: 'H', body: 'B' }], citations: [], strongs: [], quotes: [], uncertainties: [] }) }],
}

function req(opts: { code?: string; ip?: string; origin?: string; body?: unknown; raw?: string; method?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: 'study.example', 'x-real-ip': opts.ip ?? '1.1.1.1' }
  if (opts.code !== undefined) headers['x-ai-access-code'] = opts.code
  if (opts.origin) headers.origin = opts.origin
  const body = opts.raw ?? JSON.stringify(opts.body ?? { task: 'questions', materials: 'PASSAGE John.3.16 For God so loved the world' })
  return new Request('https://study.example/api/assist', { method: opts.method ?? 'POST', headers, body: opts.method === 'GET' ? undefined : body })
}

describe('AI endpoint protection', () => {
  beforeEach(() => {
    __resetForTests()
    create.mockReset()
    create.mockResolvedValue(okResponse)
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.AI_ACCESS_CODE = 'correct horse'
    delete process.env.AI_LIMIT_PER_MINUTE
    delete process.env.AI_LIMIT_PER_DAY
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.KV_REST_API_URL
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('legitimate request with the right code works (existing workflow)', async () => {
    const r = await POST(req({ code: 'correct horse' }))
    expect(r.status).toBe(200)
    expect((await r.json()).result.sections[0].heading).toBe('H')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('is locked (fails closed) when no access code is configured', async () => {
    delete process.env.AI_ACCESS_CODE
    const r = await POST(req({ code: 'anything' }))
    expect(r.status).toBe(503)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong code without calling the AI', async () => {
    expect((await POST(req())).status).toBe(401)
    expect((await POST(req({ code: 'wrong' }))).status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })

  it('locks a client out after 10 wrong codes, even if it then sends the right one', async () => {
    for (let i = 0; i < 10; i++) await POST(req({ code: `guess-${i}`, ip: '9.9.9.9' }))
    const r = await POST(req({ code: 'correct horse', ip: '9.9.9.9' }))
    expect(r.status).toBe(429)
    expect(create).not.toHaveBeenCalled()
    // another client is unaffected
    expect((await POST(req({ code: 'correct horse', ip: '2.2.2.2' }))).status).toBe(200)
  })

  it('enforces the per-minute limit per client', async () => {
    process.env.AI_LIMIT_PER_MINUTE = '3'
    const codes = [] as number[]
    for (let i = 0; i < 4; i++) codes.push((await POST(req({ code: 'correct horse', ip: '3.3.3.3' }))).status)
    expect(codes).toEqual([200, 200, 200, 429])
    const r = await POST(req({ code: 'correct horse', ip: '3.3.3.3' }))
    expect(r.headers.get('retry-after')).toBe('60')
  })

  it('enforces the daily cap for the whole site', async () => {
    process.env.AI_LIMIT_PER_DAY = '2'
    expect((await POST(req({ code: 'correct horse', ip: '4.4.4.1' }))).status).toBe(200)
    expect((await POST(req({ code: 'correct horse', ip: '4.4.4.2' }))).status).toBe(200)
    expect((await POST(req({ code: 'correct horse', ip: '4.4.4.3' }))).status).toBe(429)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('rejects other websites (extra layer on top of the code)', async () => {
    expect((await POST(req({ code: 'correct horse', origin: 'https://evil.example' }))).status).toBe(403)
    expect((await POST(req({ code: 'correct horse', origin: 'https://study.example' }))).status).toBe(200)
  })

  it('rejects oversized and malformed requests', async () => {
    expect((await POST(req({ code: 'correct horse', raw: 'x'.repeat(200_001) }))).status).toBe(413)
    expect((await POST(req({ code: 'correct horse', raw: '{not json' }))).status).toBe(400)
    expect((await POST(req({ code: 'correct horse', body: { task: 'hack', materials: 'x' } }))).status).toBe(400)
  })

  it('logs usage counts but never the study text', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await POST(req({ code: 'correct horse', body: { task: 'questions', materials: 'SECRET SERMON NOTES' } }))
    const line = log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(line).toContain('ai_request')
    expect(line).not.toContain('SECRET SERMON NOTES')
  })

  it('status endpoint reports setup and checks a code', async () => {
    const plain = await (await GET(req({ method: 'GET' }))).json()
    expect(plain).toMatchObject({ configured: true, codeConfigured: true, limiter: 'memory' })
    expect(plain.codeValid).toBeUndefined()
    expect((await (await GET(req({ method: 'GET', code: 'correct horse' }))).json()).codeValid).toBe(true)
    expect((await (await GET(req({ method: 'GET', code: 'nope' }))).json()).codeValid).toBe(false)
  })

  it('uses the shared store when configured, and refuses if the store is down', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 }))
    expect((await POST(req({ code: 'correct horse' }))).status).toBe(200)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://redis.example/pipeline')
    fetchMock.mockImplementation(async () => new Response('down', { status: 500 }))
    expect((await POST(req({ code: 'correct horse' }))).status).toBe(503)
  })
})
