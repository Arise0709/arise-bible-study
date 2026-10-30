import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BACKUP_REMIND_DAYS, formatBackupAge, needsBackupReminder } from '../src/lib/dataSafety'

const DAY = 86_400_000
const now = Date.UTC(2026, 9, 30, 12)

describe('backup reminder rules', () => {
  it('stays quiet when there is nothing to back up', () => {
    expect(needsBackupReminder(0, 0, 0, now)).toBe(false)
  })
  it('reminds when there is data and no backup yet', () => {
    expect(needsBackupReminder(3, 0, 0, now)).toBe(true)
  })
  it(`reminds only after ${BACKUP_REMIND_DAYS} days since the last backup`, () => {
    expect(needsBackupReminder(3, now - 6 * DAY, 0, now)).toBe(false)
    expect(needsBackupReminder(3, now - 8 * DAY, 0, now)).toBe(true)
  })
  it('respects "Remind me later"', () => {
    expect(needsBackupReminder(3, 0, now + DAY, now)).toBe(false)
    expect(needsBackupReminder(3, 0, now - 1, now)).toBe(true)
  })
  it('shows the date and age of the last backup', () => {
    expect(formatBackupAge(0, now)).toBe('No backup downloaded yet')
    expect(formatBackupAge(now - 2 * DAY, now)).toMatch(/^Last backup: .*2026 \(2 days ago\)$/)
    expect(formatBackupAge(now - 1000, now)).toMatch(/\(today\)$/)
  })
})

describe('installable app manifest', () => {
  const pub = path.join(__dirname, '..', 'public')
  const m = JSON.parse(fs.readFileSync(path.join(pub, 'manifest.webmanifest'), 'utf8'))
  it('has what browsers need to install the app', () => {
    expect(m.name).toBeTruthy()
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
    for (const i of m.icons) expect(fs.existsSync(path.join(pub, i.src))).toBe(true)
  })
  it('index.html links the manifest and the iPhone icon', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('rel="apple-touch-icon"')
    expect(fs.existsSync(path.join(pub, 'icons', 'apple-touch-icon.png'))).toBe(true)
  })
})
