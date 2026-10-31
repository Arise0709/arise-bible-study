import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { db, uid } from '../db/db'

const JOURNAL = 'abs-pending:'

/** Synchronous safety copy of an unsaved edit; survives a sudden reload or close. `base` is the stored version it was made from. */
function writeJournal(key: string | undefined, value: unknown, base?: number) {
  if (!key) return
  try {
    localStorage.setItem(JOURNAL + key, JSON.stringify({ at: Date.now(), base, value }))
  } catch {
    /* storage full or blocked: the normal save still runs */
  }
}
function clearJournal(key: string | undefined) {
  if (!key) return
  try {
    localStorage.removeItem(JOURNAL + key)
  } catch {
    /* ignore */
  }
}

/**
 * On startup, restore any edit that was typed but not yet written to the database (for example when
 * the page was closed mid-save). Only applies an edit that is newer than the stored record.
 * If the record was changed elsewhere (another tab) after the edit began, the edit is kept as a separate
 * copy instead of overwriting that change. Keys look like "studies:<id>" or "sermons:<id>".
 */
export async function recoverPendingEdits(): Promise<number> {
  let restored = 0
  let keys: string[] = []
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(JOURNAL))
  } catch {
    return 0
  }
  for (const k of keys) {
    try {
      const [table, id] = k.slice(JOURNAL.length).split(':')
      if (table !== 'studies' && table !== 'sermons') continue
      const entry = JSON.parse(localStorage.getItem(k) ?? 'null') as { at: number; base?: number; value: { id: string; title?: string; updatedAt?: number } } | null
      if (!entry?.value || entry.value.id !== id) {
        localStorage.removeItem(k)
        continue
      }
      const current = await db.table(table).get(id)
      if (current && entry.base !== undefined && (current.updatedAt ?? 0) > entry.base) {
        // changed in another tab since this edit began: keep both
        await db.table(table).put({ ...entry.value, id: uid(), title: `${entry.value.title || 'Untitled'} (recovered copy)`, updatedAt: entry.at })
        restored++
      } else if (!current || (current.updatedAt ?? 0) < entry.at) {
        await db.table(table).put({ ...entry.value, updatedAt: entry.at })
        restored++
      }
      localStorage.removeItem(k)
    } catch {
      /* leave the entry for the next start */
    }
  }
  return restored
}

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'

/* ---------------- edits in two tabs ---------------- */

type Rec = { id: string; title?: string; updatedAt: number }

/** The stored record changed (or was deleted) after this editor loaded it. `theirs` is the stored version. */
export class ConflictError extends Error {
  theirs: Rec | null
  constructor(theirs: Rec | null) {
    super('This record was changed somewhere else.')
    this.theirs = theirs
  }
}

/**
 * Save only if the stored record is still the version this editor started from (`base`); otherwise throw
 * ConflictError and write nothing. On success `base` becomes the new version.
 */
export async function guardedPut(table: 'studies' | 'sermons', value: Rec, base: MutableRefObject<number>) {
  const t = db.table(table)
  await db.transaction('rw', t, async () => {
    const cur = (await t.get(value.id)) as Rec | undefined
    if (!cur || (cur.updatedAt ?? 0) > base.current) throw new ConflictError(cur ?? null)
    const now = Math.max(Date.now(), base.current + 1)
    await t.put({ ...value, updatedAt: now })
    base.current = now
  })
}

/**
 * Debounced autosave that never drops an edit.
 *
 * Edits are saved shortly after typing stops. Pending edits are also written immediately when the
 * editor closes (navigating away), when the page is hidden (switching apps or tabs on a phone), and
 * when the page unloads. Because a browser may stop a database write while a page is closing, every
 * change is also kept as a small synchronous safety copy (journalKey) until the save completes;
 * recoverPendingEdits() applies any leftover copy the next time the app opens.
 *
 * The first value (what was loaded from storage) is not saved back; only later changes are.
 */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, journalKey?: string, delay = 600, base?: MutableRefObject<number>) {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<{ theirs: Rec | null } | null>(null)
  const discarded = useRef(false)
  const latest = useRef(value)
  const dirty = useRef(false)
  const initial = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveRef = useRef(save)
  saveRef.current = save
  const inFlight = useRef<Promise<void> | null>(null)
  const keyRef = useRef(journalKey)
  keyRef.current = journalKey

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    if (inFlight.current) await inFlight.current
    if (!dirty.current) return
    dirty.current = false
    const snapshot = latest.current
    setStatus('saving')
    const p = (async () => {
      try {
        await saveRef.current(snapshot)
        if (!dirty.current) clearJournal(keyRef.current)
        setStatus(dirty.current ? 'pending' : 'saved')
      } catch (e) {
        dirty.current = true
        if (e instanceof ConflictError) {
          setConflict({ theirs: e.theirs })
          setStatus('conflict')
        } else setStatus('error')
      }
    })()
    inFlight.current = p
    await p
    inFlight.current = null
  }, [])

  // schedule a save whenever the value changes (except the initial load)
  useEffect(() => {
    latest.current = value
    if (value === initial.current) return
    writeJournal(keyRef.current, value, base?.current)
    dirty.current = true
    setStatus('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), delay)
  }, [value, delay, flush, base])

  // write pending edits when the page is hidden or unloading, and when the editor closes
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onPageHide = () => void flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      void flush() // editor closing (in-app navigation): save what is pending
    }
  }, [flush])

  /** Drop pending edits (used when the record is being deleted). */
  const discard = useCallback(() => {
    clearTimeout(timer.current)
    dirty.current = false
    discarded.current = true
    clearJournal(keyRef.current)
  }, [])

  /** Start over from `v` (a version loaded from storage): nothing pending, nothing to save. */
  const reset = useCallback((v: T) => {
    clearTimeout(timer.current)
    initial.current = v
    latest.current = v
    dirty.current = false
    clearJournal(keyRef.current)
    setConflict(null)
    setStatus('saved')
  }, [])

  /** Mark a conflict as dealt with; any edits still pending are saved normally. */
  const resolved = useCallback(() => {
    setConflict(null)
    setStatus(dirty.current ? 'pending' : 'saved')
    if (dirty.current) void flush()
  }, [flush])

  const hasUnsaved = useCallback(() => dirty.current || !!inFlight.current, [])
  const raiseConflict = useCallback((theirs: Rec | null) => {
    setConflict({ theirs })
    setStatus('conflict')
  }, [])

  return { status, flush, retry: flush, discard, reset, resolved, conflict, raiseConflict, hasUnsaved, isDiscarded: () => discarded.current }
}
