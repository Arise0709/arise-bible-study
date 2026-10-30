import { useState, type MouseEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { findRefs, formatRef, parseOsis, refPath, type Ref } from '../lib/refs'
import { getPassage, passageToText } from '../lib/data'
import { useAsync } from './ui'
import { useStudy } from '../lib/state'

/** A clickable Scripture reference. Opens the passage in the Bible reader; hover/focus shows the text. */
export function ScriptureRef({ r, children, preview = true }: { r: Ref | string; children?: ReactNode; preview?: boolean }) {
  const ref = typeof r === 'string' ? parseOsis(r) : r
  const nav = useNavigate()
  const [show, setShow] = useState(false)
  if (!ref) return <>{children ?? String(r)}</>
  return (
    <span style={{ position: 'relative', display: 'inline' }} onMouseLeave={() => setShow(false)}>
      <a
        href={refPath(ref)}
        className="reflink"
        onClick={(e) => {
          e.preventDefault()
          nav(refPath(ref))
        }}
        onMouseEnter={() => preview && setShow(true)}
        onFocus={() => preview && setShow(true)}
        onBlur={() => setShow(false)}
      >
        {children ?? formatRef(ref)}
      </a>
      {show && <RefPreview r={ref} />}
    </span>
  )
}

function RefPreview({ r }: { r: Ref }) {
  const { settings } = useStudy()
  const tr = settings.translation || 'KJV'
  const { data, error } = useAsync(() => getPassage(r, tr).catch(() => getPassage(r)), [JSON.stringify(r), tr])
  return (
    <span
      role="tooltip"
      style={{
        position: 'absolute',
        left: 0,
        top: '100%',
        zIndex: 20,
        width: 320,
        maxWidth: '80vw',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 10,
        boxShadow: 'var(--shadow)',
        fontFamily: 'var(--scripture-font)',
        fontSize: 14,
        lineHeight: 1.5,
        color: 'var(--text)',
        display: 'block',
        fontStyle: 'normal',
        fontWeight: 400,
      }}
    >
      <strong style={{ fontFamily: 'var(--ui-font)' }}>{formatRef(r)} ({tr})</strong>
      <br />
      {error ? error.message : data ? clip(passageToText(data), 420) : 'Loading…'}
    </span>
  )
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' …' : s
}

/** Plain text with any Scripture references turned into links (used for notes, outlines, definitions). */
export function LinkedText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = []
  const lines = text.split('\n')
  lines.forEach((line, li) => {
    let last = 0
    for (const f of findRefs(line)) {
      if (f.start > last) parts.push(line.slice(last, f.start))
      parts.push(<ScriptureRef key={`${li}-${f.start}`} r={f.ref}>{f.text}</ScriptureRef>)
      last = f.end
    }
    if (last < line.length) parts.push(line.slice(last))
    if (li < lines.length - 1) parts.push(<br key={`br-${li}`} />)
  })
  return <span className={className}>{parts}</span>
}

/** List of references detected in some text, shown as chips beneath editors. */
export function DetectedRefs({ text }: { text: string }) {
  const found = findRefs(text)
  if (!found.length) return null
  const seen = new Set<string>()
  return (
    <div className="row small" style={{ marginTop: 4 }}>
      <span className="muted">Linked:</span>
      {found
        .filter((f) => !seen.has(f.text) && !!seen.add(f.text))
        .map((f) => (
          <ScriptureRef key={f.start} r={f.ref}>
            {formatRef(f.ref)}
          </ScriptureRef>
        ))}
    </div>
  )
}

/**
 * Renders build-time sanitised HTML from reference works (only b, i, br, a[data-ref], a[data-entry]).
 * Clicks on Scripture links navigate inside the app; entry links call onEntry.
 */
export function SourceHtml({ html, className, onEntry }: { html: string; className?: string; onEntry?: (name: string) => void }) {
  const nav = useNavigate()
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
    if (!a) return
    const ref = a.dataset.ref
    const entry = a.dataset.entry
    if (ref) {
      const r = parseOsis(ref)
      if (r) {
        e.preventDefault()
        nav(refPath(r))
      }
    } else if (entry && onEntry) {
      e.preventDefault()
      onEntry(entry)
    }
  }
  const withHref = html.replace(/<a data-ref="([^"]+)">/g, (_m, ref) => {
    const r = parseOsis(ref)
    return r ? `<a data-ref="${ref}" href="${refPath(r)}" class="reflink">` : '<a>'
  }).replace(/<a data-entry="([^"]+)">/g, '<a data-entry="$1" href="#" class="reflink">')
  return <div className={className} onClick={onClick} dangerouslySetInnerHTML={{ __html: withHref }} />
}
