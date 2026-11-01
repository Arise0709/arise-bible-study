import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Download, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import { BOOKS } from '../lib/refs'
import { offlineSupported } from '../lib/offline'
import { NEEDS_INTERNET, StorageFullError, customPack, downloadPack, downloadedPackIds, formatBytes, loadPacks, packState, passageFiles, removePack, storageInfo, type Pack, type PackState } from '../lib/packs'
import { ErrorBox, Loading, toast, useAsync } from './ui'

function PackRow({ pack, all, onChanged }: { pack: Pack; all: Pack[]; onChanged: () => void }) {
  const [state, setState] = useState<PackState | null>(null)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)
  const [err, setErr] = useState('')
  const stop = useRef<AbortController | null>(null)
  const refresh = useCallback(() => packState(pack).then(setState), [pack])
  useEffect(() => {
    refresh()
  }, [refresh])
  const download = async () => {
    setErr('')
    setBusy({ done: 0, total: pack.files.length })
    stop.current = new AbortController()
    try {
      await downloadPack(pack, (done, total) => setBusy({ done, total }), stop.current.signal)
      toast(`${pack.label} is ready to use offline`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setErr(e instanceof StorageFullError ? e.message : (e as Error).message)
    } finally {
      setBusy(null)
      stop.current = null
      await refresh()
      onChanged()
    }
  }
  const remove = async () => {
    await removePack(pack, all)
    toast(`${pack.label} removed from this device`)
    await refresh()
    onChanged()
  }
  const s = state?.state
  return (
    <li className="stack" style={{ gap: 4 }} data-testid={`pack-${pack.id}`}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 180 }}>
          <strong>{pack.label}</strong> <span className="muted small">about {formatBytes(pack.bytes)}</span>
          {pack.description && (
            <>
              <br />
              <span className="small muted">{pack.description}</span>
            </>
          )}
        </span>
        <span className="small" data-testid="pack-status" role="status">
          {busy
            ? `Downloading… ${Math.round((busy.done / Math.max(1, busy.total)) * 100)}%`
            : s === 'ready'
              ? 'Available offline'
              : s === 'update'
                ? 'Update available'
                : s === 'partial'
                  ? 'Partly downloaded'
                  : 'Not downloaded'}
        </span>
        {busy ? (
          <button className="btn sm" onClick={() => stop.current?.abort()}>
            Stop
          </button>
        ) : s === 'ready' ? (
          <>
            <CheckCircle2 size={16} aria-hidden />
            <button className="btn sm" onClick={remove} aria-label={`Remove ${pack.label}`}>
              <Trash2 size={14} aria-hidden /> Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn sm" onClick={download} aria-label={`${s === 'partial' ? 'Finish downloading' : s === 'update' ? 'Update' : 'Download'} ${pack.label}`}>
              {s === 'update' ? <RefreshCw size={14} aria-hidden /> : <Download size={14} aria-hidden />} {s === 'partial' ? 'Finish download' : s === 'update' ? 'Update' : 'Download'}
            </button>
            {(s === 'partial' || s === 'update') && (
              <button className="btn sm" onClick={remove} aria-label={`Remove ${pack.label}`}>
                <Trash2 size={14} aria-hidden /> Remove
              </button>
            )}
          </>
        )}
      </div>
      {err && (
        <div className="notice error small" role="alert">
          {err}
        </div>
      )}
    </li>
  )
}

/** Settings: research packs for offline study. */
export function ResearchPacks() {
  const { data: packs, error, reload } = useAsync(loadPacks, [])
  const [book, setBook] = useState('John')
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    storageInfo().then(setStorage)
  }, [tick])
  if (!offlineSupported()) return <p className="small muted">This browser cannot store files for offline use.</p>
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!packs) return <Loading label="Loading offline packs" />
  const changed = () => setTick((t) => t + 1)
  const forBook = packs.filter((p) => p.id === `comm:${book}` || p.id === `orig:${book}`)
  const library = packs.filter((p) => !p.id.includes(':') || p.id.startsWith('lex:') || p.id.startsWith('search:'))
  const downloaded = new Set(downloadedPackIds())
  const otherBooks = packs.filter((p) => /^(comm|orig):/.test(p.id) && !forBook.includes(p) && downloaded.has(p.id))
  return (
    <div className="stack" data-testid="research-packs">
      <h3 style={{ margin: '8px 0 0' }}>Research packs</h3>
      <p className="small" style={{ margin: 0 }}>
        Download study resources to use without a connection. Nothing downloads unless you choose it. Read the Bible offline too by downloading a Bible above.
        {storage && ` This site is using ${formatBytes(storage.usage)} of about ${formatBytes(storage.quota)} available on this device.`}
      </p>
      <label className="row small">
        <strong>Book</strong>
        <select value={book} onChange={(e) => setBook(e.target.value)} aria-label="Book for research packs">
          {BOOKS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="list">
        {forBook.map((p) => (
          <PackRow key={p.id} pack={p} all={packs} onChanged={changed} />
        ))}
      </ul>
      <h4 style={{ margin: '4px 0 0' }}>For every book</h4>
      <ul className="list">
        {library.map((p) => (
          <PackRow key={p.id} pack={p} all={packs} onChanged={changed} />
        ))}
      </ul>
      {otherBooks.length > 0 && (
        <>
          <h4 style={{ margin: '4px 0 0' }}>Other books on this device</h4>
          <ul className="list">
            {otherBooks.map((p) => (
              <PackRow key={p.id} pack={p} all={packs} onChanged={changed} />
            ))}
          </ul>
        </>
      )}
      <div className="notice info small">
        <WifiOff size={14} aria-hidden /> Always on this device, no download needed: your notes, highlights, bookmarks, studies, sermons, reading plans, and courses. These always need a connection: {NEEDS_INTERNET.join('; ').toLowerCase()}.
      </div>
    </div>
  )
}

/** "Save for offline" for the passages of a reading plan or course. */
export function SaveOffline({ id, label, refs, translation }: { id: string; label: string; refs: string[]; translation?: string }) {
  const pack = customPack(id, label, passageFiles(refs, translation))
  const [state, setState] = useState<PackState | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const key = pack.hash
  useEffect(() => {
    packState(pack).then(setState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!offlineSupported()) return null
  const go = async () => {
    setErr('')
    setBusy(0)
    try {
      await downloadPack(pack, (d, t) => setBusy(Math.round((d / t) * 100)))
      toast(`${label} saved for offline reading`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
      setState(await packState(pack))
    }
  }
  return (
    <div className="row small" style={{ flexWrap: 'wrap' }} data-testid="save-offline">
      {state?.state === 'ready' ? (
        <span>
          <CheckCircle2 size={14} aria-hidden /> The Scripture for this {label.toLowerCase().includes('course') ? 'course' : 'plan'} is saved for offline reading.
        </span>
      ) : (
        <button className="btn sm" onClick={go} disabled={busy !== null}>
          <Download size={14} aria-hidden /> {busy !== null ? `Saving… ${busy}%` : state?.state === 'update' ? 'Update offline copy' : state?.state === 'partial' ? 'Finish saving for offline' : 'Save the Scripture for offline reading'}
        </button>
      )}
      {err && (
        <span className="notice error small" role="alert">
          {err}
        </span>
      )}
    </div>
  )
}
