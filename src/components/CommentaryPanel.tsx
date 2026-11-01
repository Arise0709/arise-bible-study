import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpenText, Info, Plus, Search, StickyNote } from 'lucide-react'
import {
  loadCommentaryChapter,
  loadCommentaryCoverage,
  loadCommentaryIndex,
  loadCommentaryIntro,
  type CommentaryEntry,
  type CommentaryWork,
} from '../lib/data'
import { BOOK_BY_ID, formatRef, parseOsis, refPath } from '../lib/refs'
import { useStudy, useStudySink } from '../lib/state'
import { uid } from '../db/db'
import { Empty, ErrorBox, Loading, toast, useAsync } from './ui'
import { CommentaryResultsList } from './CommentarySearchView'

const plain = (h: string) => {
  const d = document.createElement('div')
  d.innerHTML = h
  return (d.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const MAX_SAVE = 6000

/** Commentary HTML from the build (fixed, safe tags only). Scripture links open in the reader. */
function CommentaryHtml({ html }: { html: string }) {
  const nav = useNavigate()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    for (const a of ref.current?.querySelectorAll<HTMLAnchorElement>('a[data-ref]') ?? []) {
      const r = parseOsis(a.dataset.ref!)
      if (r) {
        a.href = refPath(r)
        a.className = 'reflink'
      }
    }
  }, [html])
  return (
    <div
      ref={ref}
      className="commentary-text"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-ref]')
        const r = a && parseOsis(a.dataset.ref!)
        if (r) {
          e.preventDefault()
          nav(refPath(r))
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function rangeLabel(book: string, chapter: number, s: number, e: number) {
  return formatRef({ book, chapter, verse: s, endVerse: e !== s ? e : undefined })
}

/** One commentator's notes for the current chapter and verse. */
function CommentaryColumn({ work, book, chapter, verse }: { work: CommentaryWork; book: string; chapter: number; verse?: number }) {
  const sink = useStudySink()
  const [all, setAll] = useState(false)
  const [intro, setIntro] = useState(false)
  const { data: cov, loading: covLoading, error: covError } = useAsync(() => loadCommentaryCoverage(work.id, book), [work.id, book])
  const chInfo = cov?.chapters[String(chapter)]
  const { data: ch, error, loading } = useAsync(() => (chInfo ? loadCommentaryChapter(work.id, book, chapter) : Promise.resolve(null)), [work.id, book, chapter, !!chInfo])
  const introData = useAsync(() => (intro && cov?.intro ? loadCommentaryIntro(work.id, book) : Promise.resolve(null)), [intro, work.id, book, cov?.intro])
  useEffect(() => setAll(false), [book, chapter, verse])

  const here = useMemo(() => (ch && verse ? ch.e.filter(([s, e]) => s <= verse && verse <= e) : []), [ch, verse])
  const shown: CommentaryEntry[] = all || !verse ? ch?.e ?? [] : here

  const save = (title: string, html: string, withNote: boolean) => {
    if (!sink) return
    const sel = window.getSelection()?.toString().trim()
    let text = sel && sel.length > 20 && html.includes(sel.slice(0, 40).replace(/&/g, '&amp;')) ? sel : plain(html)
    let cut = false
    if (text.length > MAX_SAVE) {
      text = text.slice(0, MAX_SAVE)
      cut = true
    }
    sink.add('interpretation', { id: uid(), kind: 'source', source: work.short, title, text: cut ? text + ' …' : text, citation: `${work.short}, ${work.title} (${work.era}), on ${title}. Public domain.` })
    if (withNote) sink.add('interpretation', { id: uid(), kind: 'note', text: '' })
    toast(cut ? 'Added to Interpretation (shortened; select text first to save a specific part)' : withNote ? 'Added to Interpretation with a note to fill in' : 'Added to Interpretation')
  }

  const actions = (title: string, html: string) =>
    sink && (
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => save(title, html, false)} title="Save this note to your study (select text first to save only part of it)">
          <Plus size={14} /> Save to study
        </button>
        <button className="btn sm" onClick={() => save(title, html, true)}>
          <StickyNote size={14} /> Save with my note
        </button>
      </div>
    )

  if (covLoading) return <Loading />
  if (covError) return <ErrorBox error={covError} />
  if (!cov) return <Empty>{work.short} has no commentary on {BOOK_BY_ID[book]?.name}. {work.id === 'KD' ? 'Keil & Delitzsch covers the Old Testament only.' : ''}</Empty>

  return (
    <div className="stack" data-testid={`commentary-${work.id}`}>
      {cov.intro && (
        <details className="commentary-block" onToggle={(e) => setIntro((e.target as HTMLDetailsElement).open)}>
          <summary>
            <strong>Introduction to {BOOK_BY_ID[book]?.name}</strong> <span className="badge">book level</span>
          </summary>
          {introData.loading && <Loading />}
          {introData.data && (
            <>
              <CommentaryHtml html={introData.data.h} />
              {actions(`Introduction to ${BOOK_BY_ID[book]?.name}`, introData.data.h)}
            </>
          )}
        </details>
      )}
      {!chInfo && <Empty>{work.short} has no notes on {BOOK_BY_ID[book]?.name} {chapter}.</Empty>}
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {ch && ch.c.length > 0 && (
        <details className="commentary-block" open={!verse}>
          <summary>
            <strong>Chapter {chapter} overview</strong> <span className="badge">chapter level</span>
          </summary>
          <CommentaryHtml html={ch.c.join('')} />
          {actions(`${BOOK_BY_ID[book]?.name} ${chapter} (overview)`, ch.c.join(''))}
        </details>
      )}
      {ch && verse && here.length === 0 && (
        <div className="notice small" data-testid="no-verse-note">
          {work.short} has no note that includes {formatRef({ book, chapter, verse })}.{' '}
          {ch.e.length > 0 && `It has ${ch.e.length} note${ch.e.length === 1 ? '' : 's'} elsewhere in this chapter.`}
        </div>
      )}
      {shown.map(([s, e, h]) => (
        <section key={`${s}-${e}`} className="commentary-block" aria-label={`${work.short} on ${rangeLabel(book, chapter, s, e)}`}>
          <div className="row small" style={{ gap: 6 }}>
            <strong>{rangeLabel(book, chapter, s, e)}</strong>
            <span className="badge">{s === e ? 'verse note' : `passage note, verses ${s}-${e}`}</span>
          </div>
          <CommentaryHtml html={h} />
          {actions(rangeLabel(book, chapter, s, e), h)}
        </section>
      ))}
      {ch && verse && ch.e.length > here.length && (
        <button className="btn sm" onClick={() => setAll(!all)}>
          {all ? `Show only notes on verse ${verse}` : `Show all ${ch.e.length} notes in chapter ${chapter}`}
        </button>
      )}
    </div>
  )
}

/** Search one commentary within a book, using the whole-library index (same results as the Search page). */
function CommentarySearch({ work, book }: { work: CommentaryWork; book: string }) {
  const [q, setQ] = useState('')
  const [run, setRun] = useState('')
  return (
    <details className="commentary-block">
      <summary>
        <Search size={14} aria-hidden /> Search {work.short} in {BOOK_BY_ID[book]?.name}
      </summary>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          setRun(q)
        }}
      >
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="A word or phrase" aria-label={`Search ${work.short}`} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn sm">Search</button>
      </form>
      {run.trim() && (
        <>
          <CommentaryResultsList q={{ query: run, mode: /\s/.test(run.trim()) ? 'phrase' : 'all', works: [work.id], scope: book }} compact pageSize={30} />
          <Link className="small" to={`/search?in=commentaries&q=${encodeURIComponent(run)}`}>
            Search all commentaries across the whole Bible
          </Link>
        </>
      )}
    </details>
  )
}

