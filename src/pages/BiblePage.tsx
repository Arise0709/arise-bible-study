import { Suspense, lazy, useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { X } from 'lucide-react'
import { Reader } from '../components/Reader'
import { ToolsPane } from '../components/ToolsPane'
import { useMediaQuery } from '../components/ui'
import { BOOK_BY_ID, parseCrossSpec, parseVerseSpec, resolveBook } from '../lib/refs'
import { loadBookIndex } from '../lib/data'
import { useAsync } from '../components/ui'
import { useStudy } from '../lib/state'
import { db, recordSession } from '../db/db'

// Reading-plan pieces load only when a plan is in use, so plain Bible reading stays as light as before.
const PlanBar = lazy(() => import('./PlanPages').then((m) => ({ default: m.PlanBar })))
const TodaysReadingLine = lazy(() => import('./PlanPages').then((m) => ({ default: m.TodaysReadingLine })))

export function BiblePage() {
  const params = useParams()
  const nav = useNavigate()
  const book = resolveBook(params.book ?? '') ?? 'John'
  const chapter = Math.max(1, parseInt(params.chapter ?? '1', 10) || 1)
  // "16", "28-39", or "16,18": every verse listed is highlighted.
  // "1-2:3" runs into a later chapter: verses to the end of this chapter, then a link onward.
  const { data: index } = useAsync(loadBookIndex, [])
  // set when a passage was opened from a cross-reference: offer the way back
  const backTo = (useLocation().state as { from?: { book: string; chapter: number; verse?: number } } | null)?.from
  const cross = parseCrossSpec(params.verse)
  const lastVerse = index?.find((b) => b.id === book)?.chapters[chapter - 1]
  const verses = cross
    ? Array.from({ length: Math.max(1, (lastVerse ?? cross.from) - cross.from + 1) }, (_, i) => cross.from + i)
    : parseVerseSpec(params.verse)
  const verse = verses[0]
  const spec = params.verse && verses.length ? params.verse : undefined
  const continues =
    cross && cross.toChapter > chapter
      ? { chapter: chapter + 1, spec: cross.toChapter === chapter + 1 ? `1-${cross.toVerse}` : `1-${cross.toChapter}:${cross.toVerse}`, toChapter: cross.toChapter, toVerse: cross.toVerse }
      : undefined
  const wide = useMediaQuery('(min-width: 901px)')
  const { toolsOpen, setToolsOpen } = useStudy()

  useEffect(() => {
    if (params.book && resolveBook(params.book) !== params.book) nav(`/bible/${book}/${chapter}${spec ? '/' + spec : ''}`, { replace: true })
    recordSession('bible', `/bible/${book}/${chapter}`, `${BOOK_BY_ID[book].name} ${chapter}`)
    document.title = `${BOOK_BY_ID[book].name} ${chapter} · Arise Bible Study`
  }, [book, chapter, spec, params.book, nav])

  const [sp] = useSearchParams()
  const planId = sp.get('plan')
  const sessionId = sp.get('s')
  // only look for "today's reading" when a plan asks to be shown
  const [hasReminders, setHasReminders] = useState(false)
  useEffect(() => {
    if (planId) return
    db.plans
      .where('status')
      .equals('active')
      .filter((p) => p.remind)
      .count()
      .then((n) => setHasReminders(n > 0))
      .catch(() => setHasReminders(false))
  }, [planId])
  const banner = planId && sessionId ? (
    <Suspense fallback={null}>
      <PlanBar planId={planId} sessionId={sessionId} book={book} chapter={chapter} />
    </Suspense>
  ) : hasReminders ? (
    <Suspense fallback={null}>
      <TodaysReadingLine />
    </Suspense>
  ) : null

  const onNavigate = (b: string, c: number, v?: number) => nav(`/bible/${b}/${c}${v ? '/' + v : ''}`)
  const reader = <Reader book={book} chapter={chapter} target={verse} targets={verses} continues={continues} backTo={backTo} onNavigate={onNavigate} banner={banner} />

  if (wide) {
    return (
      <Group orientation="horizontal" id="bible-layout" style={{ height: '100%' }}>
        <Panel id="scripture" defaultSize="62%" minSize="35%">
          {reader}
        </Panel>
        <Separator className="resize-handle" aria-label="Resize panels" />
        <Panel id="tools" defaultSize="38%" minSize="24%">
          <ToolsPane />
        </Panel>
      </Group>
    )
  }
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {reader}
      {toolsOpen && (
        <div role="dialog" aria-label="Study tools" style={{ position: 'absolute', inset: '12% 0 0 0', background: 'var(--surface)', borderTop: '1px solid var(--border)', borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 30px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', zIndex: 10 }}>
          <div className="row" style={{ justifyContent: 'center', padding: '6px 8px 0' }}>
            <span className="spacer" />
            <button className="iconbtn" onClick={() => setToolsOpen(false)} aria-label="Close study tools">
              <X size={20} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ToolsPane />
          </div>
        </div>
      )}
    </div>
  )
}
