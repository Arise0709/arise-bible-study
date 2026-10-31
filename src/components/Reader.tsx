import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { Bookmark, BookOpen, ChevronLeft, ChevronRight, Copy, Highlighter, Link2, NotebookPen, Plus, StickyNote, X } from 'lucide-react'
import { FLAG_ADDED, FLAG_DIVINE, FLAG_RED, getPassage, passageToText, loadChapter, loadBookIndex, loadTranslationBook, loadTranslationIndex, parseWord, segText, verseText, type Book, type Segment, type Verse } from '../lib/data'
import { BOOKS, BOOK_BY_ID, BOOK_INDEX, formatRef, parseOsis, toOsis, type Ref } from '../lib/refs'
import { quoteTr, useStudy, useStudySink } from '../lib/state'
import { db, emptyWorksheet, uid, type Highlight, type VerseNote } from '../db/db'
import { Dialog, ErrorBox, Loading, toast, toastUndo, useAsync } from './ui'
import { LinkedText } from './Scripture'

export const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const

export const numKey = (book: string, c: number, v: number) => BOOK_INDEX[book] * 1_000_000 + c * 1000 + v

interface Props {
  book: string
  chapter: number
  target?: number
  onNavigate: (book: string, chapter: number, verse?: number) => void
  inPanel?: boolean
  /** Every requested verse ("16,18" or "28-39"), highlighted together. */
  targets?: number[]
  /** The requested passage runs on into a later chapter (e.g. Gen 1:1-2:3). */
  continues?: { chapter: number; spec: string; toChapter: number; toVerse: number }
}

