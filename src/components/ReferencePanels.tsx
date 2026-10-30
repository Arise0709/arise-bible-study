import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import {
  SOURCE_LABEL, getPassage, lemmaCandidates, loadArchaic, loadDictIndex, loadHitchcock, loadIsbe, loadWebster, loadWordnet, loadXrefs,
  passageToText, type DictSource,
} from '../lib/data'
import { formatRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import { searchBible } from '../lib/search'
import { useStudy, useStudySink } from '../lib/state'
import { db, uid, type DictEntry, type VerseNote } from '../db/db'
import { Dialog, Empty, ErrorBox, Loading, toast, toastUndo, useAsync } from './ui'
import { LinkedText, ScriptureRef, SourceHtml } from './Scripture'
import { NoteDialog, numKey } from './Reader'

/* ================= Dictionary ================= */

export interface DictHit {
  term: string
  source: DictSource | 'personal'
  id?: string
}

export async function searchDictionary(q: string, personal: DictEntry[]): Promise<DictHit[]> {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const idx = await loadDictIndex()
  const exact: DictHit[] = []
  const prefix: DictHit[] = []
  const contains: DictHit[] = []
  const lemmas = new Set(lemmaCandidates(t))
  for (const [term, source] of idx) {
    const l = term.toLowerCase()
    if (l === t || lemmas.has(l)) exact.push({ term, source })
    else if (l.startsWith(t)) prefix.push({ term, source })
    else if (t.length > 3 && l.includes(t)) contains.push({ term, source })
  }
  const mine = personal
    .filter((p) => p.term.toLowerCase().includes(t) || p.definition.toLowerCase().includes(t) || p.tags.some((g) => g.toLowerCase() === t))
    .map((p) => ({ term: p.term, source: 'personal' as const, id: p.id }))
  const order: Record<string, number> = { personal: 0, archaic: 1, isbe: 2, hitchcock: 3, webster: 4 }
  const sortFn = (a: DictHit, b: DictHit) => order[a.source] - order[b.source] || a.term.localeCompare(b.term)
  return [...mine, ...exact.sort(sortFn), ...prefix.sort(sortFn).slice(0, 40), ...contains.sort(sortFn).slice(0, 20)]
}

export function SourceBadge({ source }: { source: DictSource | 'personal' | 'wordnet' }) {
  const cls = source === 'personal' ? 'mine' : source === 'archaic' ? 'editorial' : 'source'
  return <span className={`badge ${cls}`}>{SOURCE_LABEL[source]}</span>
}

export function DictionaryPanel({ compact }: { compact?: boolean }) {
  const { lookup, setLookup } = useStudy()
  const [q, setQ] = useState(lookup)
  const [open, setOpen] = useState<DictHit | null>(null)
  const [editing, setEditing] = useState<DictEntry | 'new' | null>(null)
  const personal = useLiveQuery(() => db.dict.toArray(), []) ?? []
  useEffect(() => {
    setQ(lookup)
    setOpen(null)
  }, [lookup])
  const { data: hits, error, loading } = useAsync(() => searchDictionary(q, personal), [q, personal.length, personal.map((p) => p.updatedAt).join()])

  // open the single best match automatically
  useEffect(() => {
    if (!open && hits && hits.length && lookup && q === lookup) {
      const exact = hits.filter((h) => h.term.toLowerCase() === q.toLowerCase())
      if (exact.length === 1) setOpen(exact[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits])

  if (editing) {
    return <DictEntryEditor entry={editing === 'new' ? undefined : editing} defaultTerm={q} onDone={() => setEditing(null)} />
  }
  if (open) {
    return (
      <div className="stack">
        <button className="btn sm ghost" onClick={() => setOpen(null)}>
          <ArrowLeft size={15} /> Results for “{q}”
        </button>
        <DictEntryView hit={open} personal={personal} onEdit={(e) => setEditing(e)} onOpen={(h) => setOpen(h)} />
      </div>
    )
  }
  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          setLookup(q)
        }}
      >
        <label className="sr-only" htmlFor={`dq-${compact ? 'c' : 'p'}`}>Search the dictionary</label>
        <input id={`dq-${compact ? 'c' : 'p'}`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Word, name, place, custom…" style={{ flex: 1 }} />
        <button className="btn" aria-label="Search">
          <Search size={16} />
        </button>
        <button type="button" className="btn" onClick={() => setEditing('new')}>
          <Plus size={16} /> My entry
        </button>
      </form>
      <div className="legend">
        <SourceBadge source="personal" /> your own words <SourceBadge source="isbe" /> <SourceBadge source="hitchcock" /> <SourceBadge source="webster" /> published sources <SourceBadge source="archaic" /> written for this app
      </div>
      {loading && <Loading label="Searching" />}
      {error && <ErrorBox error={error} />}
      {!q && <Empty>Search Bible people, places, customs, theological terms, and archaic KJV words.</Empty>}
      {q && hits && !hits.length && (
        <Empty>
          Nothing found for “{q}”.{' '}
          <button className="reflink" onClick={() => setEditing('new')}>
            Create your own entry
          </button>
          .
        </Empty>
      )}
      <ul className="list">
        {hits?.slice(0, 80).map((h, i) => (
          <li key={h.source + h.term + i} style={{ padding: '6px 0' }}>
            <button className="reflink" onClick={() => setOpen(h)} style={{ marginRight: 8 }}>
              {h.term}
            </button>
            <SourceBadge source={h.source} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function DictEntryView({ hit, personal, onEdit, onOpen }: { hit: DictHit; personal: DictEntry[]; onEdit: (e: DictEntry) => void; onOpen: (h: DictHit) => void }) {
  const { setLookup } = useStudy()
  const sink = useStudySink()
  const { data, error, loading } = useAsync(async () => {
    switch (hit.source) {
      case 'isbe':
        return { html: await loadIsbe(hit.term) }
      case 'hitchcock':
        return { text: await loadHitchcock(hit.term) }
      case 'webster':
        return { webster: await loadWebster(hit.term) }
      case 'archaic':
        return { archaic: (await loadArchaic()).find((a) => a.word.toLowerCase() === hit.term.toLowerCase()) }
      default:
        return {}
    }
  }, [hit.term, hit.source])
  if (hit.source === 'personal') {
    const p = personal.find((x) => x.id === hit.id)
    if (!p) return <Empty>This entry was deleted.</Empty>
    return <PersonalEntryView entry={p} onEdit={() => onEdit(p)} />
  }
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  const addSource = (text: string, citation: string) => {
    sink?.add('context', { id: uid(), kind: 'source', source: hit.source, title: hit.term, text, citation })
    toast('Added to Context in your study')
  }
  return (
    <article className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{hit.term}</h2>
        <SourceBadge source={hit.source} />
      </div>
      {hit.source === 'isbe' && data?.html && (
        <>
          <div className="notice small">Published 1915. Historical and archaeological details reflect scholarship of that time.</div>
          <SourceHtml className="isbe" html={data.html} onEntry={(name) => onOpen({ term: titleCase(name), source: 'isbe' })} />
          {sink && (
            <button className="btn sm" onClick={() => addSource(stripHtml(data.html!).slice(0, 1200), `ISBE (1915), “${hit.term}”`)}>
              <Plus size={14} /> Add excerpt to study
            </button>
          )}
        </>
      )}
      {hit.source === 'hitchcock' && data?.text && (
        <>
          <p style={{ fontSize: '1.1em' }}>{data.text}</p>
          <div className="notice small">Traditional name meanings from 1869. Many are uncertain or disputed by later scholarship.</div>
        </>
      )}
      {hit.source === 'webster' && data?.webster && <WebsterView entries={data.webster} />}
      {hit.source === 'archaic' && data?.archaic && (
        <>
          <div className="notice warn small">
            <strong>App editorial.</strong> Written for this app, not quoted from a published dictionary. Check it against Webster 1913 and ISBE.
          </div>
          <p>
            <strong>Modern equivalent:</strong> {data.archaic.modern}
          </p>
          <p>{data.archaic.sense}</p>
          <div className="row">
            <span className="muted small">KJV examples:</span>
            {data.archaic.refs.map((r) => (
              <ScriptureRef key={r} r={r} />
            ))}
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => onOpen({ term: titleCase(hit.term), source: 'webster' })}>
              Check Webster 1913
            </button>
            <button className="btn sm" onClick={() => setLookup(hit.term, 'thesaurus')}>
              Thesaurus
            </button>
          </div>
        </>
      )}
      {!data?.html && !data?.text && !data?.webster && !data?.archaic && <Empty>The entry text could not be found in the source file.</Empty>}
    </article>
  )
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
const stripHtml = (h: string) => h.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

export function WebsterView({ entries, max = 12 }: { entries: import('../lib/data').WebsterEntry[]; max?: number }) {
  return (
    <div className="stack">
      <div className="notice small">Webster's 1913 dictionary. Older senses, closer to KJV-era English, are often listed first.</div>
      {entries.map((e, i) => (
        <div key={i}>
          <div className="muted small">
            <em>{e.pos}</em> {e.etym && <span>· {e.etym}</span>}
          </div>
          <ol style={{ margin: '4px 0', paddingLeft: 22 }}>
            {e.senses.slice(0, max).map((s, j) => (
              <li key={j} style={{ marginBottom: 4 }}>
                {s.spec && <em>{s.spec} </em>}
                {s.d}
                {s.q?.slice(0, 2).map((q, k) => (
                  <div key={k} className="muted small" style={{ fontStyle: 'italic' }}>
                    “{q}”
                  </div>
                ))}
                {s.refs?.map((r) => (
                  <span key={r} className="small">
                    {' '}
                    <ScriptureRef r={r} />
                  </span>
                ))}
              </li>
            ))}
          </ol>
          {e.syn && (
            <div className="small">
              <strong>Syn. (Webster):</strong> {e.syn}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function PersonalEntryView({ entry, onEdit }: { entry: DictEntry; onEdit: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <article className="stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>{entry.term}</h2>
        <SourceBadge source="personal" />
        <span className="spacer" />
        <button className="btn sm" onClick={onEdit}>
          <Pencil size={14} /> Edit
        </button>
        <button className="btn sm danger" onClick={() => setConfirm(true)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
      <div className="block note">
        <div className="block-label">My definition</div>
        <LinkedText text={entry.definition || '(no definition yet)'} />
      </div>
      {entry.strongs.length > 0 && (
        <div>
          <strong className="small">Hebrew / Greek:</strong> {entry.strongs.map((s) => <StrongsChip key={s} id={s} />)}
        </div>
      )}
      {entry.refs.length > 0 && (
        <div className="row">
          <strong className="small">Scripture:</strong>
          {entry.refs.map((r) => (
            <ScriptureRef key={r} r={r} />
          ))}
        </div>
      )}
      {entry.examples && (
        <div>
          <strong className="small">Examples of usage</strong>
          <div><LinkedText text={entry.examples} /></div>
        </div>
      )}
      {entry.notes && (
        <div>
          <strong className="small">Study notes</strong>
          <div><LinkedText text={entry.notes} /></div>
        </div>
      )}
      {entry.sources && (
        <div className="small">
          <strong>Sources consulted:</strong> <LinkedText text={entry.sources} />
        </div>
      )}
      {entry.tags.length > 0 && (
        <div className="row">
          {entry.tags.map((t) => (
            <span key={t} className="badge">#{t}</span>
          ))}
        </div>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Delete entry?">
        <p>Delete “{entry.term}” from your dictionary? This cannot be undone.</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              await db.dict.delete(entry.id)
              setConfirm(false)
              toast('Entry deleted')
            }}
          >
            Delete
          </button>
          <button className="btn" onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      </Dialog>
    </article>
  )
}

function StrongsChip({ id }: { id: string }) {
  const { select, setTool } = useStudy()
  const nav = useNavigate()
  return (
    <button
      className="chip"
      style={{ marginRight: 4 }}
      onClick={() => {
        select(null)
        nav(`/dictionary?strongs=${id}`)
        setTool('word')
      }}
    >
      {id}
    </button>
  )
}

export function DictEntryEditor({ entry, defaultTerm, onDone }: { entry?: DictEntry; defaultTerm?: string; onDone: (saved?: DictEntry) => void }) {
  const { selection } = useStudy()
  const [f, setF] = useState(() => ({
    term: entry?.term ?? defaultTerm ?? '',
    definition: entry?.definition ?? '',
    strongs: entry?.strongs.join(', ') ?? '',
    refs: entry?.refs.map((r) => formatRef(parseOsis(r)!)).join('; ') ?? (selection ? `${formatRef({ book: selection.book, chapter: selection.chapter, verse: selection.verse })}` : ''),
    examples: entry?.examples ?? '',
    notes: entry?.notes ?? '',
    tags: entry?.tags.join(', ') ?? '',
    sources: entry?.sources ?? '',
  }))
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    if (!f.term.trim()) return setErr('Give the entry a word or term.')
    const strongs = f.strongs.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)
    const bad = strongs.filter((s) => !/^[HG]\d{1,4}$/.test(s))
    if (bad.length) return setErr(`These are not Strong's numbers: ${bad.join(', ')}. Use the form H7225 or G25.`)
    const refParts = f.refs.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)
    const refs: string[] = []
    for (const p of refParts) {
      const r = parseRef(p)
      if (!r) return setErr(`“${p}” is not a Bible reference this app understands. Try a form like John 3:16.`)
      refs.push(toOsis(r))
    }
    const now = Date.now()
    const rec: DictEntry = {
      id: entry?.id ?? uid(),
      term: f.term.trim(),
      definition: f.definition,
      strongs,
      refs,
      examples: f.examples,
      notes: f.notes,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      sources: f.sources,
      createdAt: entry?.createdAt ?? now,
      updatedAt: now,
    }
    await db.dict.put(rec)
    toast('Saved to My Dictionary')
    onDone(rec)
  }
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="row">
        <h2 style={{ margin: 0 }}>{entry ? 'Edit entry' : 'New dictionary entry'}</h2>
        <SourceBadge source="personal" />
      </div>
      <div className="notice small">Your own definitions are kept separate from published sources and always marked “My dictionary”.</div>
      <label className="field">
        <span>Word or term</span>
        <input value={f.term} onChange={set('term')} required />
      </label>
      <label className="field">
        <span>Definition in your own words</span>
        <textarea rows={4} value={f.definition} onChange={set('definition')} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Strong's numbers (e.g. G26, H2617)</span>
          <input value={f.strongs} onChange={set('strongs')} />
        </label>
        <label className="field">
          <span>Supporting Scripture (separate with ;)</span>
          <input value={f.refs} onChange={set('refs')} placeholder="1 Cor 13:4-7; Rom 5:8" />
        </label>
      </div>
      <label className="field">
        <span>Examples of usage</span>
        <textarea rows={3} value={f.examples} onChange={set('examples')} />
      </label>
      <label className="field">
        <span>Study notes</span>
        <textarea rows={3} value={f.notes} onChange={set('notes')} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Tags (comma separated)</span>
          <input value={f.tags} onChange={set('tags')} />
        </label>
        <label className="field">
          <span>Source references you consulted</span>
          <input value={f.sources} onChange={set('sources')} placeholder="Strong's G26; ISBE “Love”" />
        </label>
      </div>
      {err && <div className="notice error">{err}</div>}
      <div className="row">
        <button className="btn primary">Save entry</button>
        <button type="button" className="btn" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* ================= Thesaurus ================= */

export function ThesaurusPanel() {
  const { lookup, setLookup } = useStudy()
  const [q, setQ] = useState(lookup)
  useEffect(() => setQ(lookup), [lookup])
  const term = lookup.trim().toLowerCase()
  const { data, error, loading } = useAsync(async () => {
    if (!term) return null
    const cands = lemmaCandidates(term)
    const archaic = (await loadArchaic()).filter((a) => cands.includes(a.word.toLowerCase()))
    let webster: { word: string; entries: import('../lib/data').WebsterEntry[] } | null = null
    for (const c of cands) {
      const w = await loadWebster(c)
      if (w) {
        webster = { word: c, entries: w }
        break
      }
    }
    let wn: { word: string; senses: import('../lib/data').WordnetSense[] } | null = null
    for (const c of cands) {
      const s = await loadWordnet(c)
      if (s) {
        wn = { word: c, senses: s }
        break
      }
    }
    return { archaic, webster, wn }
  }, [term])
  const { data: examples } = useAsync(
    () => (term ? searchBible({ query: term, mode: 'all', scope: 'all', wholeWord: true, limit: 6 }) : Promise.resolve(null)),
    [term],
  )

  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          setLookup(q)
        }}
      >
        <label className="sr-only" htmlFor="tq">English word</label>
        <input id="tq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="English word, e.g. conversation" style={{ flex: 1 }} />
        <button className="btn">Look up</button>
      </form>
      <div className="notice info small">
        <strong>A writing and comprehension aid.</strong> These are English words only. They help you understand older English and explain
        it clearly. They do not replace the biblical text and do not prove an interpretation. For Hebrew and Greek word relationships, use
        the Word panel.
      </div>
      {!term && <Empty>Enter an English word, or choose “Thesaurus” from a word in the Bible text.</Empty>}
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <section>
            <h3>KJV-era meaning</h3>
            {data.archaic.map((a) => (
              <div key={a.word} className="block source" style={{ marginBottom: 8 }}>
                <div className="block-label">
                  <SourceBadge source="archaic" /> {a.word}
                </div>
                <div>
                  <strong>Modern:</strong> {a.modern}
                </div>
                <div className="small">{a.sense}</div>
              </div>
            ))}
            {data.webster ? (
              <WebsterView entries={data.webster.entries} max={4} />
            ) : (
              <Empty>No Webster 1913 entry for “{term}”.</Empty>
            )}
          </section>
          <section>
            <h3>
              Modern English <SourceBadge source="wordnet" />
            </h3>
            {!data.wn && <Empty>WordNet has no entry for “{term}”. It may be archaic or a name.</Empty>}
            {data.wn?.senses.map((s, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div>
                  <em className="muted">{s.pos}</em> {s.gloss}
                  {s.ex && <span className="muted small"> (“{s.ex}”)</span>}
                </div>
                {s.syn.length > 0 && (
                  <div className="row small" style={{ marginTop: 2 }}>
                    <span className="muted">Synonyms:</span>
                    {s.syn.map((w) => (
                      <button key={w} className="chip" onClick={() => setLookup(w)}>{w}</button>
                    ))}
                  </div>
                )}
                {s.ant && (
                  <div className="row small" style={{ marginTop: 2 }}>
                    <span className="muted">Antonyms:</span>
                    {s.ant.map((w) => (
                      <button key={w} className="chip" onClick={() => setLookup(w)}>{w}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
          <section>
            <h3>How the KJV uses it</h3>
            <div className="muted small">Read each verse. The sense can shift with context.</div>
            {examples ? (
              <ul className="list occ-list">
                {examples.hits.map((h) => (
                  <li key={h.key}>
                    <ScriptureRef r={h.key} preview={false} /> <Highlighted text={h.text} term={term} />
                  </li>
                ))}
                {examples.total > examples.hits.length && <li className="muted small">{examples.total} verses in all.</li>}
                {examples.total === 0 && <li className="muted">“{term}” does not appear in the KJV.</li>}
              </ul>
            ) : (
              <Loading label="Searching the KJV" />
            )}
          </section>
        </>
      )}
    </div>
  )
}

export function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')
  return (
    <>
      {text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}
    </>
  )
}

/* ================= Cross references ================= */

export function XrefPanel() {
  const { focusVerse, selection } = useStudy()
  const sink = useStudySink()
  const v = focusVerse ?? (selection ? { book: selection.book, chapter: selection.chapter, verse: selection.verse } : null)
  const [limit, setLimit] = useState(15)
  const { data, error, loading } = useAsync(() => (v ? loadXrefs(v.book, v.chapter, v.verse) : Promise.resolve([])), [v?.book, v?.chapter, v?.verse])
  const shown = data?.slice(0, limit) ?? []
  const { data: texts } = useAsync(async () => Promise.all(shown.map(([r]) => getPassage(parseOsis(r)!).then(passageToText).catch(() => ''))), [shown.map((s) => s[0]).join()])
  if (!v) return <Empty>Select a verse number in the reader to see related passages.</Empty>
  const from = `${v.book}.${v.chapter}.${v.verse}`
  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Cross-references for {formatRef(v)}</h3>
        <span className="badge source">OpenBible.info</span>
      </div>
      <div className="notice small">
        Community-voted links between passages. A link means readers found the passages related, not that they teach the same thing. You
        decide and explain the connection.
      </div>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && !data.length && <Empty>No cross-references are listed for this verse.</Empty>}
      <ul className="list">
        {shown.map(([r, votes], i) => (
          <li key={r}>
            <div className="row">
              <ScriptureRef r={r} preview={false} />
              <span className="muted small">{votes} votes</span>
              <span className="spacer" />
              {sink && (
                <button
                  className="btn sm"
                  onClick={() => {
                    sink.add('crossRefs', { id: uid(), kind: 'xref', from, to: r, explanation: '' })
                    toast('Added to Cross-references')
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              )}
            </div>
            <div style={{ fontFamily: 'var(--scripture-font)', fontSize: '0.95em' }}>{texts?.[i]}</div>
          </li>
        ))}
      </ul>
      {data && data.length > limit && (
        <button className="btn sm" onClick={() => setLimit(limit + 15)}>
          Show more ({data.length - limit} remaining)
        </button>
      )}
    </div>
  )
}

/* ================= Verse notes ================= */

export function VerseNotesPanel() {
  const { focusVerse, selection } = useStudy()
  const v = focusVerse ?? (selection ? { book: selection.book, chapter: selection.chapter, verse: selection.verse } : null)
  const [editing, setEditing] = useState<VerseNote | null>(null)
  const [adding, setAdding] = useState(false)
  const key = v ? numKey(v.book, v.chapter, v.verse) : 0
  const notes = useLiveQuery(async (): Promise<VerseNote[]> => (v ? db.notes.where('startKey').belowOrEqual(key).and((n) => n.endKey >= key).toArray() : []), [key]) ?? []
  const chapterNotes = useLiveQuery(
    async (): Promise<VerseNote[]> => (v ? db.notes.where('startKey').between(numKey(v.book, v.chapter, 0), numKey(v.book, v.chapter, 999)).toArray() : []),
    [v?.book, v?.chapter],
  ) ?? []
  const others = useMemo(() => chapterNotes.filter((n) => !notes.some((m) => m.id === n.id)), [chapterNotes, notes])
  if (!v) return <Empty>Select a verse number in the reader to see or add notes.</Empty>
  const card = (n: VerseNote) => (
    <li key={n.id}>
      <div className="row">
        <ScriptureRef r={n.ref} />
        <span className="spacer" />
        <button className="iconbtn" onClick={() => setEditing(n)} aria-label="Edit note">
          <Pencil size={15} />
        </button>
        <button
          className="iconbtn"
          onClick={async () => {
            await db.notes.delete(n.id)
            toastUndo('Note deleted', () => db.notes.put(n))
          }}
          aria-label="Delete note"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="block note" style={{ marginTop: 4 }}>
        <LinkedText text={n.text} />
      </div>
      {n.tags.length > 0 && <div className="row small" style={{ marginTop: 4 }}>{n.tags.map((t) => <span key={t} className="badge">#{t}</span>)}</div>}
    </li>
  )
  return (
    <div className="stack">
      <div className="row">
        <h3 style={{ margin: 0 }}>Notes on {formatRef(v)}</h3>
        <span className="spacer" />
        <button className="btn sm primary" onClick={() => setAdding(true)}>
          <Plus size={14} /> Add note
        </button>
      </div>
      {!notes.length && <Empty>No notes on this verse yet.</Empty>}
      <ul className="list">{notes.map(card)}</ul>
      {others.length > 0 && (
        <>
          <h3>Other notes in this chapter</h3>
          <ul className="list">{others.map(card)}</ul>
        </>
      )}
      <NoteDialog target={adding ? v : editing ? parseOsis(editing.ref)! : null} existing={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null) }} />
    </div>
  )
}
