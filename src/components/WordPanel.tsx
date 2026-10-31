import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookA, Info, Languages, Plus } from 'lucide-react'
import { loadChapter, loadConcordance, loadStrongs, parseWord, segText, verseText, type StrongsEntry } from '../lib/data'
import { decodeNumericKey, formatRef, toOsis } from '../lib/refs'
import { describeMorph } from '../lib/morph'
import { Suspense, lazy } from 'react'
// original-language sections load with the first word study
const ow = () => import('./OriginalWord')
const OriginalInVerseL = lazy(() => ow().then((m) => ({ default: m.OriginalInVerse })))
const BdbSectionL = lazy(() => ow().then((m) => ({ default: m.BdbSection })))
const FormsSectionL = lazy(() => ow().then((m) => ({ default: m.FormsSection })))
const PassageWordsL = lazy(() => ow().then((m) => ({ default: m.PassageWords })))
const OriginalInVerse = (p: Parameters<typeof OriginalInVerseL>[0]) => <Suspense fallback={<Loading />}><OriginalInVerseL {...p} /></Suspense>
const BdbSection = (p: Parameters<typeof BdbSectionL>[0]) => <Suspense fallback={null}><BdbSectionL {...p} /></Suspense>
const FormsSection = (p: Parameters<typeof FormsSectionL>[0]) => <Suspense fallback={null}><FormsSectionL {...p} /></Suspense>
const PassageWords = (p: Parameters<typeof PassageWordsL>[0]) => <Suspense fallback={<Loading />}><PassageWordsL {...p} /></Suspense>
import { parseOsis } from '../lib/refs'
import { useStudy, useStudySink } from '../lib/state'
import { uid } from '../db/db'
import { Empty, ErrorBox, Loading, toast, useAsync } from './ui'
import { ScriptureRef, SourceHtml } from './Scripture'

export function ContextNote() {
  return (
    <div className="notice info small">
      <div className="row">
        <Info size={14} aria-hidden /> <strong>Meaning depends on context</strong>
      </div>
      A lexicon lists the range of meanings a word can carry across many passages. Not every sense applies here, and a word's root or
      history does not decide its meaning in a given verse. Let the passage, its grammar, and its use elsewhere guide you.
    </div>
  )
}

