import { Suspense, lazy, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Bookmark, Clock, Download, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { DictEntryEditor, DictionaryPanel, Highlighted, SourceBadge, ThesaurusPanel } from '../components/ReferencePanels'
import { StrongsCard, StrongsLookup, ContextNote } from '../components/WordPanel'
import { Empty, ErrorBox, Loading, Tabs, timeAgo, toast, toastUndo, useAsync } from '../components/ui'
import { LinkedText, ScriptureRef } from '../components/Scripture'
import { loadCommentaryIndex, loadSources, loadTranslationIndex } from '../lib/data'
import { aiStatus, getAiCode, setAiCode } from '../ai/assist'
import { BOOKS, formatRef, parseOsis, parseRef, parseRefList, refListPath, refPath, suggestRefText } from '../lib/refs'
import { onSearchProgress, searchBible, type SearchResult } from '../lib/search'
import { DEFAULTS, useStudy } from '../lib/state'
import { ACCENTS, LINE_SPACING, SCRIPTURE_FONTS, TONES, UI_FONTS } from '../lib/appearance'
import { db } from '../db/db'
import { downloadBackup } from '../lib/dataSafety'
import { DataProtectionStatus, RestoreBackup } from '../components/DataSafety'
import { OfflineSettings } from '../components/Offline'

// commentary search loads only when its tab is opened
const CommentarySearchControls = lazy(() => import('../components/CommentarySearchView').then((m) => ({ default: m.CommentarySearchControls })))

/* ================= Dictionary ================= */

export function DictionaryPage() {
  const [params, setParams] = useSearchParams()
  const strongs = params.get('strongs')
  const [tab, setTab] = useState<'search' | 'mine' | 'thesaurus' | 'strongs'>(strongs ? 'strongs' : 'search')
  const [editing, setEditing] = useState(false)
  const { setLookup } = useStudy()
  const mine = useLiveQuery(() => db.dict.orderBy('term').toArray(), []) ?? []
  const [tagFilter, setTagFilter] = useState('')
  const [mq, setMq] = useState('')
  const tags = [...new Set(mine.flatMap((m) => m.tags))].sort()
  useEffect(() => {
    if (strongs) setTab('strongs')
  }, [strongs])
  useEffect(() => {
    document.title = 'Dictionary · Arise Bible Study'
  }, [])
  const shown = mine.filter((m) => (!tagFilter || m.tags.includes(tagFilter)) && (!mq || [m.term, m.definition, m.notes, ...m.strongs].join(' ').toLowerCase().includes(mq.toLowerCase())))
  return (
    <div className="page stack">
      <h1>Dictionary</h1>
      <Tabs
        label="Dictionary sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'search', label: 'Bible dictionary' },
          { id: 'mine', label: `My dictionary (${mine.length})` },
          { id: 'thesaurus', label: 'Thesaurus' },
          { id: 'strongs', label: "Strong's lookup" },
        ]}
      />
      {tab === 'search' && <DictionaryPanel />}
      {tab === 'thesaurus' && <ThesaurusPanel />}
      {tab === 'strongs' && (
        <div className="stack">
          <StrongsLookup onOpen={(id) => setParams({ strongs: id })} />
          {strongs ? <StrongsCard id={strongs} onOpen={(id) => setParams({ strongs: id })} /> : <Empty>Enter a Strong's number to open its entry and every KJV verse where it is tagged.</Empty>}
          <ContextNote />
        </div>
      )}
      {tab === 'mine' &&
        (editing ? (
          <div className="card">
            <DictEntryEditor onDone={() => setEditing(false)} />
          </div>
        ) : (
          <div className="stack">
            <div className="row">
              <input type="search" placeholder="Search my entries" value={mq} onChange={(e) => setMq(e.target.value)} style={{ flex: 1 }} aria-label="Search my entries" />
              <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filter by tag">
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t} value={t}>#{t}</option>
                ))}
              </select>
              <button className="btn primary" onClick={() => setEditing(true)}>
                <Plus size={16} /> New entry
              </button>
            </div>
            {!mine.length && <Empty>Your own definitions, word studies, and notes will appear here. They are always kept separate from published sources.</Empty>}
            <ul className="list">
              {shown.map((m) => (
                <li key={m.id}>
                  <div className="row">
                    <button
                      className="reflink"
                      style={{ fontWeight: 600 }}
                      onClick={() => {
                        setLookup(m.term)
                        setTab('search')
                      }}
                    >
                      {m.term}
                    </button>
                    <SourceBadge source="personal" />
                    {m.strongs.map((s) => (
                      <button key={s} className="chip" onClick={() => setParams({ strongs: s })}>{s}</button>
                    ))}
                    <span className="spacer" />
                    <span className="muted small">{timeAgo(m.updatedAt)}</span>
                  </div>
                  <div className="small"><LinkedText text={m.definition.slice(0, 240)} /></div>
                  {m.tags.length > 0 && <div className="row small">{m.tags.map((t) => <span key={t} className="badge">#{t}</span>)}</div>}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  )
}

/* ================= Saved studies ================= */

export function SavedStudiesPage() {
  const nav = useNavigate()
  const studies = useLiveQuery(() => db.studies.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const bookmarks = useLiveQuery(() => db.bookmarks.orderBy('createdAt').reverse().toArray(), []) ?? []
  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), []) ?? []
  const sessions = useLiveQuery(() => db.sessions.orderBy('at').reverse().limit(15).toArray(), []) ?? []
  const [tab, setTab] = useState<'studies' | 'notes' | 'bookmarks' | 'recent'>('studies')
  const [q, setQ] = useState('')
  useEffect(() => {
    document.title = 'Saved Studies · Arise Bible Study'
  }, [])
  const ql = q.toLowerCase()
  return (
    <div className="page stack">
      <div className="row">
        <h1 style={{ margin: 0 }}>Saved Studies</h1>
        <span className="spacer" />
        <Link className="btn primary" to="/study">
          <Plus size={16} /> New study
        </Link>
      </div>
      {sessions[0] && (
        <div className="notice info row">
          <Clock size={16} aria-hidden /> Pick up where you left off: <Link to={sessions[0].path}>{sessions[0].label}</Link>
          <span className="muted small">({timeAgo(sessions[0].at)})</span>
        </div>
      )}
      <Tabs
        label="Saved items"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'studies', label: `Studies (${studies.length})` },
          { id: 'notes', label: `Verse notes (${notes.length})` },
          { id: 'bookmarks', label: `Bookmarks (${bookmarks.length})` },
          { id: 'recent', label: 'Recent' },
        ]}
      />
      {tab !== 'recent' && <input type="search" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter" />}
      {tab === 'studies' && (
        <ul className="list">
          {!studies.length && <Empty>No studies yet. Select verses in the Bible and choose “Study this passage”.</Empty>}
          {studies
            .filter((s) => !q || [s.title, ...s.tags].join(' ').toLowerCase().includes(ql))
            .map((s) => (
              <li key={s.id}>
                <div className="row">
                  <Link to={`/study/${s.id}`} style={{ fontWeight: 600 }}>{s.title}</Link>
                  {parseOsis(s.passage) && <ScriptureRef r={s.passage} />}
                  <span className="spacer" />
                  <span className="muted small">edited {timeAgo(s.updatedAt)}</span>
                </div>
                <div className="muted small">
                  {Object.values(s.sections).reduce((a, b) => a + b.length, 0)} items
                  {s.tags.map((t) => (
                    <span key={t} className="badge" style={{ marginLeft: 6 }}>#{t}</span>
                  ))}
                </div>
              </li>
            ))}
        </ul>
      )}
      {tab === 'notes' && (
        <ul className="list">
          {!notes.length && <Empty>Select a verse number in the reader and choose “Note”.</Empty>}
          {notes
            .filter((n) => !q || [n.text, ...n.tags].join(' ').toLowerCase().includes(ql))
            .map((n) => (
              <li key={n.id}>
                <div className="row">
                  <NotebookPen size={14} className="muted" aria-hidden />
                  <ScriptureRef r={n.ref} />
                  <span className="spacer" />
                  <span className="muted small">{timeAgo(n.updatedAt)}</span>
                </div>
                <div className="block note" style={{ marginTop: 4 }}><LinkedText text={n.text} /></div>
              </li>
            ))}
        </ul>
      )}
      {tab === 'bookmarks' && (
        <ul className="list">
          {!bookmarks.length && <Empty>Select a verse number in the reader and choose “Bookmark”.</Empty>}
          {bookmarks
            .filter((b) => !q || b.label.toLowerCase().includes(ql))
            .map((b) => (
              <li key={b.id} className="row">
                <Bookmark size={14} className="muted" aria-hidden />
                <ScriptureRef r={b.key} />
                <span className="spacer" />
                <button
                  className="iconbtn"
                  aria-label={`Remove bookmark ${b.label}`}
                  onClick={async () => {
                    await db.bookmarks.delete(b.id)
                    toastUndo('Bookmark removed', () => db.bookmarks.put(b))
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
        </ul>
      )}
      {tab === 'recent' && (
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id} className="row">
              <button className="reflink" onClick={() => nav(s.path)}>{s.label}</button>
              <span className="badge">{s.kind}</span>
              <span className="spacer" />
              <span className="muted small">{timeAgo(s.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ================= Search ================= */

export function SearchPage() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const q = params.get('q') ?? ''
  const scope = params.get('scope') ?? 'all'
  const mode = (params.get('mode') ?? 'all') as 'all' | 'phrase' | 'any'
  const whole = params.get('whole') !== '0'
  const tr = params.get('t') ?? 'KJV'
  const forms = params.get('forms') === '1'
  const where = params.get('in') === 'commentaries' ? 'commentaries' : 'bible'
  const works = params.get('w') ? [params.get('w')!] : []
  const isPhrase = mode === 'phrase' || /^\s*".+"\s*$/.test(q)
  const [input, setInput] = useState(q)
  const [progress, setProgress] = useState<string>('')
  const [res, setRes] = useState<SearchResult | null>(null)
  const [err, setErr] = useState<Error | null>(null)
  const [limit, setLimit] = useState(100)
  const { data: tIndex } = useAsync(() => loadTranslationIndex().catch(() => []), [])
  const trInfo = tIndex?.find((t) => t.id === tr)
  const refHint = q ? suggestRefText(q) : undefined
  useEffect(() => setInput(q), [q])

  useEffect(() => {
    if (!q.trim() || where === 'commentaries') return
    // References and Strong's numbers jump straight to their pages
    const r = parseRef(q)
    if (r) {
      nav(refPath(r), { replace: true })
      return
    }
    const list = parseRefList(q)
    if (list) {
      nav(refListPath(list), { replace: true })
      return
    }
    const sm = /^\s*([HhGg])0*(\d{1,4})\s*$/.exec(q)
    if (sm) {
      nav(`/dictionary?strongs=${sm[1].toUpperCase()}${parseInt(sm[2], 10)}`, { replace: true })
      return
    }
    let alive = true
    setErr(null)
    setRes(null)
    onSearchProgress((d, t) => alive && setProgress(d < t ? 'Preparing the search index…' : ''))
    searchBible({ query: q, mode, scope, wholeWord: whole, limit, translation: tr, forms: forms && !isPhrase }, (p) => alive && setRes(p)).then(
      (r2) => alive && setRes(r2),
      (e) => alive && setErr(e),
    )
    return () => {
      alive = false
      onSearchProgress(null)
    }
  }, [q, scope, mode, whole, limit, tr, forms, isPhrase, nav, where])

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    p.set(k, v)
    setParams(p)
  }
  const added = res?.formsUsed.flat() ?? []
  return (
    <div className="page stack">
      <h1>{where === 'bible' ? 'Search the Bible' : 'Search the commentaries'}</h1>
      <Tabs
        label="What to search"
        value={where}
        onChange={(v) => {
          const p = new URLSearchParams(params)
          if (v === 'bible') p.delete('in')
          else p.set('in', v)
          setParams(p)
        }}
        tabs={[
          { id: 'bible', label: 'Scripture' },
          { id: 'commentaries', label: 'Commentaries' },
        ]}
      />
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          set('q', input)
        }}
      >
        <input type="search" value={input} onChange={(e) => setInput(e.target.value)} placeholder={where === 'bible' ? 'Word, phrase in "quotes", reference (Rom 8:28), or Strong\'s number (G26)' : 'A word or phrase in the commentaries, e.g. new birth'} style={{ flex: 1, minWidth: 220 }} aria-label="Search" autoFocus={!q} />
        <button className="btn primary">Search</button>
      </form>
      {where === 'commentaries' && (
        <Suspense fallback={<Loading />}>
          <CommentarySearchControls q={q} mode={mode} scope={scope} works={works} set={set} />
        </Suspense>
      )}
      {where === 'bible' && (
      <>
      <div className="row small" style={{ flexWrap: 'wrap' }}>
        <label>
          Translation{' '}
          <select value={tr} onChange={(e) => set('t', e.target.value)} aria-label="Translation to search">
            <option value="KJV">KJV</option>
            {tIndex?.map((t) => (
              <option key={t.id} value={t.id}>{t.id}</option>
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
          In{' '}
          <select value={scope} onChange={(e) => set('scope', e.target.value)}>
            <option value="all">whole Bible</option>
            <option value="OT">Old Testament</option>
            <option value="NT">New Testament</option>
            {BOOKS.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 4 }}>
          <input type="checkbox" checked={whole} onChange={(e) => set('whole', e.target.checked ? '1' : '0')} /> whole words only
        </label>
        <label className="row" style={{ gap: 4 }} title={isPhrase ? 'Exact phrases are always matched exactly' : undefined}>
          <input type="checkbox" checked={forms && !isPhrase} disabled={isPhrase} onChange={(e) => set('forms', e.target.checked ? '1' : '0')} /> include related word forms (believe, believed, believeth)
        </label>
        <span className="muted">Tip: add * for word endings, e.g. believ*</span>
      </div>
      {refHint && (
        <div className="notice info small" data-testid="ref-suggestion">
          Looking for a passage? Did you mean <Link to={`/search?q=${encodeURIComponent(refHint)}`}>{refHint}</Link>?
        </div>
      )}
      {progress && <Loading label={progress} />}
      {err && <ErrorBox error={err} />}
      {q && !res && !err && !progress && <Loading label="Searching" />}
      {res && (
        <>
          <div className="muted">
            {res.total} verse{res.total === 1 ? '' : 's'} found{res.total > res.hits.length ? `, showing ${res.hits.length}` : ''} in the {tr === 'KJV' ? 'King James Version' : trInfo?.name ?? tr}.
          </div>
          {added.length > 0 && (
            <div className="small muted" data-testid="forms-used">
              Including related word forms: {added.slice(0, 20).join(', ')}
              {added.length > 20 ? ` and ${added.length - 20} more` : ''}.
            </div>
          )}
          {res.total === 0 && res.suggestion && (
            <div className="notice info small" data-testid="search-suggestion">
              Did you mean{' '}
              <button className="reflink" onClick={() => set('q', res.suggestion!)}>
                {res.suggestion}
              </button>
              ?
            </div>
          )}
          <ul className="list occ-list">
            {res.hits.map((h) => (
              <li key={h.key}>
                <ScriptureRef r={h.key} preview={false} />{' '}
                {res.partial ? <span className="muted">…</span> : <Highlighted text={h.text} term={res.terms.length === 1 && !added.length ? res.terms[0].replace(/\*$/, '') : ''} />}
              </li>
            ))}
          </ul>
          {res.total > res.hits.length && (
            <button className="btn" onClick={() => setLimit(limit + 200)}>Show more</button>
          )}
          {tr !== 'KJV' && trInfo && (
            <p className="small muted" style={{ margin: 0 }}>
              Text: {trInfo.name} ({trInfo.year}), {trInfo.license}. <Link to="/sources">Sources and licenses</Link>
            </p>
          )}
          {q && (
            <p className="small" style={{ margin: 0 }} data-testid="also-commentaries">
              <Link to={`/search?in=commentaries&q=${encodeURIComponent(q)}&mode=${mode}${scope !== 'all' ? `&scope=${scope}` : ''}`}>Search the commentaries for “{q}”</Link>
            </p>
          )}
        </>
      )}
      </>
      )}
    </div>
  )
}

/* ================= Settings ================= */

export function SettingsPage() {
  const { settings, updateSettings } = useStudy()
  useEffect(() => {
    document.title = 'Settings · Arise Bible Study'
  }, [])
  return (
    <div className="page stack" style={{ maxWidth: 760 }}>
      <h1>Settings</h1>
      <AppearanceSettings />
      <TranslationSettings />
      <section className="card stack">
        <h2>AI study assistant (optional)</h2>
        <label className="row"><input type="checkbox" checked={settings.aiEnabled} onChange={(e) => updateSettings({ aiEnabled: e.target.checked })} /> Turn on the AI assistant</label>
        <p className="small muted" style={{ margin: 0 }}>
          When on, an “AI” tab appears in the Study Workspace. It sends the study you are working on (passage text, your word studies and notes) to
          Anthropic's Claude to organize observations, suggest questions, summarize, or draft an outline. Results are labeled as AI drafts, cite their
          passages, and are checked against the KJV and Strong's data. It needs <code>ANTHROPIC_API_KEY</code> set on the server.
        </p>
        {settings.aiEnabled && <AiCodeField />}
      </section>
      <section className="card stack">
        <h2>Your data</h2>
        <p className="small" style={{ margin: 0 }}>
          Notes, highlights, studies, sermons, and dictionary entries are saved in this browser on this device. Download a backup regularly, and use
          it to move your work to another device or browser.
        </p>
        <DataProtectionStatus />
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              await downloadBackup()
              toast('Backup downloaded')
            }}
          >
            <Download size={16} /> Download backup
          </button>
          <RestoreBackup />
        </div>
        <label className="row">
          <input type="checkbox" checked={settings.errorReports} onChange={(e) => updateSettings({ errorReports: e.target.checked })} /> Send anonymous
          error reports
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          If something breaks, the app sends only the error message, the part of the code where it happened, the page name, and your browser type.
          Never your notes, studies, sermons, highlights, or settings.
        </p>
      </section>
      <section className="card stack">
        <h2>Offline reading</h2>
        <OfflineSettings />
      </section>
      <section className="card stack">
        <h2>Keyboard shortcuts</h2>
        <KeyboardHelp />
      </section>
    </div>
  )
}

export function KeyboardHelp() {
  return (
    <dl className="kv">
      <dt><kbd>/</kbd></dt><dd>Search the Bible</dd>
      <dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous or next chapter</dd>
      <dt><kbd>Tab</kbd>, <kbd>Enter</kbd></dt><dd>Move through words and open the word study</dd>
      <dt><kbd>Shift</kbd>+click</dt><dd>Select a range of verses by number</dd>
      <dt><kbd>Esc</kbd></dt><dd>Clear verse selection or close a dialog</dd>
      <dt><kbd>g</kbd> then <kbd>b</kbd>/<kbd>w</kbd>/<kbd>d</kbd>/<kbd>s</kbd>/<kbd>l</kbd></dt><dd>Go to Bible, Workspace, Dictionary, Sermons, Saved studies</dd>
      <dt><kbd>?</kbd></dt><dd>Show this help</dd>
    </dl>
  )
}

/* ================= Sources ================= */

export function SourcesPage() {
  const { data, error, loading } = useAsync(loadSources, [])
  useEffect(() => {
    document.title = 'Sources · Arise Bible Study'
  }, [])
  return (
    <div className="page stack" style={{ maxWidth: 860 }}>
      <h1>Sources and licensing</h1>
      <p>
        Every word of Scripture, every Strong's entry, every cross-reference, and every dictionary article in this app comes from the published
        sources below. Nothing is generated or guessed. The only app-written content is the clearly labeled archaic-word list.
      </p>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          {data.sources.map((s) => (
            <section key={s.id} className="card stack">
              <div className="row">
                <h2 style={{ margin: 0 }}>{s.name}</h2>
                <span className={`badge ${s.kind === 'editorial' ? 'editorial' : 'source'}`}>{s.kind}</span>
              </div>
              <dl className="kv">
                <dt>Provider</dt>
                <dd>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.provider}</a> : s.provider}</dd>
                <dt>Version</dt>
                <dd>{s.version}</dd>
                <dt>License</dt>
                <dd>{s.license}</dd>
                <dt>Attribution</dt>
                <dd>{s.attribution}</dd>
              </dl>
              <p className="small" style={{ margin: 0 }}>{s.notes}</p>
              {Object.entries(s.sha256).map(([f, h]) => (
                <div key={f} className="muted small" style={{ wordBreak: 'break-all' }}>
                  SHA-256 {f}: <code>{h}</code>
                </div>
              ))}
            </section>
          ))}
          <CommentarySources />
          <section className="card stack">
            <h2>Data integrity</h2>
            <p style={{ margin: 0 }}>
              The KJV tagging uses {data.integrity.usedIds.toLocaleString()} distinct Strong's numbers. The dictionary has{' '}
              {data.integrity.lexiconEntries.toLocaleString()} entries.{' '}
              {data.integrity.missingFromLexicon.length === 0 ? (
                <strong>Every Strong's number used in the text has a dictionary entry.</strong>
              ) : (
                <>These numbers appear in the text but have no entry: {data.integrity.missingFromLexicon.join(', ')}.</>
              )}
            </p>
          </section>
          <section className="card stack">
            <h2>Not included</h2>
            <ul>
              {data.notAvailable.map((n) => (
                <li key={n.name}>
                  <strong>{n.name}:</strong> {n.reason}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <p className="small muted">
        Your notes and studies are your own and are stored only in your browser. <Link to="/settings">Back up your data</Link>. Example:{' '}
        <ScriptureRef r={parseOsis('John.3.16')!}>{formatRef(parseOsis('John.3.16')!)}</ScriptureRef>.
      </p>
    </div>
  )
}

/* ================= Appearance ================= */

function AppearanceSettings() {
  const { settings, updateSettings } = useStudy()
  const sf = SCRIPTURE_FONTS.find((f) => f.id === settings.scriptureFont) ?? SCRIPTURE_FONTS[0]
  const uf = UI_FONTS.find((f) => f.id === settings.uiFont) ?? UI_FONTS[0]
  return (
    <section className="card stack" aria-labelledby="appearance-h">
      <div className="row">
        <h2 id="appearance-h" style={{ margin: 0 }}>Appearance</h2>
        <span className="spacer" />
        <button
          className="btn sm"
          onClick={() =>
            updateSettings({
              theme: DEFAULTS.theme, accent: DEFAULTS.accent, tone: DEFAULTS.tone, scriptureFont: DEFAULTS.scriptureFont,
              uiFont: DEFAULTS.uiFont, lineSpacing: DEFAULTS.lineSpacing, readerSize: DEFAULTS.readerSize, uiSize: DEFAULTS.uiSize,
            })
          }
        >
          Reset to default
        </button>
      </div>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>View</legend>
        <div className="choice-grid">
          {([
            ['light', 'Daylight', '☀', 'Light background'],
            ['dark', 'Dark', '☾', 'Easy on the eyes at night'],
            ['system', 'Match my device', '◐', 'Follows your phone or computer'],
          ] as const).map(([id, label, icon, hint]) => (
            <button key={id} className="choice" aria-pressed={settings.theme === id} onClick={() => updateSettings({ theme: id })}>
              <span style={{ fontSize: 22 }} aria-hidden>{icon}</span>
              <strong>{label}</strong>
              <span className="muted small">{hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Color theme</legend>
        <div className="choice-grid">
          {ACCENTS.map((a) => (
            <button key={a.id} className="choice" aria-pressed={settings.accent === a.id} onClick={() => updateSettings({ accent: a.id })}>
              <span className="row" style={{ gap: 4 }}>
                <span className="dot" style={{ background: a.light }} aria-hidden />
                <span className="dot" style={{ background: a.dark }} aria-hidden />
              </span>
              <strong>{a.label}</strong>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Page color (Daylight view)</legend>
        <div className="choice-grid">
          {TONES.map((t) => (
            <button key={t.id} className="choice" aria-pressed={settings.tone === t.id} onClick={() => updateSettings({ tone: t.id })}>
              <span className="dot" style={{ background: t.swatch }} aria-hidden />
              <strong>{t.label}</strong>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid-2">
        <label className="field">
          <span>Bible text font</span>
          <select value={sf.id} onChange={(e) => updateSettings({ scriptureFont: e.target.value })}>
            {SCRIPTURE_FONTS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          {sf.note && <span className="small" style={{ fontWeight: 400 }}>{sf.note}</span>}
        </label>
        <label className="field">
          <span>App font (menus, notes, tools)</span>
          <select value={uf.id} onChange={(e) => updateSettings({ uiFont: e.target.value })}>
            {UI_FONTS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          {uf.note && <span className="small" style={{ fontWeight: 400 }}>{uf.note}</span>}
        </label>
        <label className="field">
          <span>Bible text size: {settings.readerSize}px</span>
          <input type="range" min={14} max={32} value={settings.readerSize} onChange={(e) => updateSettings({ readerSize: parseInt(e.target.value, 10) })} />
        </label>
        <label className="field">
          <span>App text size: {settings.uiSize}px</span>
          <input type="range" min={13} max={20} value={settings.uiSize} onChange={(e) => updateSettings({ uiSize: parseInt(e.target.value, 10) })} />
        </label>
        <label className="field">
          <span>Line spacing</span>
          <select value={settings.lineSpacing} onChange={(e) => updateSettings({ lineSpacing: e.target.value })}>
            {LINE_SPACING.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className="muted small" style={{ marginBottom: 4 }}>Preview</div>
        <div className="card" style={{ background: 'var(--bg)' }}>
          <div className={`reader ${settings.redLetters ? 'red-on' : ''}`} style={{ padding: 0, margin: 0 }}>
            <span className="verse vline">
              <span className="vnum">16</span>
              <span className="red">For God so <span className="w sel">loved</span> the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.</span>
            </span>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm primary">Study this passage</button>
            <span className="badge source">Strong's G25</span>
            <a className="reflink" href="#" onClick={(e) => e.preventDefault()}>John 3:16</a>
          </div>
        </div>
      </div>

      <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <label className="row"><input type="checkbox" checked={settings.redLetters} onChange={(e) => updateSettings({ redLetters: e.target.checked })} /> Show the words of Jesus in red</label>
        <label className="row"><input type="checkbox" checked={settings.showTagged} onChange={(e) => updateSettings({ showTagged: e.target.checked })} /> Underline words that have Strong's numbers</label>
        <label className="row"><input type="checkbox" checked={settings.showMarginNotes} onChange={(e) => updateSettings({ showMarginNotes: e.target.checked })} /> Show the 1611 translators' margin notes</label>
      </div>
    </section>
  )
}

/* ================= Translations ================= */

function TranslationSettings() {
  const { settings, updateSettings } = useStudy()
  const { data, error, loading } = useAsync(loadTranslationIndex, [])
  return (
    <section className="card stack" aria-labelledby="tr-h">
      <h2 id="tr-h" style={{ margin: 0 }}>Bible translations</h2>
      <p className="small" style={{ margin: 0 }}>
        Choose what the Bible reader shows. The KJV carries the Strong's word tagging, so word study, italics, and margin notes use the KJV.
        New studies and sermons quote Scripture in the translation you pick below, and each one remembers its translation.
      </p>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <div className="grid-2">
            <label className="field">
              <span>Read in</span>
              <select value={settings.translation} onChange={(e) => updateSettings({ translation: e.target.value })}>
                <option value="KJV">King James Version (KJV) with Strong's</option>
                {data.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Quote Scripture in (new studies and sermons)</span>
              <select value={settings.quoteTranslation} onChange={(e) => updateSettings({ quoteTranslation: e.target.value })}>
                <option value="">Same as my reading translation ({settings.translation})</option>
                <option value="KJV">Always King James Version (KJV)</option>
                {data.map((t) => (
                  <option key={t.id} value={t.id}>Always {t.name} ({t.id})</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Compare with (shown under each verse)</span>
              <select value={settings.compareWith} onChange={(e) => updateSettings({ compareWith: e.target.value })}>
                <option value="">Off</option>
                <option value="KJV">King James Version (KJV)</option>
                {data.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>
            </label>
          </div>
          <ul className="list">
            <li>
              <strong>KJV</strong> King James Version (1769) <span className="badge source">Strong's tagged</span>
              <div className="muted small">Public domain. CrossWire Bible Society text.</div>
            </li>
            {data.map((t) => (
              <li key={t.id}>
                <strong>{t.id}</strong> {t.name} ({t.year})
                <div className="muted small">{t.note} {t.license}.</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ================= AI access code ================= */

function AiCodeField() {
  const [code, setCode] = useState(getAiCode())
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error' | 'info'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    setAiCode(code.trim())
    const st = await aiStatus(true)
    setBusy(false)
    if (!st.reachable) setMsg({ kind: 'error', text: 'Could not reach the assistant on this deployment.' })
    else if (!st.codeConfigured) setMsg({ kind: 'error', text: 'The site has no AI_ACCESS_CODE set yet, so the assistant stays locked.' })
    else if (!code.trim()) setMsg({ kind: 'info', text: 'Code removed from this device.' })
    else if (st.codeValid) setMsg({ kind: 'ok', text: 'Code accepted. The assistant is ready on this device.' })
    else setMsg({ kind: 'error', text: 'That code was not accepted. After 10 wrong tries, codes are locked for an hour.' })
  }
  return (
    <div className="stack">
      <label className="field">
        <span>AI access code (kept only on this device, not in backups)</span>
        <input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code set by the site owner" />
      </label>
      <div className="row">
        <button className="btn" onClick={check} disabled={busy}>
          {busy ? 'Checking…' : 'Save and check code'}
        </button>
      </div>
      {msg && <div className={`notice ${msg.kind === 'ok' ? 'ok' : msg.kind === 'error' ? 'error' : 'info'} small`}>{msg.text}</div>}
      <p className="small muted" style={{ margin: 0 }}>
        The server also limits how often the assistant can be used each minute and each day, so a leaked code cannot run up costs.
      </p>
    </div>
  )
}

/** Commentary rights records, and works not included with the reason. */
function CommentarySources() {
  const { data } = useAsync(loadCommentaryIndex, [])
  if (!data) return null
  return (
    <section className="card stack" data-testid="commentary-sources">
      <h2 style={{ margin: 0 }}>Commentaries</h2>
      <p className="small" style={{ margin: 0 }}>
        Each commentary is included only after its edition, source file, and redistribution rights were checked. The text is the source's own;
        the app only separates introductions from verse notes and labels Bible text that a commentary reprints.
      </p>
      {data.works.map((w) => (
        <div key={w.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div className="row">
            <strong>{w.short}</strong> <span className="badge source">approved</span>
          </div>
          <dl className="kv">
            <dt>Work</dt>
            <dd>{w.title}</dd>
            <dt>Author</dt>
            <dd>{w.author}</dd>
            <dt>Published</dt>
            <dd>{w.era}</dd>
            <dt>Edition</dt>
            <dd>{w.edition}</dd>
            <dt>Copyright</dt>
            <dd>{w.copyright}</dd>
            <dt>License</dt>
            <dd>{w.license}</dd>
            <dt>Permitted use</dt>
            <dd>{w.scope}</dd>
            <dt>Attribution</dt>
            <dd>{w.attribution}</dd>
            <dt>Version</dt>
            <dd>{w.version}</dd>
            <dt>Source</dt>
            <dd style={{ wordBreak: 'break-word' }}>{w.source}</dd>
            <dt>Coverage</dt>
            <dd>
              {w.books} books, {w.chapters} chapters
            </dd>
          </dl>
        </div>
      ))}
      <h3 style={{ marginBottom: 0 }}>Not included</h3>
      <ul className="list small">
        {data.notIncluded.map((w) => (
          <li key={w.id}>
            <strong>
              {w.author}, {w.title}
            </strong>{' '}
            <span className="badge">{w.status === 'review' ? 'under review' : 'not verified'}</span>
            <br />
            {w.reason}
          </li>
        ))}
      </ul>
    </section>
  )
}