function About({ work }: { work: CommentaryWork }) {
  return (
    <details className="small">
      <summary>
        <Info size={13} aria-hidden /> About {work.short}
      </summary>
      <dl className="about-source">
        <dt>Work</dt>
        <dd>{work.title}</dd>
        <dt>Author</dt>
        <dd>{work.author}</dd>
        <dt>Published</dt>
        <dd>{work.era}</dd>
        <dt>Perspective</dt>
        <dd>
          {work.tradition} <span className="muted">(editorial summary)</span>
        </dd>
        <dt>Edition</dt>
        <dd>{work.edition}</dd>
        <dt>Rights</dt>
        <dd>
          {work.copyright}. {work.scope}
        </dd>
        <dt>Source</dt>
        <dd style={{ wordBreak: 'break-word' }}>{work.source}</dd>
      </dl>
    </details>
  )
}

export function CommentaryPanel() {
  const { focusVerse, selection, readerLoc, settings, updateSettings } = useStudy()
  const v = focusVerse ?? (selection ? { book: selection.book, chapter: selection.chapter, verse: selection.verse } : null)
  const book = v?.book ?? readerLoc?.book
  const chapter = v?.chapter ?? readerLoc?.chapter
  const verse = v && v.book === book && v.chapter === chapter ? v.verse : undefined
  const { data: index, error } = useAsync(loadCommentaryIndex, [])
  const works = index?.works ?? []
  const main = works.find((w) => w.id === settings.commentary) ?? works[0]
  const second = works.find((w) => w.id === settings.compareCommentary && w.id !== main?.id)
  const { data: others } = useAsync(
    async () =>
      book && chapter && verse && works.length // nothing to say until the list of commentaries has loaded
        ? (
            await Promise.all(
              works.map(async (w) => {
                const c = await loadCommentaryCoverage(w.id, book).catch(() => null)
                return c?.chapters[String(chapter)]?.ranges.some(([s, e]) => s <= verse && verse <= e) ? w : null
              }),
            )
          ).filter((w): w is CommentaryWork => !!w)
        : null,
    [works.length, book, chapter, verse],
  )

  if (error) return <ErrorBox error={error} />
  if (!index) return <Loading />
  if (!book || !chapter) return <Empty>Open a chapter in the reader to see commentary.</Empty>

  return (
    <div className="stack commentary-panel">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <h3 style={{ margin: 0 }}>
          <BookOpenText size={16} aria-hidden /> Commentary on {verse ? formatRef({ book, chapter, verse }) : `${BOOK_BY_ID[book]?.name} ${chapter}`}
        </h3>
      </div>
      <div className="notice small">
        Commentary is the work of its author, not Scripture. Each source is shown with its author, era, and perspective, and only where it actually
        comments: some notes cover one verse, some a whole passage, and some only the chapter.
      </div>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label>
          Commentary{' '}
          <select value={main?.id} onChange={(e) => updateSettings({ commentary: e.target.value })} aria-label="Commentary to show">
            {works.map((w) => (
              <option key={w.id} value={w.id}>
                {w.short}
              </option>
            ))}
          </select>
        </label>
        <label>
          Side by side with{' '}
          <select value={second?.id ?? ''} onChange={(e) => updateSettings({ compareCommentary: e.target.value })} aria-label="Second commentary to compare">
            <option value="">None</option>
            {works
              .filter((w) => w.id !== main?.id)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.short}
                </option>
              ))}
          </select>
        </label>
      </div>
      {verse && others && (
        <div className="small" data-testid="commentary-coverage">
          {others.length ? (
            <>
              Notes on this verse in:{' '}
              {others.map((w, i) => (
                <span key={w.id}>
                  {i > 0 && ' · '}
                  <button className="reflink" onClick={() => updateSettings({ commentary: w.id })} aria-pressed={w.id === main?.id}>
                    {w.short}
                  </button>
                </span>
              ))}
            </>
          ) : (
            'None of the commentaries has a note that includes this verse.'
          )}
        </div>
      )}
      <div className={second ? 'commentary-compare' : ''}>
        {[main, second].filter((w): w is CommentaryWork => !!w).map((w) => (
          <div key={w.id} className="stack">
            <div className="commentary-source">
              <strong>{w.short}</strong> <span className="muted small">{w.era}</span>
              <About work={w} />
            </div>
            <CommentaryColumn work={w} book={book} chapter={chapter} verse={verse} />
            <CommentarySearch work={w} book={book} />
          </div>
        ))}
      </div>
      {index.notIncluded.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Not included yet: {index.notIncluded.map((w) => `${w.author.split(' (')[0]}'s ${w.title}`).join(', ')}. See Sources for why.
        </p>
      )}
    </div>
  )
}
