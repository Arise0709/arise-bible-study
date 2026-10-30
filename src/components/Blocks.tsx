import { useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, HelpCircle, Link2, NotebookPen, Sparkles, Trash2 } from 'lucide-react'
import { getPassage, loadTranslationIndex, passageToText } from '../lib/data'
import { formatRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import { uid, type Block } from '../db/db'
import { Dialog, useAsync } from './ui'
import { DetectedRefs, LinkedText, ScriptureRef } from './Scripture'

export const BLOCK_LABEL: Record<Block['kind'], string> = {
  scripture: 'Scripture',
  source: 'Source',
  word: "Word study (Strong's)",
  xref: 'Cross-reference',
  note: 'My words',
  ai: 'AI-generated draft',
}

export function BlockLegend() {
  return (
    <div className="legend" aria-label="Legend">
      <span className="badge source" style={{ borderLeft: '4px solid var(--accent)' }}>Scripture quotation</span>
      <span className="badge source">Sourced information</span>
      <span className="badge mine">Your conclusions</span>
      <span className="badge ai">AI draft</span>
    </div>
  )
}

interface ListProps {
  blocks: Block[]
  onChange: (b: Block[]) => void
  addKinds?: ('note' | 'scripture' | 'xref')[]
  defaultXrefFrom?: string
  readOnly?: boolean
  emptyHint?: string
  tr?: string // translation for newly inserted Scripture
}

export function BlockList({ blocks, onChange, addKinds = ['note', 'scripture'], defaultXrefFrom, readOnly, emptyHint, tr = 'KJV' }: ListProps) {
  const [scriptureOpen, setScriptureOpen] = useState<null | 'scripture' | 'xref'>(null)
  const update = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)))
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= blocks.length) return
    const next = blocks.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const remove = (i: number) => onChange(blocks.filter((_, j) => j !== i))
  return (
    <div>
      {!blocks.length && emptyHint && <div className="muted small" style={{ padding: '4px 0' }}>{emptyHint}</div>}
      {blocks.map((b, i) => (
        <BlockView key={b.id} block={b} onChange={(nb) => update(i, nb)} readOnly={readOnly} tr={tr}
          tools={
            readOnly ? null : (
              <div className="block-tools">
                <button className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  <ArrowUp size={14} />
                </button>
                <button className="iconbtn" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down">
                  <ArrowDown size={14} />
                </button>
                <button className="iconbtn" onClick={() => remove(i)} aria-label="Remove block">
                  <Trash2 size={14} />
                </button>
              </div>
            )
          }
        />
      ))}
      {!readOnly && (
        <div className="add-row">
          {addKinds.includes('note') && (
            <button className="btn sm" onClick={() => onChange([...blocks, { id: uid(), kind: 'note', text: '' }])}>
              <NotebookPen size={14} /> My note
            </button>
          )}
          {addKinds.includes('scripture') && (
            <button className="btn sm" onClick={() => setScriptureOpen('scripture')}>
              <BookOpen size={14} /> Scripture
            </button>
          )}
          {addKinds.includes('xref') && (
            <button className="btn sm" onClick={() => setScriptureOpen('xref')}>
              <Link2 size={14} /> Cross-reference
            </button>
          )}
        </div>
      )}
      <InsertScriptureDialog
        tr={tr}
        open={!!scriptureOpen}
        title={scriptureOpen === 'xref' ? 'Add a cross-reference' : `Insert Scripture (exact ${tr} text)`}
        onClose={() => setScriptureOpen(null)}
        onInsert={(osis, text) => {
          if (scriptureOpen === 'xref') onChange([...blocks, { id: uid(), kind: 'xref', from: defaultXrefFrom ?? '', to: osis, explanation: '' }])
          else onChange([...blocks, { id: uid(), kind: 'scripture', ref: osis, text, tr }])
          setScriptureOpen(null)
        }}
      />
    </div>
  )
}

