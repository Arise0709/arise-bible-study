import { describe, expect, it } from 'vitest'
import { inviteEmail, siteUrl } from '../api/org-invite'

const req = (host: string) => new Request(`https://${host}/api/org-invite`, { headers: { host } })

describe('invitation emails', () => {
  it('puts only known site addresses in links, never whatever a request claims', () => {
    delete process.env.SITE_URL
    expect(siteUrl(req('www.carterstudybible.app'))).toBe('https://www.carterstudybible.app')
    expect(siteUrl(req('arise-bible-study-abc123-joeydcarter2-4984s-projects.vercel.app'))).toBe('https://arise-bible-study-abc123-joeydcarter2-4984s-projects.vercel.app')
    expect(siteUrl(req('evil.example'))).toBe('https://www.carterstudybible.app')
    expect(siteUrl(req('carterstudybible.app.evil.example'))).toBe('https://www.carterstudybible.app')
    expect(siteUrl(req('127.0.0.1:5173'))).toBe('http://127.0.0.1:5173')
  })

  it('escapes names in the HTML, states the role, the expiry, and the privacy promise', () => {
    const m = inviteEmail({ org: 'Arise <Church>', inviter: 'Pastor "J"', role: 'teacher', link: 'https://www.carterstudybible.app/church/join#token=abc', expires: '2026-11-15T12:00:00Z', groups: ['Romans'], courses: [] })
    expect(m.html).toContain('Arise &lt;Church&gt;')
    expect(m.html).not.toContain('<Church>')
    expect(m.html).toContain('Pastor &quot;J&quot;')
    expect(m.text).toContain('as Pastor/Teacher')
    expect(m.text).toContain('the group "Romans"')
    expect(m.text).toContain('November 15, 2026')
    expect(m.text).toMatch(/personal notes and studies stay private/)
    expect(m.subject).toBe('Arise <Church>: invitation to Carter Study Bible')
    expect(m.text + m.html).not.toMatch(/—/) // no em dashes
  })
})
