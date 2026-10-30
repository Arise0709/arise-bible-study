/**
 * Privacy-conscious error reporting.
 *
 * Sends only what is needed to find a bug: the error message, a shortened stack trace (file names and
 * line numbers), the page path with record ids removed, the app build, and the browser family.
 * Never sends notes, study or sermon text, Bible selections, settings, IP-derived data, or cookies.
 * Limited to 5 reports per page load, duplicates skipped, and can be turned off in Settings.
 */

const MAX_PER_LOAD = 5
const sent = new Set<string>()
let enabled = true
let installed = false

export function setErrorReporting(on: boolean) {
  enabled = on
}

const ID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?=[0-9a-z]*\d)[0-9a-z]{16,}\b/gi

/** Removes anything that could carry personal content: ids, quoted strings, emails, long numbers, URLs' query strings. */
export function scrub(text: string, max = 300): string {
  return text
    .replace(/https?:\/\/[^\s)]+/g, (u) => {
      try {
        const url = new URL(u)
        return url.pathname.split('/').pop() || url.host
      } catch {
        return '[url]'
      }
    })
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/(["'“‘])(?:(?!\1).){12,}\1/g, '"[text]"')
    .replace(ID_RE, ':id')
    .replace(/\d{6,}/g, '[n]')
    .slice(0, max)
}

export function scrubPath(path: string): string {
  return path.split('?')[0].split('#')[0].replace(ID_RE, ':id').slice(0, 120)
}

function browserFamily(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Other'
}

export interface ErrorReport {
  message: string
  stack: string
  path: string
  build: string
  browser: string
  mobile: boolean
  kind: 'error' | 'rejection' | 'render'
}

export function buildReport(err: unknown, kind: ErrorReport['kind']): ErrorReport {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error value thrown')
  return {
    message: scrub(e.message || String(e)),
    stack: scrub((e.stack ?? '').split('\n').slice(0, 8).join('\n'), 1500),
    path: scrubPath(location.pathname),
    build: import.meta.env.VITE_BUILD_ID ?? 'dev',
    browser: browserFamily(navigator.userAgent),
    mobile: /Mobi|Android|iPhone|iPad/.test(navigator.userAgent),
    kind,
  }
}

export function reportError(err: unknown, kind: ErrorReport['kind'] = 'error') {
  if (!enabled || !import.meta.env.PROD) return
  try {
    const r = buildReport(err, kind)
    const key = r.message + r.stack.slice(0, 200)
    if (sent.has(key) || sent.size >= MAX_PER_LOAD) return
    sent.add(key)
    const body = JSON.stringify(r)
    if (!navigator.sendBeacon?.('/api/log-error', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/log-error', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* reporting must never cause another error */
  }
}

export function installErrorReporting() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'error'))
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'rejection'))
}