/** Shows what the clicked English words stand for in Hebrew or Greek. */
export function WordPanel() {
  const { selection, setLookup, focusVerse } = useStudy()
  const sink = useStudySink()
  // in a study, list the passage's words; elsewhere, the chosen verse's words
  const passage = sink ? parseOsis(sink.study.passage) : focusVerse ? { ...focusVerse, endVerse: undefined } : null
  const [stack, setStack] = useState<string[]>([]) // Strong's ids opened via "related" links

  useEffect(() => setStack([]), [selection])

  const { data: chapterData, error, loading } = useAsync(
    () => (selection ? loadChapter(selection.book, selection.chapter) : Promise.resolve(undefined)),
    [selection?.book, selection?.chapter],
  )

  if (stack.length) {
    return (
      <div className="stack">
        <button className="btn sm ghost" onClick={() => setStack((s) => s.slice(0, -1))}>
          <ArrowLeft size={15} /> Back
        </button>
        <StrongsCard id={stack[stack.length - 1]} onOpen={(id) => setStack((s) => [...s, id])} />
      </div>
    )
  }

  if (!selection) {
    return (
      <div className="stack">
        <Empty>
          Click any word in the Bible text to see the Hebrew or Greek word behind it. Turn on the <Languages size={14} aria-label="underline" />
          {' '}link icon in the reader toolbar to underline every word that has a Strong's number.
        </Empty>
        {passage?.verse !== undefined && (
          <PassageWords book={passage.book} chapter={passage.chapter} from={passage.verse} to={(passage.endChapter ?? passage.chapter) === passage.chapter ? (passage.endVerse ?? passage.verse) : 999} />
        )}
        <StrongsLookup onOpen={(id) => setStack([id])} />
        <ContextNote />
      </div>
    )
  }
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} />
  if (selection.orig) {
    // chosen in the interlinear view: study that exact Hebrew/Greek word
    const r = { book: selection.book, chapter: selection.chapter, verse: selection.verse }
    return (
      <div className="stack">
        <div>
          <div className="small muted">Interlinear · {formatRef(r)} · word {selection.orig.index + 1}</div>
          <div className="word-english">“{selection.english.replace(/\//g, ' ').replace(/\s+/g, ' ')}”</div>
        </div>
        <OriginalInVerse book={selection.book} chapter={selection.chapter} verse={selection.verse} ids={[selection.orig.strongs]} index={selection.orig.index} />
        <StrongsCard id={selection.orig.strongs} occurrence={{ ref: toOsis(r), english: selection.english, verseText: '' }} onOpen={(rid) => setStack([rid])} />
        <ContextNote />
      </div>
    )
  }
  const verse = chapterData?.verses.find((v) => v.v === selection.verse)
  if (!verse) return <ErrorBox error={new Error('That verse could not be found.')} />
  const ref = { book: selection.book, chapter: selection.chapter, verse: selection.verse }

  const lookupButtons = (
    <div className="row">
      <button className="btn sm" onClick={() => setLookup(cleanWord(selection.english), 'dictionary')}>
        <BookA size={15} /> Dictionary
      </button>
      <button className="btn sm" onClick={() => setLookup(cleanWord(selection.english), 'thesaurus')}>
        Thesaurus
      </button>
    </div>
  )

  if (selection.word < 0) {
    const seg = verse.s[selection.segIndex]
    const added = ((seg?.[1] ?? 0) & 1) === 1
    return (
      <div className="stack">
        <EnglishHeader english={selection.english} refText={formatRef(ref)} />
        {added ? (
          <div className="notice warn">
            <strong>Added by the translators.</strong> The KJV prints these words in italics because they have no matching word in the
            Hebrew or Greek. The translators supplied them to make the English read naturally. There is no Strong's entry to show.
          </div>
        ) : (
          <div className="notice warn">
            <strong>No Strong's mapping.</strong> The source tagging does not link this word to a Hebrew or Greek word, so no entry is
            shown. This app does not guess mappings.
          </div>
        )}
        {lookupButtons}
      </div>
    )
  }

  const words = verse.w ?? []
  const info = parseWord(words[selection.word] ?? '')
  // full English rendering for this original word, including split parts ("made ... to grow")
  const groupIdx = words
    .map((w, i) => ({ i, p: parseWord(w) }))
    .filter(({ i, p }) => i === selection.word || (info.split && p.split === info.split && p.strongs.join() === info.strongs.join()))
    .map(({ i }) => i)
  const english = groupIdx
    .map((i) => verse.s.filter((s) => s[2] === i).map(segText).join(''))
    .filter(Boolean)
    .join(' … ')
  const wordCount = english.replace('…', ' ').trim().split(/\s+/).length
  // Grammar words (the Greek article, the Hebrew object marker) go after the main word, in compact form.
  const mainIds = info.strongs.filter((id) => !MINOR[id])
  const minorIds = info.strongs.filter((id) => MINOR[id])

  if (!info.strongs.length) {
    return (
      <div className="stack">
        <EnglishHeader english={english || selection.english} refText={formatRef(ref)} />
        <div className="notice warn">
          <strong>No Strong's number.</strong> The source marks this as a word but gives no Strong's number for it. Nothing is shown rather
          than a guess.
        </div>
        {lookupButtons}
      </div>
    )
  }

  return (
    <div className="stack">
      <EnglishHeader english={english} refText={formatRef(ref)} />
      {info.strongs.length > 1 && (
        <div className="notice info small">
          {mainIds.length && minorIds.length
            ? <>The main word here is <strong>{mainIds.join(', ')}</strong>. The phrase also includes {minorIds.map(minorLabel).join(' and ')}, which the KJV folds into the English.</>
            : <>This English phrase stands for <strong>{info.strongs.length} original words</strong> together ({info.strongs.join(', ')}). Each one is shown below.</>}
        </div>
      )}
      {info.strongs.length === 1 && wordCount > 1 && (
        <div className="notice small">
          {groupIdx.length > 1
            ? 'One original word is translated by English words in two places in this verse.'
            : `These ${wordCount} English words translate one original word. Prepositions, articles, or verb endings in Hebrew and Greek often need several English words.`}
        </div>
      )}
      <OriginalInVerse book={selection.book} chapter={selection.chapter} verse={selection.verse} ids={mainIds.length ? mainIds : minorIds} />
      {(mainIds.length ? mainIds : minorIds).map((id) => (
        <StrongsCard
          key={id}
          id={id}
          morph={info.morph[info.strongs.indexOf(id)]}
          tr={info.tr.split(' ')[info.strongs.indexOf(id)]}
          occurrence={{ ref: toOsis(ref), english, verseText: verseText(verse) }}
          onOpen={(rid) => setStack([rid])}
        />
      ))}
      {mainIds.length > 0 &&
        minorIds.map((id) => (
          <div key={id} className="row small" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
            <span className="badge source">Strong's {id}</span>
            <span>{minorLabel(id)}</span>
            <span className="spacer" />
            <button className="btn sm" onClick={() => setStack([id])}>Full entry</button>
          </div>
        ))}
      {lookupButtons}
      <ContextNote />
    </div>
  )
}

const MINOR: Record<string, string> = {
  G3588: 'ὁ (G3588), the Greek article "the"',
  H853: 'אֵת (H853), a Hebrew marker that points to the object of the verb and is usually not translated',
}
const minorLabel = (id: string) => MINOR[id] ?? id

function cleanWord(s: string) {
  const words = s.replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/)
  // prefer the last content word of a phrase like "and the darkness"
  const stop = new Set(['the', 'and', 'of', 'a', 'an', 'to', 'in', 'unto', 'for', 'that', 'his', 'her', 'their', 'my', 'thy', 'with', 'by', 'from', 'upon', 'shall', 'be', 'was', 'is'])
  const content = words.filter((w) => !stop.has(w.toLowerCase()))
  return (content[content.length - 1] ?? words[words.length - 1] ?? s).toLowerCase()
}

