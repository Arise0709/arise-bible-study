import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { baseStrong, loadBdb, loadForms, loadMorphTable, loadOrigChapter, plainXlit, type OrigWord } from '../lib/data'
import { parseOsis, refPath } from '../lib/refs'
import { useStudy } from '../lib/state'
import { Loading, useAsync } from './ui'
import { grammarText } from '../lib/grammar'

const EDITION: Record<string, string> = {
  T: 'This word is in the Textus Receptus (the Greek text behind the KJV) but not in modern critical editions.',
  N: 'This word is in modern critical editions but not in the Textus Receptus behind the KJV.',
  O: 'This word is found only in other Greek editions, not in the Textus Receptus or the main critical editions.',
}

/** The word(s) behind a Strong's number exactly as written in this verse, from STEPBible's tagged Hebrew/Greek text. */
export function OriginalInVerse({ book, chapter, verse, ids, index }: { book: string; chapter: number; verse: number; ids: string[]; index?: number }) {
  const { settings } = useStudy()
  const level = settings.studyLevel
  const { data, loading } = useAsync(async () => {
    const ch = await loadOrigChapter(book, chapter)
    const table = await loadMorphTable(ch.l)
    return { ch, table }
  }, [book, chapter])
  if (loading) return <Loading label="Loading the original text" />
  if (!data) return null
  const { ch, table } = data
  const lang = ch.l === 'H' ? 'Hebrew' : 'Greek'
  const words = ch.v[String(verse)] ?? []
  const matches = words.map((w, i) => ({ w, i })).filter(({ w, i }) => (index === undefined || i === index) && ids.includes(baseStrong(ch.l === 'H' ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3]) ?? ''))
  if (!matches.length)
    return (
      <div className="notice small" data-testid="orig-in-verse">
        The {lang} text of this verse has no word tagged {ids.join(', ')}. The KJV's word tags and the tagged {lang} text sometimes number or
        divide words differently, so no form is shown rather than a guess.
      </div>
    )
  return (
    <section className="card stack" data-testid="orig-in-verse" aria-label={`As written in this verse (${lang})`}>
      <div className="row small">
        <strong>As written in this verse</strong>
        <span className="spacer" />
        <span className="badge source">STEPBible {ch.l === 'H' ? 'TAHOT' : 'TAGNT'}</span>
      </div>
      {matches.length > 1 && <div className="small muted">This word occurs {matches.length} times in the verse.</div>}
      {matches.map(({ w, i }) => (
        <WordForm key={i} w={w} lang={ch.l} table={table} level={level} position={i + 1} />
      ))}
    </section>
  )
}

