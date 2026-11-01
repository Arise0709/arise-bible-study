import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpenText } from 'lucide-react'
import { searchCommentaries, type CommentaryHit, type CommentaryQuery, type CommentaryResults } from '../lib/commentarySearch'
import { loadCommentaryIndex } from '../lib/data'
import { BOOK_BY_ID, formatRef } from '../lib/refs'
import { useStudy } from '../lib/state'
import { ErrorBox, Loading, useAsync } from './ui'

export const hitRef = (h: CommentaryHit) => formatRef({ book: h.book, chapter: h.chapter, verse: h.v1, ...(h.v2 > h.v1 ? { endVerse: h.v2 } : {}) })

export function Snippet({ h }: { h: CommentaryHit }) {
  const out: React.ReactNode[] = []
  let at = 0
  h.marks.forEach(([a, b], i) => {
    out.push(h.snippet.slice(at, a), <mark key={i}>{h.snippet.slice(a, b)}</mark>)
    at = b
  })
  out.push(h.snippet.slice(at))
  return <span>{out}</span>
}

/** Opens a result in the Bible reader with that commentary's note showing. */
export function useOpenNote() {
  const nav = useNavigate()
  const { setFocusVerse, updateSettings, setTool, setToolsOpen } = useStudy()
  return (h: CommentaryHit) => {
    updateSettings({ commentary: h.work })
    setFocusVerse({ book: h.book, chapter: h.chapter, verse: h.v1 })
    setTool('commentary')
    setToolsOpen(true)
    nav(`/bible/${h.book}/${h.chapter}/${h.v1}`)
  }
}

/** Runs one commentary search and lists the results (used by the Search page and the commentary panel). */
export function CommentaryResultsList({ q, compact, pageSize = 20 }: { q: CommentaryQuery; compact?: boolean; pageSize?: number }) {
  const { data: index } = useAsync(loadCommentaryIndex, [])
  const open = useOpenNote()
  const [res, setRes] = useState<CommentaryResults | null>(null)
  const [err, setErr] = useState<Error | null>(null)
  const [busy, setBusy] = useState(false)
  const key = JSON.stringify(q)
  useEffect(() => {
    if (!q.query.trim()) return
    let alive = true
    setRes(null)
    setErr(null)
    searchCommentaries(q, pageSize, (partial) => alive && setRes(partial)).then(
      (r) => alive && setRes(r),
      (e) => alive && setErr(e),
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pageSize])
  if (!q.query.trim()) return null
  if (err) return <ErrorBox error={err} />
  if (!res) return <Loading label="Searching the commentaries" />
  const work = (id: string) => index?.works.find((w) => w.id === id)
  const count =
    res.total !== null
      ? `${res.total} ${compact ? '' : 'commentary '}note${res.total === 1 ? '' : 's'} found`
      : `${res.hits.length} note${res.hits.length === 1 ? '' : 's'} with this exact phrase so far, out of ${res.candidates} that may contain it${busy || res.hits.length < pageSize ? ' (still checking…)' : ''}`
  return (
    <div className="stack" style={{ gap: 6 }} data-testid="commentary-results">
      <div className="muted small" role="status">
        {count}
        {res.hits.length < (res.total ?? Infinity) && res.hits.length > 0 ? `, showing ${res.hits.length}` : ''}.
      </div>
      <ul className={`list ${compact ? 'small' : ''}`}>
        {res.hits.map((h) => {
          const w = work(h.work)
          return (
            <li key={h.doc} className="stack" style={{ gap: 2 }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="badge source">
                  <BookOpenText size={12} aria-hidden /> Commentary
                </span>
                <button className="reflink" onClick={() => open(h)}>
                  {w?.short ?? h.work} on {hitRef(h)}
                </button>
                {!compact && w && <span className="muted small">{w.author}, {w.era}</span>}
              </div>
              <div className={compact ? 'muted' : 'small'}>
                <Snippet h={h} />
              </div>
            </li>
          )
        })}
      </ul>
      {!res.done && (
        <div>
          <button
            className="btn sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setRes(await res.more(pageSize * 2, (partial) => setRes(partial)))
              setBusy(false)
            }}
          >
            {busy ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
      {!compact && <p className="muted small" style={{ margin: 0 }}>Commentary notes are the authors' own words, quoted exactly from public-domain editions. They are not Scripture.</p>}
    </div>
  )
}

/** The commentary side of the Search page. */
export function CommentarySearchControls({ q, mode, scope, works, set }: { q: string; mode: CommentaryQuery['mode']; scope: string; works: string[]; set: (k: string, v: string) => void }) {
  const { data: index } = useAsync(loadCommentaryIndex, [])
  return (
    <>
      <div className="row small" style={{ flexWrap: 'wrap' }}>
        <label>
          Commentary{' '}
          <select value={works[0] ?? ''} onChange={(e) => set('w', e.target.value)} aria-label="Commentary to search">
            <option value="">All commentaries</option>
            {index?.works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.short}
              </option>
            ))}
          </select>
        </label>
        <label>
          Match{' '}
          <select value={mode} onChange={(e) => set('mode', e.target.value)}>
            <option value="all">all words</option>
            <option value="phrase">exact phrase</option>
            <option value="any">any word</option>
          </select>
        </label>
        <label>
          Notes on{' '}
          <select value={scope} onChange={(e) => set('scope', e.target.value)}>
            <option value="all">the whole Bible</option>
            <option value="OT">the Old Testament</option>
            <option value="NT">the New Testament</option>
            {Object.values(BOOK_BY_ID).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">Tip: add * for word endings, e.g. justif*</span>
      </div>
      <CommentaryResultsList q={{ query: q, mode, scope, works }} />
    </>
  )
}