function EnglishHeader({ english, refText }: { english: string; refText: string }) {
  return (
    <div>
      <div className="small muted">English in the KJV · {refText}</div>
      <div className="word-english">“{english}”</div>
    </div>
  )
}

export function StrongsLookup({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const submit = async () => {
    const m = /^\s*([HhGg])\s*0*(\d{1,4})\s*$/.exec(q)
    if (!m) return setErr("Enter a Strong's number such as H7225 or G25.")
    const id = `${m[1].toUpperCase()}${parseInt(m[2], 10)}`
    const e = await loadStrongs(id).catch(() => undefined)
    if (!e) return setErr(`${id} is not in Strong's dictionary.`)
    setErr('')
    onOpen(id)
  }
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label className="sr-only" htmlFor="strongs-q">Strong's number</label>
      <input id="strongs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Strong's number, e.g. G26" style={{ flex: 1 }} />
      <button className="btn">Open</button>
      {err && <div className="small" style={{ color: 'var(--danger)', width: '100%' }}>{err}</div>}
    </form>
  )
}

const PAGE = 15

export function StrongsCard({
  id,
  morph,
  tr,
  occurrence,
  onOpen,
}: {
  id: string
  morph?: string
  tr?: string
  occurrence?: { ref: string; english: string; verseText: string }
  onOpen: (id: string) => void
}) {
  const { data, error, loading, reload } = useAsync(async () => {
    const [entry, conc] = await Promise.all([loadStrongs(id), loadConcordance(id)])
    return { entry, conc }
  }, [id])
  const sink = useStudySink()
  const [page, setPage] = useState(0)
  const [showSenses, setShowSenses] = useState(false)

  if (loading) return <Loading label={`Loading ${id}`} />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const e = data?.entry
  const conc = data?.conc
  if (!e)
    return (
      <div className="notice error">
        <strong>{id}</strong> is used in the KJV tagging but has no entry in the Strong's dictionary source. It is listed in the data
        integrity report on the Sources page.
      </div>
    )

  const morphInfo = morph ? describeMorph(morph) : null
  const isHeb = e.lang !== 'Greek'
  const totalRendered = conc?.kjv.reduce((a, [, n]) => a + n, 0) ?? 0

  const addToStudy = () => {
    if (!sink || !occurrence) return
    sink.add('wordStudy', {
      id: uid(),
      kind: 'word',
      strongs: e.id,
      english: occurrence.english,
      ref: occurrence.ref,
      original: `${e.lemma} (${e.xlit})`,
      gloss: [e.gloss, e.def].filter(Boolean).join('; '),
      note: '',
    })
    toast(`Added ${e.id} to Word study`)
  }

  return (
    <section className="card stack" aria-label={`Strong's ${e.id}`}>
      <div className="row">
        <span className="badge source">Strong's {e.id}</span>
        <span className="badge">{e.lang}</span>
        {e.pos && <span className="badge">{e.pos}</span>}
        <span className="spacer" />
        {sink && occurrence && (
          <button className="btn sm" onClick={addToStudy}>
            <Plus size={14} /> Add to study
          </button>
        )}
      </div>
      <div>
        <div className="small muted">Original word ({e.lang})</div>
        <div className={`orig ${isHeb ? 'hebrew' : 'greek'}`} lang={isHeb ? 'he' : 'grc'}>
          {e.lemma}
        </div>
      </div>
      <dl className="kv">
        <dt>Transliteration</dt>
        <dd>{e.xlit || <span className="muted">not in source</span>}</dd>
        <dt>Pronunciation</dt>
        <dd>{e.pron || <span className="muted">not available in the source for {e.lang} entries</span>}</dd>
        {e.gloss && (
          <>
            <dt>Short gloss</dt>
            <dd>{e.gloss} <span className="muted small">(STEPBible)</span></dd>
          </>
        )}
        {e.deriv && (
          <>
            <dt>Derivation</dt>
            <dd>
              <StrongsLinks text={e.deriv} onOpen={onOpen} />
            </dd>
          </>
        )}
        {morphInfo && (
          <>
            <dt>Form here</dt>
            <dd>
              {morphInfo.decoded ? `${morphInfo.decoded} ` : ''}
              <span className="muted small">({morphInfo.label})</span>
              {tr && (
                <>
                  <br />
                  <span className="orig greek" style={{ fontSize: '1.05em' }} lang="grc">{tr}</span> <span className="muted small">form in the Textus Receptus</span>
                </>
              )}
            </dd>
          </>
        )}
      </dl>

      <div>
        <h3>Definition <span className="badge source">Strong's</span></h3>
        <p style={{ margin: 0 }}>{e.def || <span className="muted">No definition in the source.</span>}</p>
      </div>
      {isHeb && <BdbSection id={e.id} />}
      <FormsSection id={e.id} />
      {e.senses && (
        <div>
          <button className="btn sm" onClick={() => setShowSenses((s) => !s)} aria-expanded={showSenses}>
            {showSenses ? 'Hide' : 'Show'} range of meanings <span className="badge source">Abbott-Smith 1922</span>
          </button>
          {showSenses && <SourceHtml className="senses" html={e.senses} />}
        </div>
      )}
      <div>
        <h3>How the KJV translates it</h3>
        {e.kjv && (
          <p style={{ margin: '0 0 8px' }}>
            <span className="muted small">Strong's list: </span>
            {e.kjv}
          </p>
        )}
        {conc && conc.kjv.length > 0 && (
          <>
            <div className="muted small">Counted from the tagged KJV text (whole English phrase containing the word):</div>
            <ul className="list" style={{ marginTop: 4 }}>
              {conc.kjv.slice(0, 8).map(([w, n]) => (
                <li key={w} style={{ padding: '4px 0', display: 'grid', gridTemplateColumns: '1fr 60px 34px', gap: 8, alignItems: 'center' }}>
                  <span>{w}</span>
                  <div className="bar" style={{ width: `${Math.max(6, (n / conc.kjv[0][1]) * 100)}%` }} />
                  <span className="muted small" style={{ textAlign: 'right' }}>{n}×</span>
                </li>
              ))}
            </ul>
            {conc.kjv.length > 8 && <div className="muted small">and {conc.kjv.length - 8} other renderings ({totalRendered} tagged uses in all).</div>}
            {conc.combined > 0 && <div className="muted small">Also {conc.combined} times inside a phrase shared with another original word.</div>}
            {conc.untranslated > 0 && <div className="muted small">{conc.untranslated} times with no separate English word.</div>}
          </>
        )}
      </div>
      {e.rel.length > 0 && (
        <div>
          <h3>Related words</h3>
          <div className="muted small">Entries Strong's names in the derivation or notes.</div>
          <div className="row" style={{ marginTop: 6 }}>
            {e.rel.map((r) => (
              <RelatedChip key={r} id={r} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
      <Occurrences entry={e} refs={conc?.refs ?? []} page={page} setPage={setPage} current={occurrence?.ref} />
    </section>
  )
}

function RelatedChip({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { data } = useAsync(() => loadStrongs(id), [id])
  return (
    <button className="chip" onClick={() => onOpen(id)}>
      <strong>{id}</strong> {data?.lemma} {data?.gloss ? `· ${data.gloss}` : ''}
    </button>
  )
}

function StrongsLinks({ text, onOpen }: { text: string; onOpen: (id: string) => void }) {
  const parts = text.split(/\b([HG]\d+)\b/)
  return (
    <>
      {parts.map((p, i) =>
        /^[HG]\d+$/.test(p) ? (
          <button key={i} className="reflink" onClick={() => onOpen(p)}>
            {p}
          </button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

function Occurrences({ entry, refs, page, setPage, current }: { entry: StrongsEntry; refs: number[]; page: number; setPage: (n: number) => void; current?: string }) {
  const slice = refs.slice(page * PAGE, page * PAGE + PAGE)
  const keys = useMemo(() => slice.map(decodeNumericKey), [slice.join()])
  const { data: texts, loading } = useAsync(async () => {
    // each verse's chapter file, fetched in parallel
    return Promise.all(
      keys.map(async (k) => {
        const v = (await loadChapter(k.book, k.chapter)).verses.find((x) => x.v === k.verse)
        return v ? verseText(v) : ''
      }),
    )
  }, [keys.map((k) => `${k.book}.${k.chapter}.${k.verse}`).join()])
  const pages = Math.ceil(refs.length / PAGE)
  return (
    <div>
      <h3>
        Other passages with {entry.id} <span className="muted small">({refs.length} verses)</span>
      </h3>
      {refs.length === 0 && <Empty>This entry is not tagged anywhere in the KJV text.</Empty>}
      {loading && !texts && <Loading />}
      <ul className="list occ-list">
        {keys.map((k, i) => {
          const osis = `${k.book}.${k.chapter}.${k.verse}`
          return (
            <li key={osis} style={osis === current ? { background: 'var(--accent-soft)', borderRadius: 6, padding: '8px 6px' } : undefined}>
              <ScriptureRef r={osis} preview={false} /> {osis === current && <span className="badge">this verse</span>}
              <div>{texts?.[i]}</div>
            </li>
          )
        })}
      </ul>
      {pages > 1 && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted small">
            Page {page + 1} of {pages}
          </span>
          <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
