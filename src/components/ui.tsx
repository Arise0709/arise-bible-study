import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { DataError } from '../lib/data'

/** Run an async loader when deps change; exposes loading/error/data. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: Error; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => ({ data: s.data, loading: true }))
    fn().then(
      (data) => alive && setState({ data, loading: false }),
      (error) => alive && setState({ error, loading: false }),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="row muted" role="status" style={{ padding: 12 }}>
      <Loader2 size={16} className="spin" aria-hidden /> {label}…
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <div className="row">
        <AlertTriangle size={16} aria-hidden />
        <strong>{error instanceof DataError ? 'Missing data' : 'Something went wrong'}</strong>
      </div>
      <div>{error.message}</div>
      {onRetry && (
        <button className="btn sm" style={{ marginTop: 8 }} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted" style={{ padding: '16px 4px' }}>{children}</div>
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title} style={wide ? { maxWidth: 'min(900px, calc(100vw - 32px))' } : undefined}>
      <div className="dialog-head">
        <h2 style={{ margin: 0, flex: 1, fontSize: '1.1rem' }}>{title}</h2>
        <button className="iconbtn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="dialog-body">{open && children}</div>
    </dialog>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value)
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].id)
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].id)
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

interface ToastMsg {
  id: number
  text: string
  action?: { label: string; onClick: () => void | Promise<void> }
  ms: number
}
let toastSetter: ((m: ToastMsg | null) => void) | null = null
let toastSeq = 0
export function toast(message: string, action?: ToastMsg['action'], ms?: number) {
  toastSetter?.({ id: ++toastSeq, text: message, action, ms: ms ?? (action ? 6000 : 2600) })
}

/** Shows a message with an Undo button; undo runs only if pressed before the message closes. */
export function toastUndo(message: string, undo: () => Promise<unknown>) {
  toast(message, {
    label: 'Undo',
    onClick: async () => {
      await undo()
      toast('Restored')
    },
  })
}

export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null)
  useEffect(() => {
    toastSetter = setMsg
    return () => {
      toastSetter = null
    }
  }, [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg((cur) => (cur?.id === msg.id ? null : cur)), msg.ms)
    return () => clearTimeout(t)
  }, [msg])
  return msg ? (
    <div className="toast" role="status" aria-live="polite" style={msg.action ? { display: 'flex', gap: 12, alignItems: 'center' } : undefined}>
      <span>{msg.text}</span>
      {msg.action && (
        <button
          className="btn sm"
          style={{ background: 'var(--bg)', color: 'var(--text)', borderColor: 'transparent' }}
          onClick={() => {
            const a = msg.action!
            setMsg(null)
            void a.onClick()
          }}
        >
          {msg.action.label}
        </button>
      )}
    </div>
  ) : null
}

export function useDebouncedEffect(fn: () => void, deps: unknown[], ms: number) {
  useEffect(() => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const h = () => setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [q])
  return m
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function slug(s: string) {
  return (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled'
}

export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

/** Shows the autosave state; offers Retry when a save failed. */
export function SaveIndicator({ autosave }: { autosave: { status: import('../lib/autosave').SaveStatus; retry: () => Promise<void> } }) {
  const s = autosave.status
  const text = s === 'pending' ? 'Unsaved changes…' : s === 'saving' ? 'Saving…' : s === 'error' ? 'Not saved' : 'All changes saved'
  return (
    <span className="save-state" role="status" aria-live="polite" data-status={s} style={s === 'error' ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
      {text}
      {s === 'error' && (
        <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => void autosave.retry()}>
          Retry
        </button>
      )}
    </span>
  )
}
