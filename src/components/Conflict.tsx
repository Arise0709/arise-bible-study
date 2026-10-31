import { useEffect, type MutableRefObject } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import type { useAutosave } from '../lib/autosave'
import { toast } from './ui'

type Rec = { id: string; title?: string; updatedAt: number }
type Autosave = ReturnType<typeof useAutosave<never>>

/**
 * Watches the stored record for changes made in another tab or window. With no unsaved edits here, the
 * newer version is loaded and the user is told. With unsaved edits here, a conflict is raised instead, so
 * neither version is overwritten without the user choosing.
 */
export function useWatchRecord<T extends Rec>(table: 'studies' | 'sermons', id: string, base: MutableRefObject<number>, autosave: Pick<Autosave, 'hasUnsaved' | 'isDiscarded' | 'raiseConflict' | 'reset'>, onLoad: (rec: T) => void, noun: string) {
  const rec = useLiveQuery(() => db.table(table).get(id) as Promise<T | undefined>, [table, id], 'loading' as const)
  useEffect(() => {
    if (rec === 'loading' || autosave.isDiscarded()) return
    if (rec === undefined) {
      autosave.raiseConflict(null) // deleted somewhere else
      return
    }
    if ((rec.updatedAt ?? 0) <= base.current) return
    if (autosave.hasUnsaved()) {
      autosave.raiseConflict(rec)
      return
    }
    base.current = rec.updatedAt
    ;(autosave.reset as (v: T) => void)(rec)
    onLoad(rec)
    toast(`This ${noun} was changed in another tab. You are now seeing the latest version.`)
  }, [rec]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Explains a conflict and lets the user choose. The version not chosen is kept as a separate copy. */
export function ConflictBanner<T extends Rec>({
  table,
  noun,
  value,
  base,
  autosave,
  onUseTheirs,
  onClose,
}: {
  table: 'studies' | 'sermons'
  noun: string
  value: T
  base: MutableRefObject<number>
  autosave: Pick<Autosave, 'conflict' | 'reset'>
  onUseTheirs: (rec: T) => void
  onClose: () => void
}) {
  const c = autosave.conflict
  if (!c) return null
  const reset = autosave.reset as (v: T) => void
  const t = db.table(table)

  const keepMine = async () => {
    const now = Math.max(Date.now(), (c.theirs?.updatedAt ?? 0) + 1)
    if (c.theirs) await t.add({ ...c.theirs, id: uid(), title: `${c.theirs.title || 'Untitled'} (other tab's version)`, updatedAt: now })
    await t.put({ ...value, updatedAt: now })
    base.current = now
    reset(value)
    toast(c.theirs ? `Kept your version. The other tab's version was saved as a separate ${noun}.` : `Your ${noun} was restored.`)
  }
  const useTheirs = async () => {
    const theirs = c.theirs as T
    await t.add({ ...value, id: uid(), title: `${value.title || 'Untitled'} (my unsaved copy)`, updatedAt: Date.now() })
    base.current = theirs.updatedAt
    reset(theirs)
    onUseTheirs(theirs)
    toast(`Showing the other tab's version. Your edits were saved as a separate ${noun}.`)
  }

  return (
    <div className="notice warn stack" role="alert" data-testid="edit-conflict" style={{ margin: '8px 0' }}>
      {c.theirs ? (
        <>
          <strong>This {noun} was changed in another tab or window while you were editing here.</strong>
          <span className="small">
            Your latest edits have not been saved yet. Choose which version to keep. The other one is saved as a separate {noun}, so nothing is lost.
          </span>
          <div className="row">
            <button className="btn sm primary" onClick={keepMine}>
              Keep my version
            </button>
            <button className="btn sm" onClick={useTheirs}>
              Use the other version
            </button>
          </div>
        </>
      ) : (
        <>
          <strong>This {noun} was deleted in another tab or window.</strong>
          <span className="small">You can restore it with your edits, or close it.</span>
          <div className="row">
            <button className="btn sm primary" onClick={keepMine}>
              Restore it
            </button>
            <button className="btn sm" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  )
}
