import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../db/db'

const JOURNAL = 'abs-pending:'

/** Synchronous safety copy of an unsaved edit; survives a sudden reload or close. */
function writeJournal(key: string | undefined, value: unknown) {
  if (!key) return
  try {
    localStorage.setItem(JOURNAL + key, JSON.stringify({ at: Date.now(), value }))
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
 * Keys look like "studies:<id>" or "sermons:<id>".
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
      const entry = JSON.parse(localStorage.getItem(k) ?? 'null') as { at: number; value: { id: string; updatedAt?: number } } | null
      if (!entry?.value || entry.value.id !== id) {
        localStorage.removeItem(k)
        continue
      }
      const current = await db.table(table).get(id)
      if (!current || (current.updatedAt ?? 0) < entry.at) {
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

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

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
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, journalKey?: string, delay = 600) {
  const [status, setStatus] = useState<SaveStatus>('saved')
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
      } catch {
        dirty.current = true
        setStatus('error')
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
    writeJournal(keyRef.current, value)
    dirty.current = true
    setStatus('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), delay)
  }, [value, delay, flush])

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
    clearJournal(keyRef.current)
  }, [])

  return { status, flush, retry: flush, discard }
}
