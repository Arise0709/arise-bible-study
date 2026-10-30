import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scrub, scrubPath } from '../src/lib/errorReport'
import { POST } from '../api/log-error'
import { __resetForTests } from '../api/_lib/guard'

describe('error report scrubbing', () => {
  it('removes quoted text, emails, ids, long numbers, and URL query strings', () => {
    const out = scrub(
      'Cannot read "God so loved the world that he gave" for joey@example.com at https://x.app/sermons/abc?q=secret id 3f2a9c1e-1111-2222-3333-444455556666 n=1234567',
    )
    expect(out).not.toMatch(/God so loved/)
    expect(out).not.toMatch(/joey@example\.com/)
    expect(out).not.toMatch(/secret/)
    expect(out).not.toMatch(/3f2a9c1e/)
    expect(out).not.toMatch(/1234567/)
    expect(out).toMatch(/Cannot read/)
  })
  it('keeps short code identifiers readable', () => {
    expect(scrub("Cannot read properties of undefined (reading 'map')")).toBe("Cannot read properties of undefined (reading 'map')")
  })
  it('strips record ids and query strings from paths', () => {
    expect(scrubPath('/study/k3j4h5g6f7d8s9a0q1w2?x=1#top')).toBe('/study/:id')
    expect(scrubPath('/bible/John/3/16')).toBe('/bible/John/3/16')
    expect(scrub('internationalization failed')).toBe('internationalization failed')
  })
})

describe('/api/log-error', () => {
  beforeEach(() => __resetForTests())
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    POST(new Request('https://app.test/api/log-error', { method: 'POST', headers: { host: 'app.test', 'x-real-ip': '1.2.3.4', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

  it('logs only the allowed fields, truncated', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await post({ message: 'x'.repeat(1000), stack: 'at a.js:1', path: '/bible', kind: 'error', notes: 'private sermon text', mobile: true })
    expect(r.status).toBe(204)
    const logged = JSON.parse(log.mock.calls[0][0] as string)
    expect(logged.event).toBe('client_error')
    expect(logged.message.length).toBe(300)
    expect(logged.notes).toBeUndefined()
    expect(JSON.stringify(logged)).not.toMatch(/private sermon/)
    log.mockRestore()
  })
  it('refuses cross-site, oversized, and malformed reports', async () => {
    expect((await post({ message: 'm' }, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post('x'.repeat(5000))).status).toBe(413)
    expect((await post('{not json')).status).toBe(400)
  })
  it('rate-limits each client to 30 reports an hour', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (let i = 0; i < 30; i++) expect((await post({ message: 'm' })).status).toBe(204)
    expect((await post({ message: 'm' })).status).toBe(429)
    expect((await post({ message: 'm' }, { 'x-real-ip': '5.6.7.8' })).status).toBe(204)
    log.mockRestore()
  })
})
