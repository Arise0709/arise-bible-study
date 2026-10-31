import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { BookOpen, Download, FileText, Mic, Plus, Trash2 } from 'lucide-react'
import { Reader } from '../components/Reader'
import { ToolsPane } from '../components/ToolsPane'
import { BlockLegend, BlockList, TranslationSelect, retranslateBlocks } from '../components/Blocks'
import { Dialog, Empty, ErrorBox, Loading, SaveIndicator, downloadBlob, slug, timeAgo, toast, useAsync, useMediaQuery } from '../components/ui'
import { LinkedText } from '../components/Scripture'
import { getPassage, passageToText } from '../lib/data'
import { formatRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import { StudySinkCtx, quoteTr, useStudy, type StudySink } from '../lib/state'
import { WORKSHEET_SECTIONS, db, emptyWorksheet, recordSession, uid, type Block, type Study, type WorksheetKey } from '../db/db'
import { pdfExport, studyToDoc, toMarkdown, wordExport } from '../export/doc'
import { createSermonFromStudy } from './sermonTemplates'
import { guardedPut, useAutosave } from '../lib/autosave'
import { ConflictBanner, useWatchRecord } from '../components/Conflict'

export function StudyStart() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const recent = useLiveQuery(() => db.studies.orderBy('updatedAt').reverse().limit(8).toArray(), []) ?? []
  const { settings } = useStudy()
  const start = async () => {
    const r = parseRef(q)
    if (!r) return setErr('Enter a passage such as Romans 5:1-11 or Psalm 23.')
    try {
      await getPassage(r)
    } catch (e) {
      return setErr((e as Error).message)
    }
    const id = uid()
    const now = Date.now()
    await db.studies.add({ id, title: `Study of ${formatRef(r)}`, passage: toOsis(r), translation: quoteTr(settings), sections: emptyWorksheet(), tags: [], createdAt: now, updatedAt: now })
    nav(`/study/${id}`)
  }
  return (
    <div className="page stack">
      <h1>Study Workspace</h1>
      <p className="muted">Open a passage with the Bible text, word tools, and your worksheet side by side.</p>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault()
          start()
        }}
      >
        <label className="field">
          <span>Passage to study</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="John 3:1-21" autoFocus />
        </label>
        {err && <div className="notice error">{err}</div>}
        <div>
          <button className="btn primary">
            <Plus size={16} /> Start a new study
          </button>
        </div>
      </form>
      <h2>Continue a study</h2>
      {!recent.length && <Empty>No studies yet.</Empty>}
      <ul className="list">
        {recent.map((s) => (
          <li key={s.id} className="row">
            <Link to={`/study/${s.id}`}>{s.title}</Link>
            <span className="muted small">{formatRef(parseOsis(s.passage)!)} · edited {timeAgo(s.updatedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WorkspacePage() {
  const { id } = useParams()
  const study = useLiveQuery(() => db.studies.get(id ?? ''), [id])
  const loaded = useLiveQuery(() => db.studies.get(id ?? '').then((s) => ({ found: !!s })), [id])
  if (!loaded) return <Loading label="Opening study" />
  if (!loaded.found || !study)
    return (
      <div className="page">
        <ErrorBox error={new Error('This study was not found. It may have been deleted, or it was saved in a different browser.')} />
        <p>
          <Link to="/study">Start or open a study</Link>
        </p>
      </div>
    )
  return <Workspace key={study.id} initial={study} />
}

function Workspace({ initial }: { initial: Study }) {
  const [study, setStudy] = useState<Study>(initial)
  const passage = parseOsis(study.passage)
  const [loc, setLoc] = useState({ book: passage?.book ?? 'John', chapter: passage?.chapter ?? 1, verse: passage?.verse })
  const wide = useMediaQuery('(min-width: 901px)')
  const [mobileTab, setMobileTab] = useState<'scripture' | 'tools' | 'notes'>('scripture')
  const { selection, toolsOpen, setFocusVerse, select } = useStudy()
  // the tools follow this study's passage, not a verse chosen earlier elsewhere
  useEffect(() => {
    if (passage) setFocusVerse({ book: passage.book, chapter: passage.chapter, verse: passage.verse ?? 1 })
    select(null)
  }, [initial.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // `base` is the stored version this tab is editing; saves never overwrite a newer one from another tab
  const base = useRef(initial.updatedAt ?? 0)
  const autosave = useAutosave(study, (v: Study) => guardedPut('studies', v, base), `studies:${initial.id}`, 600, base)
  useWatchRecord<Study>('studies', initial.id, base, autosave, setStudy, 'study')
  const nav = useNavigate()

  useEffect(() => {
    recordSession('study', `/study/${study.id}`, study.title)
    document.title = `${study.title} · Arise Bible Study`
  }, [study.id, study.title])

  // switch to tools on mobile when a word is chosen
  useEffect(() => {
    if (!wide && selection) setMobileTab('tools')
  }, [selection, wide])
  useEffect(() => {
    if (!wide && toolsOpen) setMobileTab('tools')
  }, [toolsOpen, wide])

  const update = useCallback((fn: (s: Study) => Study) => {
    setStudy((s) => fn(s))
  }, [])

  const sink: StudySink = useMemo(
    () => ({
      studyId: study.id,
      study,
      add: (section: string, block: Block) => update((s) => ({ ...s, sections: { ...s.sections, [section]: [...(s.sections[section as WorksheetKey] ?? []), block] } })),
      showPassage: (r: { book: string; chapter: number; verse?: number }) => {
        setLoc({ book: r.book, chapter: r.chapter, verse: r.verse })
        if (!wide) setMobileTab('scripture')
      },
    }),
    [study, update, wide],
  )

  const reader = <Reader inPanel book={loc.book} chapter={loc.chapter} target={loc.verse} onNavigate={(b, c, v) => setLoc({ book: b, chapter: c, verse: v })} />
  const sheet = <Worksheet study={study} update={update} autosave={autosave} onGoToPassage={() => passage && setLoc({ book: passage.book, chapter: passage.chapter, verse: passage.verse })} />

  return (
    <StudySinkCtx.Provider value={sink}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: autosave.conflict ? '0 12px' : 0 }}>
        <ConflictBanner table="studies" noun="study" value={study} base={base} autosave={autosave} onUseTheirs={setStudy} onClose={() => { autosave.discard(); nav('/studies') }} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
      {wide ? (
        <Group orientation="horizontal" id="workspace-layout" style={{ height: '100%' }}>
          <Panel id="ws-scripture" defaultSize="36%" minSize="22%">
            {reader}
          </Panel>
          <Separator className="resize-handle" aria-label="Resize Scripture panel" />
          <Panel id="ws-tools" defaultSize="28%" minSize="20%">
            <ToolsPane />
          </Panel>
          <Separator className="resize-handle" aria-label="Resize notes panel" />
          <Panel id="ws-notes" defaultSize="36%" minSize="24%">
            {sheet}
          </Panel>
        </Group>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="mobile-switch" role="tablist" aria-label="Workspace panels">
            {(['scripture', 'tools', 'notes'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={mobileTab === t} onClick={() => setMobileTab(t)}>
                {t === 'scripture' ? 'Scripture' : t === 'tools' ? 'Study Tools' : 'Notes'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {mobileTab === 'scripture' && reader}
            {mobileTab === 'tools' && <ToolsPane />}
            {mobileTab === 'notes' && sheet}
          </div>
        </div>
      )}
      </div>
      </div>
    </StudySinkCtx.Provider>
  )
}

function Worksheet({ study, update, autosave, onGoToPassage }: { study: Study; update: (fn: (s: Study) => Study) => void; autosave: ReturnType<typeof useAutosave<Study>>; onGoToPassage: () => void }) {
  const nav = useNavigate()
  const passage = parseOsis(study.passage)
  const tr = study.translation ?? 'KJV'
  const { data: verses, error } = useAsync(() => (passage ? getPassage(passage, tr) : Promise.reject(new Error('No passage set.'))), [study.passage, tr])
  const [updating, setUpdating] = useState(false)
  const changeTranslation = async (next: string) => {
    setUpdating(true)
    const missing: string[] = []
    const sections = { ...study.sections }
    for (const k of Object.keys(sections) as WorksheetKey[]) {
      const r = await retranslateBlocks(sections[k], next)
      sections[k] = r.blocks
      missing.push(...r.missing)
    }
    update((s) => ({ ...s, translation: next, sections }))
    setUpdating(false)
    toast(missing.length ? `Updated to ${next}. Not found in ${next}: ${missing.join(', ')}` : `All Scripture in this study now quotes the ${next}`)
  }
  const [editPassage, setEditPassage] = useState(false)
  const [pq, setPq] = useState(passage ? formatRef(passage) : '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const exportAs = async (kind: 'md' | 'docx' | 'pdf') => {
    try {
      const doc = studyToDoc(study, verses ? passageToText(verses) : undefined)
      const name = slug(study.title)
      if (kind === 'md') downloadBlob(new Blob([toMarkdown(doc)], { type: 'text/markdown' }), `${name}.md`)
      if (kind === 'docx') downloadBlob(await wordExport(doc, { kind: 'Study Notes', series: 'Bible Study' }), `${name}.docx`)
      if (kind === 'pdf') downloadBlob(await pdfExport(doc, { kind: 'Study Notes', series: 'Bible Study' }), `${name}.pdf`)
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`)
    }
  }

  return (
    <div className="panel" aria-label="Study notes">
      <div className="reader-head">
        <h2 style={{ fontSize: 'inherit', margin: 0 }}>Guided breakdown</h2>
        <SaveIndicator autosave={autosave} />
        <span className="spacer" />
        <button className="btn sm" onClick={() => exportAs('md')} title="Export Markdown"><Download size={14} /> .md</button>
        <button className="btn sm" onClick={() => exportAs('docx')} title="Export Word"><FileText size={14} /> .docx</button>
        <button className="btn sm" onClick={() => exportAs('pdf')} title="Export PDF"><FileText size={14} /> .pdf</button>
      </div>
      <div className="panel-body">
        <label className="sr-only" htmlFor="study-title">Study title</label>
        <input id="study-title" value={study.title} onChange={(e) => update((s) => ({ ...s, title: e.target.value }))} style={{ width: '100%', fontSize: '1.3rem', fontWeight: 700, border: '1px solid transparent', background: 'transparent' }} />
        <div className="row" style={{ margin: '8px 0' }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Tags</span>
            <input value={study.tags.join(', ')} onChange={(e) => update((s) => ({ ...s, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) }))} placeholder="faith, Romans series" />
          </label>
        </div>
        <div className="row" style={{ alignItems: 'flex-end', margin: '0 0 8px' }}>
          <div style={{ minWidth: 220, flex: 1 }}>
            <TranslationSelect id="study-tr" label="Quote Scripture in" value={tr} onChange={changeTranslation} />
          </div>
          {updating && <span className="muted small">Updating quotes…</span>}
        </div>
        <BlockLegend />

        <section className="ws-section" style={{ marginTop: 16 }}>
          <header>
            <h3>Passage</h3>
            <span className="muted small">Reference and KJV text</span>
            <span className="spacer" />
            <button className="btn sm ghost" onClick={onGoToPassage}><BookOpen size={14} /> Show in reader</button>
            <button className="btn sm ghost" onClick={() => setEditPassage(!editPassage)}>Change</button>
          </header>
          {editPassage && (
            <form
              className="row"
              style={{ marginBottom: 8 }}
              onSubmit={async (e) => {
                e.preventDefault()
                const r = parseRef(pq)
                if (!r) return toast('Enter a reference like Romans 8:28-39')
                try {
                  await getPassage(r, tr)
                  update((s) => ({ ...s, passage: toOsis(r) }))
                  setEditPassage(false)
                } catch (err) {
                  toast((err as Error).message)
                }
              }}
            >
              <input value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Passage reference" />
              <button className="btn sm primary">Set passage</button>
            </form>
          )}
          {error && <ErrorBox error={error} />}
          {verses && passage && (
            <div className="block scripture">
              <div className="block-label">Scripture · {formatRef(passage)} ({tr})</div>
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {verses.map((v) => (
                  <span key={`${v.chapter}.${v.verse}`}>
                    <sup className="muted">{v.chapter !== passage.chapter || passage.endChapter ? `${v.chapter}:` : ''}{v.verse}</sup> {v.text}{' '}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        {WORKSHEET_SECTIONS.map((sec) => (
          <section className="ws-section" key={sec.key}>
            <header>
              <h3>{sec.title}</h3>
            </header>
            <div className="muted small" style={{ marginBottom: 6 }}>{sec.hint}</div>
            <BlockList
              blocks={study.sections[sec.key]}
              onChange={(b) => update((s) => ({ ...s, sections: { ...s.sections, [sec.key]: b } }))}
              addKinds={sec.key === 'crossRefs' ? ['xref', 'note'] : ['note', 'scripture']}
              defaultXrefFrom={study.passage}
              tr={tr}
              emptyHint={
                sec.key === 'wordStudy'
                  ? 'Click a word in the Scripture panel, then “Add to study” on its Strong\'s entry.'
                  : sec.key === 'crossRefs'
                    ? 'Use the Cross-refs tool, or add one here, then explain the connection.'
                    : sec.key === 'context'
                      ? 'Add background in your own words, or add an excerpt from the Dictionary tool (it will be cited).'
                      : undefined
              }
            />
          </section>
        ))}

        <div className="row" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <button
            className="btn primary"
            onClick={async () => {
              const id = await createSermonFromStudy(study)
              nav(`/sermons/${id}`)
            }}
          >
            <Mic size={15} /> Turn into sermon or lesson
          </button>
          <span className="spacer" />
          <button className="btn danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete study
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}>
          <LinkedText text="Tip: references you type in notes, like Heb 11:1, link to the Bible reader automatically." />
        </p>
      </div>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this study?">
        <p>“{study.title}” will be deleted from this browser. Sermons made from it are kept.</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              autosave.discard()
              await db.studies.delete(study.id)
              nav('/studies')
            }}
          >
            Delete
          </button>
          <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      </Dialog>
    </div>
  )
}
