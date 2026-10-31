import { useEffect, useState } from 'react'
import { CloudOff, Download, RefreshCw, Trash2 } from 'lucide-react'
import { applyUpdate, downloadBible, isDownloaded, offlineSupported, onUpdateState, removeBible, updateState, verifyDownloaded } from '../lib/offline'
import { loadTranslationIndex } from '../lib/data'
import { toast, useAsync } from './ui'

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** Shown while there is no connection, and when a new version of the app is ready. */
export function AppStatusBanners() {
  const online = useOnline()
  const [u, setU] = useState(updateState())
  useEffect(() => onUpdateState(() => setU(updateState())), [])
  return (
    <>
      {!online && (
        <div className="notice info no-print" role="status" data-testid="offline-banner" style={{ borderRadius: 0, margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
          <CloudOff size={16} aria-hidden />
          <span>
            <strong>You're offline.</strong> Downloaded Bibles, chapters you've read, and all your notes, studies, and sermons still work. Search,
            word studies you haven't opened before, and the AI assistant need a connection.
          </span>
        </div>
      )}
      {(u.updateReady || u.updatedElsewhere) && (
        <div className="notice info no-print" role="status" data-testid="update-banner" style={{ borderRadius: 0, margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <RefreshCw size={16} aria-hidden />
          <span>{u.updatedElsewhere ? 'Carter Study Bible was updated in another tab. Reload to keep using the same version everywhere.' : 'A new version of Carter Study Bible is ready.'}</span>
          <span className="spacer" />
          <button className="btn sm primary" onClick={applyUpdate}>
            Reload now
          </button>
        </div>
      )}
    </>
  )
}

/** Settings: choose which Bibles are stored on this device for offline reading. */
export function OfflineSettings() {
  const { data: tIndex } = useAsync(() => loadTranslationIndex().catch(() => []), [])
  const [status, setStatus] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<{ id: string; done: number; total: number } | null>(null)
  const ids = ['KJV', ...(tIndex?.map((t) => t.id) ?? [])]
  const names: Record<string, string> = { KJV: 'King James Version', ...Object.fromEntries((tIndex ?? []).map((t) => [t.id, t.name])) }

  useEffect(() => {
    if (!tIndex) return
    void Promise.all(ids.map(async (id) => [id, await verifyDownloaded(id)] as const)).then((r) => setStatus(Object.fromEntries(r)))
  }, [tIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!offlineSupported()) return <p className="small muted">This browser cannot store Bibles for offline reading.</p>

  const download = async (id: string) => {
    setBusy({ id, done: 0, total: 1 })
    try {
      await downloadBible(id, (done, total) => setBusy({ id, done, total }))
      setStatus((s) => ({ ...s, KJV: true, [id]: true }))
      toast(`${names[id]} is ready for offline reading`)
    } catch {
      toast('The download did not finish. Check your connection and try again; what was saved is kept.')
    } finally {
      setBusy(null)
    }
  }
  const remove = async (id: string) => {
    await removeBible(id)
    setStatus((s) => ({ ...s, [id]: false }))
    toast(`${names[id]} removed from this device`)
  }
  const othersDownloaded = ids.some((id) => id !== 'KJV' && status[id])

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        Store whole Bibles on this device to read without a connection. Chapters you open are also kept automatically. The KJV is always included,
        because every translation uses it for verse layout and Hebrew and Greek word links. The KJV takes about 16 MB of storage (about 4 MB to
        download); each other translation adds about 4 MB.
      </p>
      <ul className="list" data-testid="offline-list">
        {ids.map((id) => {
          const when = isDownloaded(id)
          return (
            <li key={id} className="row" style={{ flexWrap: 'wrap' }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong>{id}</strong> <span className="muted small">{names[id]}</span>
                <br />
                <span className="small" data-testid={`offline-${id}`}>
                  {busy?.id === id
                    ? `Downloading… ${Math.round((busy.done / busy.total) * 100)}%`
                    : status[id]
                      ? `Available offline${when ? ` (saved ${new Date(when).toLocaleDateString()})` : ''}`
                      : 'Not downloaded'}
                </span>
              </span>
              {status[id] ? (
                <button className="btn sm" onClick={() => remove(id)} disabled={!!busy || (id === 'KJV' && othersDownloaded)} title={id === 'KJV' && othersDownloaded ? 'Needed by the other downloaded translations' : undefined}>
                  <Trash2 size={14} /> Remove
                </button>
              ) : (
                <button className="btn sm" onClick={() => download(id)} disabled={!!busy}>
                  <Download size={14} /> Download {id}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