function WordForm({ w, lang, table, level, position }: { w: OrigWord; lang: 'H' | 'G'; table: Record<string, string>; level: 'beginner' | 'advanced'; position: number }) {
  if (lang === 'H') {
    const [text, xlit, gloss, tags, gram, sense, q] = w
    const parts = text.split('/')
    const codes = gram.split('/')
    const strongParts = tags.split('/')
    return (
      <div className="stack" style={{ gap: 4 }}>
        <div className="orig hebrew" lang="he" dir="rtl" style={{ fontSize: '1.6em' }}>
          {parts.join('')}
        </div>
        <dl className="kv">
          <dt>Transliteration</dt>
          <dd>{plainXlit(xlit)}</dd>
          <dt>In this verse</dt>
          <dd>
            “{gloss.replace(/\//g, '').replace(/\s+/g, ' ')}”{sense && <span className="muted"> · sense: {sense}</span>}
          </dd>
          <dt>Grammar</dt>
          <dd>
            {parts.length > 1 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {parts.map((p, k) => (
                  <li key={k}>
                    <span lang="he" dir="rtl" className="hebrew">{p.replace(/\\/g, '')}</span> ({/\{/.test(strongParts[k] ?? '') ? 'main word' : 'attached part'}):{' '}
                    {table[codes[k]] ? grammarText(table[codes[k]], level) : codes[k]}
                    {level === 'advanced' && <code className="muted small"> {codes[k]}</code>}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                {table[codes[0]] ? grammarText(table[codes[0]], level) : codes[0]}
                {level === 'advanced' && <code className="muted small"> {codes[0]}</code>}
              </>
            )}
          </dd>
          {level === 'advanced' && (
            <>
              <dt>Word</dt>
              <dd>
                {position} in the verse (Hebrew order) · tags {tags}
              </dd>
            </>
          )}
        </dl>
        {q && <div className="notice small">This is the Qere: the reading noted in the margin of the Leningrad Codex to be read aloud in place of the written text.</div>}
      </div>
    )
  }
  const [text, xlit, gloss, strong, code, lemma, lemmaGloss, ed] = w
  const codes = code.split(' + ')
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="orig greek" lang="grc" style={{ fontSize: '1.5em' }}>
        {text}
      </div>
      <dl className="kv">
        <dt>Transliteration</dt>
        <dd>{xlit}</dd>
        <dt>Dictionary form</dt>
        <dd>
          <span lang="grc" className="greek">{lemma}</span> {lemmaGloss && <span className="muted">· {lemmaGloss}</span>}
        </dd>
        <dt>In this verse</dt>
        <dd>“{gloss}”</dd>
        <dt>Grammar</dt>
        <dd>
          {codes.map((c, k) =>
            /^G\d/.test(c) ? (
              <span key={k}> + merged with {c.replace(/^G0*/, 'G')}</span>
            ) : (
              <span key={k}>
                {table[c] ? grammarText(table[c], level) : c}
                {level === 'advanced' && <code className="muted small"> {c}</code>}
              </span>
            ),
          )}
        </dd>
        {level === 'advanced' && (
          <>
            <dt>Word</dt>
            <dd>
              {position} in the verse (Greek order) · {strong}
            </dd>
          </>
        )}
      </dl>
      {ed && <div className="notice small" data-testid="edition-note">{EDITION[ed]}</div>}
    </div>
  )
}

/** BDB entries for a Hebrew Strong's number, with completeness labels, root, and word family. */
export function BdbSection({ id }: { id: string }) {
  const { settings } = useStudy()
  const [open, setOpen] = useState(settings.studyLevel === 'advanced')
  const { data, loading } = useAsync(() => (open ? loadBdb(id) : Promise.resolve(null)), [id, open])
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="bdb">
      <summary>
        <strong>Brown-Driver-Briggs lexicon</strong> <span className="badge source">BDB 1906 · Open Scriptures</span>
      </summary>
      {loading && <Loading />}
      {data && !data.length && <p className="small muted">No BDB entry is linked to {id} in the Open Scriptures index.</p>}
      {data && data.length > 1 && (
        <div className="notice small">
          Strong's {id} covers {data.length} words that BDB treats separately (they are spelled alike). The context of the verse decides which one is
          meant; the sense label above comes from STEPBible's tagging of this verse.
        </div>
      )}
      {data?.map((e) => (
        <div key={e.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          {e.status !== 'done' && (
            <div className="small muted">
              BDB {e.status === 'base' ? 'basic definitions' : e.status === 'ref' ? 'definitions with some references' : 'entry'}; the full entry is not
              yet transcribed (Open Scriptures).
            </div>
          )}
          <BdbHtml html={e.h} />
          {e.root && (
            <div className="small">
              <strong>Root:</strong> <span lang="he" dir="rtl" className="hebrew">{e.root.w}</span> {e.root.def && <span className="muted">({e.root.def})</span>}
            </div>
          )}
          {e.family.length > 0 && (
            <div className="small">
              <strong>Related words in BDB:</strong>{' '}
              {e.family.map((f, i) => (
                <span key={f.id}>
                  {i > 0 && ', '}
                  <span lang="he" dir="rtl" className="hebrew">{f.w}</span>
                  {f.def && <span className="muted"> {f.def}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </details>
  )
}

function BdbHtml({ html }: { html: string }) {
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
      className="bdb-text small"
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

/** Every form the word takes in the tagged text, with counts. */
export function FormsSection({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const { data } = useAsync(() => (open ? loadForms(id) : Promise.resolve(null)), [id, open])
  const isHeb = id.startsWith('H')
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid="forms">
      <summary>
        <strong>Forms this word takes in Scripture</strong> <span className="badge source">STEPBible</span>
      </summary>
      {data && !data.length && <p className="small muted">No forms recorded.</p>}
      {data && (
        <ul className="forms-list">
          {data.slice(0, 40).map(([f, n]) => (
            <li key={f}>
              <span lang={isHeb ? 'he' : 'grc'} dir={isHeb ? 'rtl' : undefined} className={isHeb ? 'hebrew' : 'greek'}>
                {f}
              </span>{' '}
              <span className="muted small">×{n}</span>
            </li>
          ))}
        </ul>
      )}
      {data && data.length > 40 && <p className="small muted">and {data.length - 40} more</p>}
    </details>
  )
}

/** Every Hebrew/Greek word in a passage, in order; selecting one opens its full study. */
export function PassageWords({ book, chapter, from, to }: { book: string; chapter: number; from: number; to: number }) {
  const { select, settings } = useStudy()
  const { data, loading } = useAsync(() => loadOrigChapter(book, chapter), [book, chapter])
  if (loading) return <Loading label="Loading the original text" />
  if (!data) return null
  const heb = data.l === 'H'
  const verses = Object.keys(data.v).map(Number).filter((n) => n >= from && n <= to && n > 0)
  return (
    <section className="stack" data-testid="passage-words" aria-label="Words in this passage">
      <h3 style={{ margin: 0 }}>
        {heb ? 'Hebrew' : 'Greek'} words in this passage
      </h3>
      <p className="small muted" style={{ margin: 0 }}>
        From STEPBible's tagged {heb ? 'Hebrew' : 'Greek'} text{heb ? ', in Hebrew order (right to left)' : ''}. Select a word for its full study.
      </p>
      {verses.map((n) => (
        <div key={n}>
          <div className="small muted">Verse {n}</div>
          <div className={`il-words ${heb ? 'rtl' : ''}`} dir={heb ? 'rtl' : 'ltr'}>
            {data.v[String(n)].map((w, i) => {
              const id = baseStrong(heb ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3])
              return (
                <button
                  key={i}
                  type="button"
                  className="il-word"
                  onClick={() => id && select({ book, chapter, verse: n, word: -2, english: w[2], segIndex: -1, orig: { index: i, strongs: id } })}
                  aria-label={`${w[0].replace(/\//g, '')}, "${w[2].replace(/\//g, '')}"`}
                >
                  <span className={`il-orig ${heb ? 'hebrew' : 'greek'}`} lang={heb ? 'he' : 'grc'}>{w[0].replace(/\//g, '')}</span>
                  {settings.studyLevel === 'advanced' && <span className="il-xlit" dir="ltr">{heb ? plainXlit(w[1]) : w[1]}</span>}
                  <span className="il-gloss" dir="ltr">{w[2].replace(/\//g, ' ').replace(/\s+/g, ' ')}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