export function BlockView({ block: b, onChange, tools, readOnly, tr = 'KJV' }: { block: Block; onChange: (b: Block) => void; tools?: React.ReactNode; readOnly?: boolean; tr?: string }) {
  switch (b.kind) {
    case 'scripture':
      return (
        <div className="block scripture">
          <div className="block-label">
            <BookOpen size={13} aria-hidden /> Scripture · <ScriptureRef r={b.ref} /> ({b.tr ?? 'KJV'}) {tools}
          </div>
          <blockquote style={{ margin: 0 }}>{b.text}</blockquote>
        </div>
      )
    case 'source':
      return (
        <div className="block source">
          <div className="block-label">
            Source · {b.citation} {tools}
          </div>
          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{b.text}</div>
        </div>
      )
    case 'word':
      return (
        <div className="block word">
          <div className="block-label">
            {b.strongs} · “{b.english}” in <ScriptureRef r={b.ref} /> {tools}
          </div>
          <div>
            <strong>{b.original}</strong> <span className="badge source">Strong's</span>
          </div>
          <div className="small">{b.gloss}</div>
          <div className="block note" style={{ marginTop: 8 }}>
            <div className="block-label">My conclusion from this context</div>
            {readOnly ? (
              <LinkedText text={b.note} />
            ) : (
              <>
                <textarea rows={2} value={b.note} placeholder="What does this word mean here, and what in the passage shows it?" onChange={(e) => onChange({ ...b, note: e.target.value })} aria-label={`Your conclusion about ${b.strongs}`} />
                <DetectedRefs text={b.note} />
              </>
            )}
          </div>
        </div>
      )
    case 'xref':
      return <XrefBlock b={b} onChange={onChange} tools={tools} readOnly={readOnly} tr={tr} />
    case 'note':
      return (
        <div className={`block note ${b.uncertain ? 'uncertain' : ''}`}>
          <div className="block-label">
            My words
            {b.uncertain && (
              <span className="badge editorial">
                <HelpCircle size={11} aria-hidden /> uncertain or debated
              </span>
            )}
            {!readOnly && (
              <label className="row small" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500, gap: 4 }}>
                <input type="checkbox" checked={!!b.uncertain} onChange={(e) => onChange({ ...b, uncertain: e.target.checked })} /> mark uncertain
              </label>
            )}
            {tools}
          </div>
          {readOnly ? (
            <LinkedText text={b.text} />
          ) : (
            <>
              <textarea rows={Math.max(2, Math.min(12, b.text.split('\n').length + 1))} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} aria-label="Your note" placeholder="Write in your own words. References like Rom 5:8 become links." />
              <DetectedRefs text={b.text} />
            </>
          )}
        </div>
      )
    case 'ai':
      return (
        <div className="block ai">
          <div className="block-label">
            <Sparkles size={13} aria-hidden /> AI-generated draft · {new Date(b.createdAt).toLocaleDateString()} {tools}
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>
            <LinkedText text={b.text} />
          </div>
          {b.citations.length > 0 && (
            <div className="row small" style={{ marginTop: 6 }}>
              <span className="muted">Cites:</span>
              {b.citations.map((c) => (parseOsis(c) ? <ScriptureRef key={c} r={c} /> : <span key={c} className="badge">{c}</span>))}
            </div>
          )}
          {b.warnings.length > 0 && (
            <div className="notice warn small" style={{ marginTop: 6 }}>
              {b.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
        </div>
      )
  }
}

function XrefBlock({ b, onChange, tools, readOnly, tr }: { b: Extract<Block, { kind: 'xref' }>; onChange: (b: Block) => void; tools?: React.ReactNode; readOnly?: boolean; tr: string }) {
  const r = parseOsis(b.to)
  const { data } = useAsync(() => (r ? getPassage(r, tr).then(passageToText) : Promise.resolve('')), [b.to, tr])
  return (
    <div className="block xref">
      <div className="block-label">
        Cross-reference · {b.from && parseOsis(b.from) && (<><ScriptureRef r={b.from} /> →</>)} <ScriptureRef r={b.to} /> ({tr}) {tools}
      </div>
      <div style={{ fontFamily: 'var(--scripture-font)' }} className="small">{data}</div>
      <div className="block note" style={{ marginTop: 8 }}>
        <div className="block-label">How they connect (my explanation)</div>
        {readOnly ? (
          <LinkedText text={b.explanation} />
        ) : (
          <textarea rows={2} value={b.explanation} onChange={(e) => onChange({ ...b, explanation: e.target.value })} placeholder="What do these passages share? Where do they differ?" aria-label="Explain the connection" />
        )}
      </div>
    </div>
  )
}

export function InsertScriptureDialog({ open, title, onClose, onInsert, tr = 'KJV' }: { open: boolean; title: string; onClose: () => void; onInsert: (osis: string, text: string) => void; tr?: string }) {
  const [q, setQ] = useState('')
  const parsed = parseRef(q)
  const { data, error } = useAsync(() => (parsed ? getPassage(parsed, tr) : Promise.resolve(null)), [parsed ? toOsis(parsed) : '', tr])
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="stack">
        <label className="field">
          <span>Reference</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="John 3:16-18" autoFocus />
        </label>
        {q && !parsed && <div className="muted small">Type a reference like Romans 8:28 or Ps 23.</div>}
        {error && <div className="notice error small">{error.message}</div>}
        {parsed && data && (
          <div className="block scripture">
            <div className="block-label">{formatRef(parsed)} ({tr})</div>
            <div style={{ maxHeight: 220, overflow: 'auto' }}>{passageToText(data)}</div>
          </div>
        )}
        {parsed && data && data.length > 60 && <div className="notice warn small">That is a long passage ({data.length} verses).</div>}
        <div className="row">
          <button className="btn primary" disabled={!parsed || !data} onClick={() => parsed && data && onInsert(toOsis(parsed), passageToText(data))}>
            Insert
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Dialog>
  )
}

/** Re-fetches every Scripture block's text in another translation. Blocks that cannot be found keep their text. */
export async function retranslateBlocks(blocks: Block[], tr: string): Promise<{ blocks: Block[]; missing: string[] }> {
  const missing: string[] = []
  const out: Block[] = []
  for (const b of blocks) {
    if (b.kind !== 'scripture' || (b.tr ?? 'KJV') === tr) {
      out.push(b)
      continue
    }
    const r = parseOsis(b.ref)
    try {
      if (!r) throw new Error()
      out.push({ ...b, text: passageToText(await getPassage(r, tr)), tr })
    } catch {
      missing.push(r ? formatRef(r) : b.ref)
      out.push(b)
    }
  }
  return { blocks: out, missing }
}

/** Dropdown of translations available for quoting. */
export function TranslationSelect({ value, onChange, id, label }: { value: string; onChange: (v: string) => void; id: string; label: string }) {
  const { data } = useAsync(() => loadTranslationIndex().catch(() => []), [])
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="KJV">King James Version (KJV)</option>
        {data?.map((t) => (
          <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
        ))}
      </select>
    </label>
  )
}
