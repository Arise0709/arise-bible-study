import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Download, FileText, FolderPlus, GripVertical, MonitorPlay, Plus, Printer, Trash2 } from 'lucide-react'
import { BlockLegend, BlockList, BlockView, TranslationSelect, retranslateBlocks } from '../components/Blocks'
import { Dialog, Empty, ErrorBox, Loading, SaveIndicator, downloadBlob, slug, timeAgo, toast, useAsync } from '../components/ui'
import { LinkedText, ScriptureRef } from '../components/Scripture'
import { getPassage, passageToText } from '../lib/data'
import { formatRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import { quoteTr, useStudy } from '../lib/state'
import { db, recordSession, uid, type Sermon, type SermonSection } from '../db/db'
import { pdfExport, sermonToDoc, toMarkdown, wordExport } from '../export/doc'
import { SECTION_TYPES, TEMPLATES, newSermon } from './sermonTemplates'
import { guardedPut, useAutosave } from '../lib/autosave'
import { ConflictBanner, useWatchRecord } from '../components/Conflict'

/* ================= List ================= */

export function SermonsPage() {
  const nav = useNavigate()
  const sermons = useLiveQuery(() => db.sermons.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const folders = useLiveQuery(() => db.folders.where('kind').equals('sermon').toArray(), []) ?? []
  const [folder, setFolder] = useState<string>('all')
  const [status, setStatus] = useState<string>('all')
  const [q, setQ] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderOpen, setFolderOpen] = useState(false)

  const shown = sermons.filter(
    (s) =>
      (folder === 'all' || (folder === 'none' ? !s.folderId : s.folderId === folder)) &&
      (status === 'all' || s.status === status) &&
      (!q || [s.title, s.mainIdea, ...s.tags].join(' ').toLowerCase().includes(q.toLowerCase())),
  )

  const { settings } = useStudy()
  const create = async (template: string) => {
    const s = newSermon(template, folder !== 'all' && folder !== 'none' ? folder : undefined, quoteTr(settings))
    await db.sermons.add(s)
    nav(`/sermons/${s.id}`)
  }

  return (
    <div className="page stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Sermons &amp; Lessons</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => setFolderOpen(true)}>
          <FolderPlus size={16} /> New folder
        </button>
        <button className="btn primary" onClick={() => setNewOpen(true)}>
          <Plus size={16} /> New outline
        </button>
      </div>
      <div className="row">
        <label className="sr-only" htmlFor="sq">Search outlines</label>
        <input id="sq" type="search" placeholder="Search titles, ideas, tags" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <label className="sr-only" htmlFor="sf">Folder</label>
        <select id="sf" value={folder} onChange={(e) => setFolder(e.target.value)}>
          <option value="all">All folders</option>
          <option value="none">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ss">Status</label>
        <select id="ss" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Drafts and ready</option>
          <option value="draft">Drafts</option>
          <option value="ready">Ready to teach</option>
        </select>
      </div>
      {!sermons.length && (
        <Empty>
          No outlines yet. Start from a template, or open a study in the Study Workspace and choose “Turn into sermon or lesson”.
        </Empty>
      )}
      <ul className="list">
        {shown.map((s) => (
          <li key={s.id}>
            <div className="row">
              <Link to={`/sermons/${s.id}`} style={{ fontWeight: 600, display: 'inline-block', minHeight: 24, lineHeight: '24px' }}>{s.title || 'Untitled'}</Link>
              <span className={`badge ${s.status === 'ready' ? 'source' : ''}`}>{s.status === 'ready' ? 'Ready' : 'Draft'}</span>
              <span className="badge">{TEMPLATES[s.template]?.name ?? 'Custom'}</span>
              {s.folderId && <span className="badge">📁 {folders.find((f) => f.id === s.folderId)?.name}</span>}
              <span className="spacer" />
              <span className="muted small">edited {timeAgo(s.updatedAt)}</span>
            </div>
            <div className="muted small">
              {s.passage && parseOsis(s.passage) && <span className="tap-24"><ScriptureRef r={s.passage} /></span>} {s.mainIdea && <>· {s.mainIdea.slice(0, 140)}</>}
            </div>
            {s.tags.length > 0 && <div className="row small" style={{ marginTop: 4 }}>{s.tags.map((t) => <span key={t} className="badge">#{t}</span>)}</div>}
          </li>
        ))}
      </ul>
      <Dialog open={newOpen} onClose={() => setNewOpen(false)} title="New sermon or lesson">
        <div className="stack">
          {Object.entries(TEMPLATES).map(([k, t]) => (
            <button key={k} className="btn" style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: 12 }} onClick={() => create(k)}>
              <div>
                <strong>{t.name}</strong>
                <div className="muted small" style={{ whiteSpace: 'normal' }}>{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog open={folderOpen} onClose={() => setFolderOpen(false)} title="New folder">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!folderName.trim()) return
            await db.folders.add({ id: uid(), name: folderName.trim(), kind: 'sermon', createdAt: Date.now() })
            setFolderName('')
            setFolderOpen(false)
          }}
        >
          <label className="field">
            <span>Folder name</span>
            <input value={folderName} onChange={(e) => setFolderName(e.target.value)} autoFocus placeholder="Romans series" />
          </label>
          <button className="btn primary">Create folder</button>
        </form>
      </Dialog>
    </div>
  )
}

/* ================= Editor ================= */

export function SermonEditorPage() {
  const { id } = useParams()
  const res = useLiveQuery(() => db.sermons.get(id ?? '').then((s) => ({ s })), [id])
  if (!res) return <Loading label="Opening outline" />
  if (!res.s)
    return (
      <div className="page">
        <ErrorBox error={new Error('This outline was not found. It may have been deleted, or it was saved in a different browser.')} />
        <Link to="/sermons">Back to Sermons &amp; Lessons</Link>
      </div>
    )
  return <SermonEditor key={res.s.id} initial={res.s} />
}

async function exportSermon(s: Sermon, kind: 'md' | 'docx' | 'pdf') {
  try {
    const r = parseOsis(s.passage)
    const text = r ? passageToText(await getPassage(r, s.translation ?? 'KJV')) : undefined
    const approach = TEMPLATES[s.template]?.name
    const doc = sermonToDoc(s, text, s.template === 'blank' ? undefined : approach)
    const name = slug(s.title)
    if (kind === 'md') downloadBlob(new Blob([toMarkdown(doc)], { type: 'text/markdown' }), `${name}.md`)
    const folder = s.folderId ? await db.folders.get(s.folderId) : undefined
    const info = { kind: 'Sermon Manuscript', series: s.series || folder?.name || approach || 'Sermon Notes' }
    if (kind === 'docx') downloadBlob(await wordExport(doc, info), `${name}.docx`)
    if (kind === 'pdf') downloadBlob(await pdfExport(doc, info), `${name}.pdf`)
  } catch (e) {
    toast(`Export failed: ${(e as Error).message}`)
  }
}

function SermonEditor({ initial }: { initial: Sermon }) {
  const nav = useNavigate()
  const [s, setS] = useState(initial)
  const [passageInput, setPassageInput] = useState(initial.passage && parseOsis(initial.passage) ? formatRef(parseOsis(initial.passage)!) : '')
  const [passageErr, setPassageErr] = useState('')
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // `base` is the stored version this tab is editing; saves never overwrite a newer one from another tab
  const base = useRef(initial.updatedAt ?? 0)
  const autosave = useAutosave(s, (v: Sermon) => guardedPut('sermons', v, base), `sermons:${initial.id}`, 600, base)
  useWatchRecord<Sermon>('sermons', initial.id, base, autosave, setS, 'outline')
  const folders = useLiveQuery(() => db.folders.where('kind').equals('sermon').toArray(), []) ?? []

  useEffect(() => {
    recordSession('sermon', `/sermons/${s.id}`, s.title || 'Untitled outline')
  }, [s.id, s.title])
  useEffect(() => {
    document.title = `${s.title || 'Untitled'} · Arise Bible Study`
  }, [s.title])

  const up = (p: Partial<Sermon>) => {
    setS((cur) => ({ ...cur, ...p }))
  }
  const setSection = (i: number, sec: SermonSection) => up({ sections: s.sections.map((x, j) => (j === i ? sec : x)) })
  const move = (from: number, to: number) => {
    if (to < 0 || to >= s.sections.length || from === to) return
    const next = s.sections.slice()
    const [m] = next.splice(from, 1)
    next.splice(to, 0, m)
    up({ sections: next })
  }

  const [updatingTr, setUpdatingTr] = useState(false)
  const changeTranslation = async (next: string) => {
    setUpdatingTr(true)
    const missing: string[] = []
    const sections: SermonSection[] = []
    for (const sec of s.sections) {
      const r = await retranslateBlocks(sec.blocks, next)
      missing.push(...r.missing)
      sections.push({ ...sec, blocks: r.blocks })
    }
    up({ translation: next, sections })
    setUpdatingTr(false)
    toast(missing.length ? `Updated to ${next}. Not found in ${next}: ${missing.join(', ')}` : `All Scripture in this outline now quotes the ${next}`)
  }

  const setPassage = async () => {
    if (!passageInput.trim()) {
      setPassageErr('')
      return up({ passage: '' })
    }
    const r = parseRef(passageInput)
    if (!r) return setPassageErr('Use a form like Romans 8:28-39.')
    try {
      await getPassage(r, s.translation ?? 'KJV')
      setPassageErr('')
      up({ passage: toOsis(r) })
    } catch (e) {
      setPassageErr((e as Error).message)
    }
  }

  return (
    <div className="page stack" style={{ maxWidth: 980 }}>
      <ConflictBanner table="sermons" noun="outline" value={s} base={base} autosave={autosave} onUseTheirs={setS} onClose={() => { autosave.discard(); nav('/sermons') }} />
      <div className="row no-print">
        <Link to="/sermons" className="small">← Sermons &amp; Lessons</Link>
        <SaveIndicator autosave={autosave} />
        <span className="spacer" />
        <Link className="btn" to={`/sermons/${s.id}/teach`}><MonitorPlay size={15} /> Teaching view</Link>
        <Link className="btn" to={`/sermons/${s.id}/teach?print=1`}><Printer size={15} /> Print</Link>
        <button className="btn" onClick={() => exportSermon(s, 'md')}><Download size={15} /> .md</button>
        <button className="btn" onClick={() => exportSermon(s, 'docx')}><FileText size={15} /> Word</button>
        <button className="btn" onClick={() => exportSermon(s, 'pdf')}><FileText size={15} /> PDF</button>
      </div>

      <h1 className="sr-only">Edit outline: {s.title || 'Untitled'}</h1>
      <label className="sr-only" htmlFor="stitle">Title</label>
      <input id="stitle" value={s.title} onChange={(e) => up({ title: e.target.value })} placeholder="Title" style={{ display: 'block', width: '100%', fontSize: '1.7rem', fontWeight: 700, border: '1px solid transparent', background: 'transparent', padding: '4px 0' }} />

      <label className="sr-only" htmlFor="ssub">Secondary title</label>
      <input id="ssub" value={s.subtitle ?? ''} onChange={(e) => up({ subtitle: e.target.value })} placeholder="Secondary title (optional)" style={{ display: 'block', width: '100%', marginTop: 0, fontSize: '1.1rem', fontStyle: 'italic', color: 'var(--accent-strong)', border: '1px solid transparent', background: 'transparent', padding: '0 0 4px' }} />

      <div className="card stack">
        <label className="field">
          <span>Series (shown above the title in Word and PDF)</span>
          <input value={s.series ?? ''} onChange={(e) => up({ series: e.target.value })} placeholder="The Anointing, Part 2 of 3" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Primary passage</span>
            <input value={passageInput} onChange={(e) => setPassageInput(e.target.value)} onBlur={setPassage} placeholder="Romans 5:1-11" />
            {passageErr && <span style={{ color: 'var(--danger)' }}>{passageErr}</span>}
            {s.passage && parseOsis(s.passage) && !passageErr && <span className="small"><ScriptureRef r={s.passage} /></span>}
          </label>
          <label className="field">
            <span>Status</span>
            <select value={s.status} onChange={(e) => up({ status: e.target.value as Sermon['status'] })}>
              <option value="draft">Draft</option>
              <option value="ready">Ready to teach</option>
            </select>
          </label>
          <div>
            <TranslationSelect id="sermon-tr" label="Quote Scripture in" value={s.translation ?? 'KJV'} onChange={changeTranslation} />
            {updatingTr && <span className="muted small">Updating quotes…</span>}
          </div>
        </div>
        <label className="field">
          <span>Main idea</span>
          <textarea rows={2} value={s.mainIdea} onChange={(e) => up({ mainIdea: e.target.value })} placeholder="The one sentence people should carry home." />
        </label>
        <label className="field">
          <span>Teaching objective</span>
          <textarea rows={2} value={s.objective} onChange={(e) => up({ objective: e.target.value })} placeholder="What should listeners understand, believe, or do?" />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>Intended audience</span>
            <input value={s.audience} onChange={(e) => up({ audience: e.target.value })} placeholder="Sunday service, Men ARISE, new believers…" />
          </label>
          <label className="field">
            <span>Estimated length</span>
            <input value={s.length} onChange={(e) => up({ length: e.target.value })} />
          </label>
          <label className="field">
            <span>Tags (comma separated)</span>
            <input value={s.tags.join(', ')} onChange={(e) => up({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
          </label>
          <label className="field">
            <span>Folder</span>
            <select value={s.folderId ?? ''} onChange={(e) => up({ folderId: e.target.value || undefined })}>
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        </div>
        {s.studyId && (
          <div className="small">
            Built from a study: <Link to={`/study/${s.studyId}`}>open the study</Link>
          </div>
        )}
      </div>

      <div className="row">
        <h2 style={{ margin: 0 }}>Outline</h2>
        <span className="spacer" />
        <BlockLegend />
      </div>
      <p className="muted small" style={{ margin: 0 }}>Drag sections by the handle, or use the arrow buttons. Indent a section to make it a subpoint.</p>
      <div className="notice small">
        <strong>Manuscript formats for Word and PDF.</strong> Start a line in any note with <code>KEY TRUTH:</code> (black bar), <code>HARD TRUTH:</code>,{' '}
        <code>PRAYER:</code> (prayer box), <code>[PREACHER NOTE]</code> or <code>[LEADER CUE]</code>, or <code>- </code> for a bullet.
      </div>

      {s.sections.map((sec, i) => (
        <div
          key={sec.id}
          className={`sermon-section level-${sec.level} ${drag === i ? 'dragging' : ''} ${over === i && drag !== i ? 'drop-target' : ''}`}
          onDragOver={(e) => {
            if (drag === null) return
            e.preventDefault()
            setOver(i)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (drag !== null) move(drag, i)
            setDrag(null)
            setOver(null)
          }}
        >
          <header>
            <span draggable onDragStart={() => setDrag(i)} onDragEnd={() => { setDrag(null); setOver(null) }} style={{ cursor: 'grab', display: 'inline-flex' }} title="Drag to reorder" aria-hidden>
              <GripVertical size={16} className="muted" />
            </span>
            <button className="iconbtn" onClick={() => setSection(i, { ...sec, collapsed: !sec.collapsed })} aria-expanded={!sec.collapsed} aria-label={sec.collapsed ? 'Expand section' : 'Collapse section'}>
              {sec.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            </button>
            <label className="sr-only" htmlFor={`st-${sec.id}`}>Section title</label>
            <input id={`st-${sec.id}`} value={sec.title} onChange={(e) => setSection(i, { ...sec, title: e.target.value })} />
            <label className="sr-only" htmlFor={`sty-${sec.id}`}>Section type</label>
            <select id={`sty-${sec.id}`} value={sec.type} onChange={(e) => setSection(i, { ...sec, type: e.target.value, level: e.target.value === 'subpoint' ? 2 : sec.level })} style={{ maxWidth: 150 }}>
              {SECTION_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <button className="btn sm ghost" onClick={() => setSection(i, { ...sec, level: sec.level === 1 ? 2 : 1 })} title={sec.level === 1 ? 'Make subpoint' : 'Make main section'}>
              {sec.level === 1 ? 'Indent' : 'Outdent'}
            </button>
            <button className="iconbtn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="Move section up"><ArrowUp size={15} /></button>
            <button className="iconbtn" onClick={() => move(i, i + 1)} disabled={i === s.sections.length - 1} aria-label="Move section down"><ArrowDown size={15} /></button>
            <button className="iconbtn" onClick={() => up({ sections: [...s.sections.slice(0, i + 1), { ...sec, id: uid(), title: sec.title + ' (copy)', blocks: sec.blocks.map((b) => ({ ...b, id: uid() })) }, ...s.sections.slice(i + 1)] })} aria-label="Duplicate section"><Copy size={15} /></button>
            <button className="iconbtn" onClick={() => up({ sections: s.sections.filter((_, j) => j !== i) })} aria-label="Delete section"><Trash2 size={15} /></button>
          </header>
          {!sec.collapsed && (
            <div className="section-body">
              <BlockList blocks={sec.blocks} onChange={(b) => setSection(i, { ...sec, blocks: b })} addKinds={['note', 'scripture']} tr={s.translation ?? 'KJV'} />
            </div>
          )}
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => up({ sections: [...s.sections, { id: uid(), type: 'point', title: 'New point', level: 1, blocks: [{ id: uid(), kind: 'note', text: '' }] }] })}>
          <Plus size={15} /> Add section
        </button>
        <button className="btn" onClick={() => up({ sections: [...s.sections, { id: uid(), type: 'subpoint', title: 'Subpoint', level: 2, blocks: [{ id: uid(), kind: 'note', text: '' }] }] })}>
          <Plus size={15} /> Add subpoint
        </button>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Sources and further study</span>
          <textarea rows={4} value={s.sources} onChange={(e) => up({ sources: e.target.value })} placeholder="Books, commentaries, and reference works you used." />
        </label>
      </div>

      <div className="row no-print">
        <button className="btn danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={15} /> Delete outline
        </button>
      </div>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this outline?">
        <p>“{s.title}” will be deleted from this browser. This cannot be undone.</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              autosave.discard()
              await db.sermons.delete(s.id)
              nav('/sermons')
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

/* ================= Teaching view ================= */

export function TeachingView() {
  const { id } = useParams()
  const nav = useNavigate()
  const res = useLiveQuery(() => db.sermons.get(id ?? '').then((s) => ({ s })), [id])
  const s = res?.s
  const passage = s?.passage ? parseOsis(s.passage) : undefined
  const { data: verses } = useAsync(() => (passage ? getPassage(passage, s?.translation ?? 'KJV') : Promise.resolve(null)), [s?.passage, s?.translation])
  const printMode = new URLSearchParams(location.search).has('print')
  const [allOpen, setAllOpen] = useState(true)
  useEffect(() => {
    if (printMode && s && (!passage || verses)) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [printMode, s, verses, passage])
  const sections = useMemo(() => s?.sections ?? [], [s])
  if (!res) return <Loading />
  if (!s) return <div className="page"><ErrorBox error={new Error('This outline was not found.')} /></div>
  return (
    <div className="teach">
      <div className="row no-print" style={{ marginBottom: 16, fontSize: 'var(--ui-size)' }}>
        <button className="btn" onClick={() => nav(`/sermons/${s.id}`)}>← Back to editor</button>
        <button className="btn" onClick={() => setAllOpen(!allOpen)}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
        <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print</button>
      </div>
      {s.series && <div className="muted" style={{ fontSize: '0.7em', letterSpacing: '0.2em', textTransform: 'uppercase' }}>{s.series}</div>}
      <h1 style={{ marginBottom: 4 }}>{s.title || 'Untitled'}</h1>
      {s.subtitle && <div style={{ fontStyle: 'italic', color: 'var(--accent-strong)', marginBottom: 6 }}>{s.subtitle}</div>}
      {passage && (
        <div className="muted" style={{ fontSize: '0.8em' }}>
          <ScriptureRef r={passage} />
          {s.audience && ` · ${s.audience}`}
          {s.length && ` · ${s.length}`}
        </div>
      )}
      {s.mainIdea && (
        <p style={{ fontSize: '1.1em', fontWeight: 600 }}>
          <LinkedText text={s.mainIdea} />
        </p>
      )}
      {s.objective && <p className="muted" style={{ fontSize: '0.85em' }}><strong>Objective:</strong> <LinkedText text={s.objective} /></p>}
      {verses && passage && (
        <blockquote>
          {passageToText(verses)}
          <span className="cite">{formatRef(passage)} ({s.translation ?? 'KJV'})</span>
        </blockquote>
      )}
      {sections.map((sec) => (
        <details key={sec.id + String(allOpen)} open={allOpen} className={`level-${sec.level}`}>
          <summary>{sec.title}</summary>
          <div style={{ paddingLeft: sec.level === 2 ? '1em' : 0 }}>
            {sec.blocks
              .filter((b) => b.kind !== 'note' || b.text.trim())
              .map((b) =>
                b.kind === 'scripture' ? (
                  <blockquote key={b.id}>
                    {b.text}
                    <span className="cite">
                      <ScriptureRef r={b.ref} /> ({b.tr ?? 'KJV'})
                    </span>
                  </blockquote>
                ) : b.kind === 'note' ? (
                  <ManuscriptText key={b.id} text={b.text} />
                ) : (
                  <div key={b.id} style={{ fontSize: '0.85em', margin: '8px 0' }}>
                    <BlockView block={b} onChange={() => {}} readOnly />
                  </div>
                ),
              )}
          </div>
        </details>
      ))}
      {s.sources && (
        <details open={allOpen}>
          <summary>Sources and further study</summary>
          <p style={{ fontSize: '0.85em', whiteSpace: 'pre-wrap' }}>{s.sources}</p>
        </details>
      )}
    </div>
  )
}

/** Shows a note the way the manuscript prints it: KEY TRUTH bars, prayer boxes, [NOTES], bullets. */
function ManuscriptText({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <>
      {lines.map((line, i) => {
        let m: RegExpExecArray | null
        if ((m = /^KEY TRUTH:\s*(.*)$/i.exec(line)))
          return (
            <div key={i} style={{ background: '#111', color: '#fff', fontWeight: 700, textAlign: 'center', padding: '8px 12px', margin: '12px 0', borderRadius: 4 }}>
              KEY TRUTH: <LinkedText text={m[1]} />
            </div>
          )
        if ((m = /^HARD TRUTH:\s*(.*)$/i.exec(line)))
          return (
            <p key={i}>
              <strong style={{ color: 'var(--cue-gold)' }}>HARD TRUTH:</strong> <em><LinkedText text={m[1]} /></em>
            </p>
          )
        if ((m = /^PRAYER:\s*(.*)$/i.exec(line)))
          return (
            <blockquote key={i} style={{ fontFamily: 'var(--ui-font)', borderLeftColor: '#B8972A' }}>
              <LinkedText text={m[1]} />
            </blockquote>
          )
        if ((m = /^\[([^\]]{2,40})\]\s*(.*)$/.exec(line)))
          return (
            <p key={i} style={{ fontSize: '0.8em', marginLeft: '1em' }}>
              <strong style={{ color: 'var(--cue-gold)' }}>[{m[1].toUpperCase()}]</strong> <em><LinkedText text={m[2]} /></em>
            </p>
          )
        if ((m = /^[-•*]\s+(.*)$/.exec(line)))
          return (
            <ul key={i} style={{ margin: '4px 0' }}>
              <li><LinkedText text={m[1]} /></li>
            </ul>
          )
        return (
          <p key={i}>
            <LinkedText text={line} />
          </p>
        )
      })}
    </>
  )
}