export function Reader({ book, chapter, target, onNavigate, inPanel, targets, continues }: Props) {
  const { data: index } = useAsync(loadBookIndex, [])
  // The chapter's own small file, not the whole book. Chapter numbers past the end are caught below.
  const bookEntry = index?.find((b) => b.id === book)
  const chapterExists = !index || !bookEntry || chapter <= bookEntry.chapters.length
  const { data: chData, error, loading, reload } = useAsync(
    () => (chapterExists ? loadChapter(book, chapter) : Promise.resolve(undefined)),
    [book, chapter, chapterExists],
  )
  const bookName = bookEntry?.name ?? BOOK_BY_ID[book]?.name ?? book
  const { settings, updateSettings, selection, select, setFocusVerse, setTool, setToolsOpen } = useStudy()
  const sink = useStudySink()
  const nav = useNavigate()
  const [sel, setSel] = useState<{ from: number; to: number } | null>(null)
  const [noteFor, setNoteFor] = useState<Ref | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const ch = chData?.c === chapter ? chData : undefined
  const { data: tIndex } = useAsync(() => loadTranslationIndex().catch(() => []), [])
  const primary = settings.translation !== 'KJV' && tIndex?.some((t) => t.id === settings.translation) ? settings.translation : 'KJV'
  const compare = settings.compareWith && settings.compareWith !== primary ? settings.compareWith : ''
  const { data: primaryBook, error: primaryErr } = useAsync(() => (primary === 'KJV' ? Promise.resolve(null) : loadTranslationBook(primary, book)), [primary, book])
  const { data: compareBook, error: compareErr } = useAsync(
    () => (!compare ? Promise.resolve(null) : compare === 'KJV' ? Promise.resolve(null) : loadTranslationBook(compare, book)),
    [compare, book],
  )
  const altVerse = (bk: (string | null)[][] | null | undefined, v: number) => bk?.[chapter - 1]?.[v - 1] ?? null
  const extraVerses = primaryBook ? (primaryBook[chapter - 1] ?? []).map((t, i) => ({ v: i + 1, t })).filter((x) => x.t && !ch?.verses.some((kv) => kv.v === x.v)) : []
  const chapterTotal = bookEntry?.chapters.length ?? 0

  // get the next and previous chapters ready so moving through a book is instant
  useEffect(() => {
    if (!ch || !chapterTotal) return
    const t = setTimeout(() => {
      if (chapter < chapterTotal) loadChapter(book, chapter + 1).catch(() => {})
      if (chapter > 1) loadChapter(book, chapter - 1).catch(() => {})
    }, 0)
    return () => clearTimeout(t)
  }, [ch, book, chapter, chapterTotal])

  const highlights = useLiveQuery(() => db.highlights.where('book').equals(book).toArray(), [book]) ?? []
  const bookmarks = useLiveQuery(() => db.bookmarks.where('book').equals(book).toArray(), [book]) ?? []
  const notes = useLiveQuery(() => db.notes.where('book').equals(book).toArray(), [book]) ?? []
  const hlMap = useMemo(() => new Map(highlights.map((h) => [h.key, h.color])), [highlights])
  // Every verse in this chapter covered by a bookmark, including verse ranges and whole-chapter bookmarks.
  const bmCovered = useMemo(() => {
    const m = new Map<number, string>()
    for (const b of bookmarks) for (const v of bookmarkVerses(b.key, chapter)) if (!m.has(v)) m.set(v, b.label)
    return m
  }, [bookmarks, chapter])
  const targetList = targets?.length ? targets : target ? [target] : []
  const targetKey = targetList.join(',')
  const rangeSet = useMemo(() => new Set(targetKey.includes(',') ? targetKey.split(',').map(Number) : []), [targetKey])
  const missingTargets = ch ? targetList.filter((v) => !ch.verses.some((x) => x.v === v) && !extraVerses.some((x) => x.v === v)) : []
  // every verse a note covers (a note on John 3:16-18 shows on 16, 17, and 18), keyed by verse number
  const notesByVerse = useMemo(() => {
    const m = new Map<number, VerseNote[]>()
    const first = numKey(book, chapter, 0)
    const last = numKey(book, chapter, 999)
    for (const n of notes) {
      if (n.endKey < first || n.startKey > last) continue
      const from = Math.max(n.startKey, first + 1) - first
      const to = Math.min(n.endKey, last) - first
      for (let v = from; v <= to; v++) m.set(v, [...(m.get(v) ?? []), n])
    }
    return m
  }, [notes, book, chapter])

  useEffect(() => setSel(null), [book, chapter])

  useEffect(() => {
    if (!ch) return
    const els = targetList.map((v) => document.getElementById(`v-${book}-${chapter}-${v}`)).filter((x): x is HTMLElement => !!x)
    if (els.length) {
      els[0].scrollIntoView({ block: 'center' })
      for (const el of els) {
        el.classList.remove('target')
        void el.offsetWidth
        el.classList.add('target')
      }
    } else scrollRef.current?.scrollTo({ top: 0 })
  }, [ch, book, chapter, targetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: the chapter text is a single Tab stop. Inside it, Up/Down move between verses, Left/Right move
  // word by word, Home/End jump to the first/last verse, Enter or Space selects. Whatever was last focused
  // (by keyboard or mouse) is where Tab returns.
  const roveStart = targetList[0] ?? ch?.verses[0]?.v
  const onRoveFocus = (e: React.FocusEvent<HTMLElement>) => {
    const t = e.target as HTMLElement
    if (!t.dataset.rove) return
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>('[data-rove][tabindex="0"]')) if (el !== t) el.tabIndex = -1
    t.tabIndex = 0
  }
  const onRoveKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement
    if (!t.dataset.rove || e.altKey || e.ctrlKey || e.metaKey) return
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-rove]')]
    const verses = all.filter((el) => el.dataset.rove === 'v')
    const i = all.indexOf(t)
    const verseOf = (el: HTMLElement) => el.closest('.verse')?.querySelector<HTMLElement>('[data-rove="v"]') ?? null
    let next: HTMLElement | null | undefined
    if (e.key === 'ArrowRight') next = all[i + 1]
    else if (e.key === 'ArrowLeft') next = all[i - 1]
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const cur = verseOf(t)
      const vi = cur ? verses.indexOf(cur) : -1
      next = e.key === 'ArrowDown' ? (vi < 0 ? verses[0] : verses[vi + 1]) : vi < 0 ? verses[0] : t !== cur ? cur : verses[vi - 1]
    } else if (e.key === 'Home') next = verses[0]
    else if (e.key === 'End') next = verses[verses.length - 1]
    else return
    e.preventDefault()
    if (next) {
      next.focus()
      next.scrollIntoView({ block: 'nearest' })
    }
  }

  const go = (delta: number) => {
    let bi = BOOK_INDEX[book]
    let c = chapter + delta
    if (c < 1) {
      if (bi === 0) return
      bi--
      const prev = index?.[bi]
      c = prev?.chapters.length ?? 1
    } else if (c > chapterTotal) {
      if (bi === BOOKS.length - 1) return
      bi++
      c = 1
    }
    onNavigate(BOOKS[bi].id, c)
  }

  // keyboard: [ and ] for chapters (when not typing)
  useEffect(() => {
    if (inPanel) return
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      if (e.key === '[') go(-1)
      if (e.key === ']') go(1)
      if (e.key === 'Escape') setSel(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const selRef: Ref | null = sel ? { book, chapter, verse: sel.from, endVerse: sel.to !== sel.from ? sel.to : undefined } : null
  const selectedVerses = sel && ch ? ch.verses.filter((v) => v.v >= sel.from && v.v <= sel.to) : []

  const onVerseNum = (v: number, shift: boolean) => {
    if (shift && sel) setSel({ from: Math.min(sel.from, v), to: Math.max(sel.to, v) })
    else if (sel && sel.from === v && sel.to === v) setSel(null)
    else setSel({ from: v, to: v })
    setFocusVerse({ book, chapter, verse: v })
  }

  const highlight = async (color: string | null) => {
    const removed: Highlight[] = []
    const added: string[] = []
    for (const v of selectedVerses) {
      const key = `${book}.${chapter}.${v.v}`
      const existing = await db.highlights.where('key').equals(key).first()
      if (existing) {
        await db.highlights.delete(existing.id)
        removed.push(existing)
      }
      if (color) {
        const id = uid()
        await db.highlights.add({ id, key, book, color, createdAt: Date.now() })
        added.push(id)
      }
    }
    if (removed.length) {
      const what = color ? 'Highlight changed' : removed.length === 1 ? 'Highlight removed' : `${removed.length} highlights removed`
      toastUndo(what, async () => {
        await db.highlights.bulkDelete(added)
        await db.highlights.bulkPut(removed)
      })
    }
  }

  const toggleBookmark = async () => {
    if (!selRef || !sel) return
    const key = toOsis(selRef)
    const existing = await db.bookmarks.where('key').equals(key).first()
    if (existing) {
      await db.bookmarks.delete(existing.id)
      toastUndo('Bookmark removed', () => db.bookmarks.put(existing))
    } else {
      // no duplicates: a selection already inside one bookmark is not bookmarked again
      const all = await db.bookmarks.where('book').equals(book).toArray()
      const wanted = selectedVerses.map((v) => v.v)
      const holder = all.find((b) => { const cov = bookmarkVerses(b.key, chapter); return wanted.length > 0 && wanted.every((v) => cov.includes(v)) })
      if (holder) {
        toast(`Already bookmarked as ${holder.label}`)
        return
      }
      await db.bookmarks.add({ id: uid(), key, book, label: formatRef(selRef), createdAt: Date.now() })
      toast(`Bookmarked ${formatRef(selRef)}`)
    }
  }

  const copy = async () => {
    if (!selRef) return
    const vt = (v: Verse) => (primary === 'KJV' ? verseText(v) : altVerse(primaryBook, v.v) ?? '')
    const text = selectedVerses.length === 1 ? vt(selectedVerses[0]) : selectedVerses.map((v) => `${v.v} ${vt(v)}`).join(' ')
    try {
      await navigator.clipboard.writeText(`${text}\n${formatRef(selRef)} (${primary})`)
      toast('Copied with reference')
    } catch {
      toast('Copy is blocked by this browser')
    }
  }

  const studyPassage = async () => {
    if (!selRef) return
    const id = uid()
    const now = Date.now()
    await db.studies.add({ id, title: `Study of ${formatRef(selRef)}`, passage: toOsis(selRef), translation: quoteTr(settings), sections: emptyWorksheet(), tags: [], createdAt: now, updatedAt: now })
    nav(`/study/${id}`)
  }

  const addToStudy = async () => {
    if (!sink || !selRef) return
    const tr = sink.study.translation ?? 'KJV'
    try {
      const text = passageToText(await getPassage(selRef, tr))
      sink.add('observation', { id: uid(), kind: 'scripture', ref: toOsis(selRef), text, tr })
      toast(`Added ${formatRef(selRef)} (${tr}) to Observation`)
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <div className={inPanel ? 'panel' : ''} ref={scrollRef} style={inPanel ? undefined : { height: '100%', overflow: 'auto' }}>
      <div className="reader-head">
        <label className="sr-only" htmlFor={`book-${inPanel ? 'p' : 'm'}`}>Book</label>
        <select id={`book-${inPanel ? 'p' : 'm'}`} value={book} onChange={(e) => onNavigate(e.target.value, 1)}>
          <optgroup label="Old Testament">
            {BOOKS.filter((b) => b.testament === 'OT').map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
          <optgroup label="New Testament">
            {BOOKS.filter((b) => b.testament === 'NT').map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </optgroup>
        </select>
        <label className="sr-only" htmlFor={`ch-${inPanel ? 'p' : 'm'}`}>Chapter</label>
        <select id={`ch-${inPanel ? 'p' : 'm'}`} value={chapter} onChange={(e) => onNavigate(book, parseInt(e.target.value, 10))}>
          {Array.from({ length: chapterTotal }, (_, i) => (
            <option key={i} value={i + 1}>{i + 1}</option>
          ))}
        </select>
        <button className="iconbtn" onClick={() => go(-1)} aria-label="Previous chapter" title="Previous chapter ( [ )">
          <ChevronLeft size={18} />
        </button>
        <button className="iconbtn" onClick={() => go(1)} aria-label="Next chapter" title="Next chapter ( ] )">
          <ChevronRight size={18} />
        </button>
        <label className="sr-only" htmlFor={`tr-${inPanel ? 'p' : 'm'}`}>Translation</label>
        <select id={`tr-${inPanel ? 'p' : 'm'}`} value={primary} onChange={(e) => updateSettings({ translation: e.target.value })} title="Translation" style={{ maxWidth: 110 }}>
          <option value="KJV">KJV</option>
          {tIndex?.map((t) => (
            <option key={t.id} value={t.id}>{t.id}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`cmp-${inPanel ? 'p' : 'm'}`}>Compare with</label>
        <select id={`cmp-${inPanel ? 'p' : 'm'}`} value={compare} onChange={(e) => updateSettings({ compareWith: e.target.value })} title="Compare with another translation" style={{ maxWidth: 130 }}>
          <option value="">Compare…</option>
          {['KJV', ...(tIndex?.map((t) => t.id) ?? [])]
            .filter((id) => id !== primary)
            .map((id) => (
              <option key={id} value={id}>vs {id}</option>
            ))}
        </select>
        <span className="spacer" />
        <button className="iconbtn" aria-pressed={settings.showTagged} onClick={() => updateSettings({ showTagged: !settings.showTagged })} title="Underline words with Strong's numbers" aria-label="Underline words with Strong's numbers">
          <Link2 size={17} />
        </button>
        <button className="iconbtn" aria-pressed={settings.showMarginNotes} onClick={() => updateSettings({ showMarginNotes: !settings.showMarginNotes })} title="Show 1611 translators' margin notes" aria-label="Show translators' margin notes">
          <StickyNote size={17} />
        </button>
        <button className="iconbtn" aria-pressed={settings.redLetters} onClick={() => updateSettings({ redLetters: !settings.redLetters })} title="Words of Jesus in red" aria-label="Words of Jesus in red" style={{ color: settings.redLetters ? 'var(--red-letter)' : undefined, fontWeight: 700, fontFamily: 'var(--scripture-font)' }}>
          A
        </button>
        <button className="iconbtn" onClick={() => updateSettings({ readerSize: Math.max(14, settings.readerSize - 1) })} aria-label="Smaller text" title="Smaller text">
          <span style={{ fontSize: 12 }}>A−</span>
        </button>
        <button className="iconbtn" onClick={() => updateSettings({ readerSize: Math.min(30, settings.readerSize + 1) })} aria-label="Larger text" title="Larger text">
          <span style={{ fontSize: 16 }}>A+</span>
        </button>
      </div>

      {loading && !ch && <Loading label={`Loading ${bookName} ${chapter}`} />}
      {error && (
        <div style={{ padding: 16 }}>
          <ErrorBox
            error={
              typeof navigator !== 'undefined' && !navigator.onLine
                ? new Error(`${bookName} ${chapter} is not saved on this device yet. Connect to the internet, or download Bibles for offline reading in Settings.`)
                : error
            }
            onRetry={reload}
          />
        </div>
      )}
      {!chapterExists && (
        <div style={{ padding: 16 }}>
          <ErrorBox error={new Error(`${bookName} has ${chapterTotal} chapters. Chapter ${chapter} does not exist.`)} />
        </div>
      )}
      {ch && (
        <article
          className={`reader ${settings.redLetters ? 'red-on' : ''} ${settings.showTagged ? 'show-tags' : ''}`}
          aria-label={`${bookName} chapter ${chapter}, ${primary === 'KJV' ? 'King James Version' : tIndex?.find((t) => t.id === primary)?.name ?? primary}`}
          onFocus={onRoveFocus}
          onKeyDown={onRoveKey}
        >
          <p className="sr-only" id={`rove-help-${inPanel ? 'p' : 'm'}`}>
            Use the up and down arrow keys to move between verses, and left and right to move word by word. Press Enter to select.
          </p>
          <h1 className="chapter-title">
            {bookName.toUpperCase()} {chapter}
            {primary !== 'KJV' && <span className="muted" style={{ fontSize: '0.75em' }}> · {primary}</span>}
          </h1>
          {primary !== 'KJV' && (
            <div className="notice info" style={{ fontFamily: 'var(--ui-font)', fontSize: 'calc(var(--ui-size) * 0.85)', marginBottom: 12, lineHeight: 1.45 }}>
              {tIndex?.find((t) => t.id === primary)?.name}. To click words for Hebrew and Greek, switch to KJV. Notes and highlights work in every translation.
            </div>
          )}
          {(primaryErr || compareErr) && <ErrorBox error={(primaryErr ?? compareErr)!} />}
          {missingTargets.length > 0 && (
            <div className="notice warn" role="status" data-testid="missing-verse" style={{ fontFamily: 'var(--ui-font)', fontSize: 'calc(var(--ui-size) * 0.9)', marginBottom: 12 }}>
              {bookName} {chapter} has {ch.verses.length} verses, so {missingTargets.length === 1 ? `verse ${missingTargets[0]} does` : `verses ${missingTargets.join(', ')} do`} not exist. Showing the whole chapter.
            </div>
          )}
          {ch.title && primary === 'KJV' && (
            <p className="psalm-title">
              <Segments segs={ch.title} verse={null} book={book} chapter={chapter} />
            </p>
          )}
          {ch.verses.map((v) => {
            const key = `${book}.${chapter}.${v.v}`
            const hl = hlMap.get(key)
            const isSel = sel && v.v >= sel.from && v.v <= sel.to
            const vnotes = notesByVerse.get(v.v) ?? []
            return (
              <Fragment key={v.v}>
                {v.h && <div className="acrostic">{v.h}</div>}
                <span id={`v-${book}-${chapter}-${v.v}`} className={`verse vline ${v.p ? 'paragraph' : ''} ${hl ? 'hl-' + hl : ''} ${isSel ? 'selected' : ''} ${rangeSet.has(v.v) ? 'in-range' : ''}`}>
                  <button className="vnum" data-rove="v" tabIndex={v.v === roveStart ? 0 : -1} onClick={(e) => onVerseNum(v.v, e.shiftKey)} aria-label={`Select verse ${v.v}`} aria-pressed={!!isSel} aria-describedby={v.v === roveStart ? `rove-help-${inPanel ? 'p' : 'm'}` : undefined}>
                    {v.v}
                  </button>
                  {primary === 'KJV' ? (
                    <Segments segs={v.s} verse={v} book={book} chapter={chapter} selection={selection} onSelect={select} />
                  ) : (
                    <span>{altVerse(primaryBook, v.v) ?? (primaryBook ? <em className="muted">(This verse is not in the {primary}.)</em> : '')}</span>
                  )}
                  {(bmCovered.has(v.v) || vnotes.length > 0) && (
                    <span className="vmarks" aria-label={`${bmCovered.has(v.v) ? `Bookmarked (${bmCovered.get(v.v)}). ` : ''}${vnotes.length ? vnotes.length + ' note(s)' : ''}`}>
                      {bmCovered.has(v.v) && <Bookmark size={11} aria-hidden />}
                      {vnotes.length > 0 && (
                        <button
                          className="reflink"
                          data-rove="n"
                          tabIndex={-1}
                          style={{ fontSize: 'inherit', display: 'inline-flex' }}
                          onClick={() => {
                            setFocusVerse({ book, chapter, verse: v.v })
                            setTool('notes')
                            setToolsOpen(true)
                          }}
                          aria-label={`Open ${vnotes.length === 1 ? 'the note' : `${vnotes.length} notes`} for verse ${v.v}`}
                        >
                          <NotebookPen size={11} aria-hidden />
                        </button>
                      )}
                    </span>
                  )}
                  {compare && (
                    <span className="compare-line">
                      <span className="tag">{compare}</span>
                      {compare === 'KJV' ? verseText(v) : altVerse(compareBook, v.v) ?? <em>(not in this translation)</em>}
                    </span>
                  )}
                  {primary === 'KJV' && settings.showMarginNotes &&
                    v.n?.map((n, i) => (
                      <span key={i} className="marg-note">
                        <em>{n[0]}</em>: {n[1]} <span className="badge" title="Marginal note carried in the KJV source">margin</span>
                      </span>
                    ))}
                </span>
              </Fragment>
            )
          })}
          {continues && (
            <p className="no-print" style={{ fontFamily: 'var(--ui-font)', fontSize: 'var(--ui-size)', marginTop: 16 }} data-testid="passage-continues">
              <Link to={`/bible/${book}/${continues.chapter}/${continues.spec}`}>
                The passage continues in {formatRef({ book, chapter: continues.chapter, verse: 1, endChapter: continues.toChapter, endVerse: continues.toVerse })} →
              </Link>
            </p>
          )}
          {extraVerses.map((x) => (
            <span key={`x${x.v}`} className="verse vline">
              <span className="vnum" style={{ cursor: 'default' }}>{x.v}</span> {x.t}
            </span>
          ))}
          <div className="row no-print" style={{ justifyContent: 'space-between', marginTop: 24, fontFamily: 'var(--ui-font)', fontSize: 'var(--ui-size)' }}>
            <button className="btn" onClick={() => go(-1)}>
              <ChevronLeft size={16} /> Previous
            </button>
            <span className="muted small">{primary === 'KJV' ? "KJV · Strong's tagging from CrossWire" : `${tIndex?.find((t) => t.id === primary)?.name} (${tIndex?.find((t) => t.id === primary)?.license})`}</span>
            <button className="btn" onClick={() => go(1)}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </article>
      )}

      {sel && selRef && (
        <div className="verse-actions no-print" role="toolbar" aria-label={`Actions for ${formatRef(selRef)}`}>
          <strong style={{ marginRight: 6 }}>{formatRef(selRef)}</strong>
          <Highlighter size={16} className="muted" aria-hidden />
          {HL_COLORS.map((c) => (
            <button key={c} className={`swatch hl-${c}`} onClick={() => highlight(c)} aria-label={`Highlight ${c}`} title={`Highlight ${c}`} />
          ))}
          <button className="iconbtn" onClick={() => highlight(null)} aria-label="Remove highlight" title="Remove highlight">
            <X size={16} />
          </button>
          <button className="btn sm" onClick={toggleBookmark} aria-pressed={!!selRef && bookmarks.some((b) => b.key === toOsis(selRef))}>
            <Bookmark size={15} /> Bookmark
          </button>
          <button className="btn sm" onClick={() => setNoteFor(selRef)}>
            <NotebookPen size={15} /> Note
          </button>
          <button className="btn sm" onClick={copy}>
            <Copy size={15} /> Copy
          </button>
          <button
            className="btn sm"
            onClick={() => {
              setFocusVerse({ book, chapter, verse: sel.from })
              setTool('xrefs')
              setToolsOpen(true)
            }}
          >
            <Link2 size={15} /> Cross-refs
          </button>
          {sink ? (
            <button className="btn sm primary" onClick={addToStudy}>
              <Plus size={15} /> Add to study
            </button>
          ) : (
            <button className="btn sm primary" onClick={studyPassage}>
              <BookOpen size={15} /> Study this passage
            </button>
          )}
          <span className="spacer" />
          <span className="muted small">Shift+click a verse number to extend</span>
          <button className="iconbtn" onClick={() => setSel(null)} aria-label="Clear selection">
            <X size={16} />
          </button>
        </div>
      )}
      <NoteDialog target={noteFor} onClose={() => setNoteFor(null)} />
    </div>
  )
}

/* ---------- Word segments ---------- */

function Segments({
  segs,
  verse,
  book,
  chapter,
  selection,
  onSelect,
}: {
  segs: Segment[]
  verse: Verse | null
  book: string
  chapter: number
  selection?: import('../lib/state').WordSelection | null
  onSelect?: (s: import('../lib/state').WordSelection) => void
}) {
  // words in the same split group (one original word rendered in two places) highlight together
  const selectedWords = new Set<number>()
  if (verse && selection && selection.book === book && selection.chapter === chapter && selection.verse === verse.v) {
    if (selection.word >= 0) {
      selectedWords.add(selection.word)
      const info = verse.w ? parseWord(verse.w[selection.word]) : null
      if (info?.split) verse.w!.forEach((w, i) => parseWord(w).split === info.split && parseWord(w).strongs.join() === info.strongs.join() && selectedWords.add(i))
    }
  }
  return (
    <>
      {segs.map((s, i) => {
        const flags = s[1] ?? 0
        const wi = s[2]
        const text = s[0]
        const cls = [flags & FLAG_ADDED ? 'added' : '', flags & FLAG_RED ? 'red' : '', flags & FLAG_DIVINE ? 'divine' : ''].filter(Boolean).join(' ')
        const clickable = verse && onSelect && /[A-Za-z]/.test(text)
        if (!clickable) return cls ? <span key={i} className={cls}>{text}</span> : <Fragment key={i}>{text}</Fragment>
        const isSel = (wi !== undefined && selectedWords.has(wi)) || (wi === undefined && selection?.verse === verse.v && selection?.segIndex === i && selection.chapter === chapter && selection.book === book)
        const tagged = wi !== undefined && !!verse.w && parseWord(verse.w[wi]).strongs.length > 0
        const label = tagged ? `${segText(s)}: show Hebrew or Greek word` : flags & FLAG_ADDED ? `${segText(s)}: words added by the translators` : segText(s)
        const activate = () => onSelect!({ book, chapter, verse: verse.v, word: wi ?? -1, english: segText(s), segIndex: i })
        return (
          <span
            key={i}
            role="button"
            tabIndex={-1}
            data-rove="w"
            aria-label={label}
            className={`w ${cls} ${isSel ? 'sel' : ''}`}
            onClick={activate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activate()
              }
            }}
          >
            {text}
          </span>
        )
      })}
    </>
  )
}

/* ---------- Notes ---------- */

export function NoteDialog({ target, onClose, existing }: { target: Ref | null; onClose: () => void; existing?: VerseNote }) {
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')
  useEffect(() => {
    setText(existing?.text ?? '')
    setTags(existing?.tags.join(', ') ?? '')
  }, [existing, target])
  if (!target) return <Dialog open={false} onClose={onClose} title="Note">{null}</Dialog>
  const save = async () => {
    const now = Date.now()
    const endV = target.endVerse ?? target.verse ?? 1
    const rec: VerseNote = {
      id: existing?.id ?? uid(),
      ref: toOsis(target),
      book: target.book,
      startKey: numKey(target.book, target.chapter, target.verse ?? 1),
      endKey: numKey(target.book, target.endChapter ?? target.chapter, endV),
      text: text.trim(),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    if (!rec.text) return onClose()
    await db.notes.put(rec)
    toast('Note saved')
    onClose()
  }
  return (
    <Dialog open={!!target} onClose={onClose} title={`${existing ? 'Edit note' : 'Note'} on ${formatRef(target)}`}>
      <div className="stack">
        <label className="field">
          <span>Your note (references like Rom 5:8 become links)</span>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
        </label>
        {text && (
          <div className="small">
            <LinkedText text={text} />
          </div>
        )}
        <label className="field">
          <span>Tags (comma separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="faith, grace" />
        </label>
        <div className="row">
          <button className="btn primary" onClick={save}>Save note</button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  )
}

export type { Book }

/** Verse numbers in `chapter` covered by a bookmark key ("John.3.16", "John.3.16-John.3.17", "Gen.1.1-Gen.2.3", "Ps.23"). */
function bookmarkVerses(key: string, chapter: number, max = 200): number[] {
  const r = parseOsis(key)
  if (!r) return []
  const endC = r.endChapter ?? r.chapter
  if (chapter < r.chapter || chapter > endC) return []
  const from = chapter === r.chapter ? (r.verse ?? 1) : 1
  let to = max
  if (chapter === endC) to = r.endVerse ?? (r.endChapter === undefined && r.verse !== undefined ? r.verse : max)
  const out: number[] = []
  for (let v = from; v <= Math.min(to, max); v++) out.push(v)
  return out
}
