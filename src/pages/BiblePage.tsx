import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { X } from 'lucide-react'
import { Reader } from '../components/Reader'
import { ToolsPane } from '../components/ToolsPane'
import { useMediaQuery } from '../components/ui'
import { BOOK_BY_ID, resolveBook } from '../lib/refs'
import { useStudy } from '../lib/state'
import { recordSession } from '../db/db'

export function BiblePage() {
  const params = useParams()
  const nav = useNavigate()
  const book = resolveBook(params.book ?? '') ?? 'John'
  const chapter = Math.max(1, parseInt(params.chapter ?? '1', 10) || 1)
  const verse = params.verse ? parseInt(params.verse, 10) : undefined
  const wide = useMediaQuery('(min-width: 901px)')
  const { toolsOpen, setToolsOpen } = useStudy()

  useEffect(() => {
    if (params.book && resolveBook(params.book) !== params.book) nav(`/bible/${book}/${chapter}${verse ? '/' + verse : ''}`, { replace: true })
    recordSession('bible', `/bible/${book}/${chapter}`, `${BOOK_BY_ID[book].name} ${chapter}`)
    document.title = `${BOOK_BY_ID[book].name} ${chapter} · Arise Bible Study`
  }, [book, chapter, verse, params.book, nav])

  const onNavigate = (b: string, c: number, v?: number) => nav(`/bible/${b}/${c}${v ? '/' + v : ''}`)
  const reader = <Reader book={book} chapter={chapter} target={verse} onNavigate={onNavigate} />

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
