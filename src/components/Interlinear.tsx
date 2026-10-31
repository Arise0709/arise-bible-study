import { Fragment, type ReactNode } from 'react'
import { baseStrong, loadOrigChapter, parseWord, plainXlit, segText, type Chapter, type OrigWord } from '../lib/data'
import { useStudy } from '../lib/state'
import { Loading, useAsync } from './ui'

/**
 * Interlinear view: the Hebrew or Greek words of each verse in their own order, each with transliteration, English
 * gloss, Strong's number, and (optionally) grammar, from STEPBible's word-by-word tagging (TAHOT/TAGNT). Under each
 * verse, the KJV words tagged with the same Strong's numbers show how the translation renders them.
 * Nothing here is inferred from the English: if a verse has no tagged original text, the view says so.
 */
export function InterlinearChapter({
  book,
  chapter,
  kjv,
  showGrammar,
  renderVerseHead,
  translationLine,
}: {
  book: string
  chapter: number
  kjv: Chapter
  showGrammar: boolean
  renderVerseHead: (v: number) => ReactNode
  translationLine: (v: number) => ReactNode
}) {
  const { select, selection, setTool, setToolsOpen } = useStudy()
  const { data, error, loading } = useAsync(() => loadOrigChapter(book, chapter), [book, chapter])
  if (loading) return <Loading label="Loading the original text" />
  if (error || !data) return <div className="notice warn">The tagged original-language text for this chapter could not be loaded.</div>
  const heb = data.l === 'H'
  const verses = [...(kjv.title && data.v['0'] ? [0] : []), ...kjv.verses.map((v) => v.v)]

  const open = (v: number, i: number, w: OrigWord) => {
    const id = baseStrong(heb ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3])
    if (!id) return
    select({ book, chapter, verse: v, word: -2, english: w[2], segIndex: -1, orig: { index: i, strongs: id } })
    setTool('word')
    setToolsOpen(true)
  }

  return (
    <div className="interlinear" data-testid="interlinear">
      <p className="notice small" style={{ fontFamily: 'var(--ui-font)' }}>
        Interlinear: the {heb ? 'Hebrew (Leningrad Codex)' : 'Greek'} words of each verse in their own order{heb ? ', read right to left' : ''}, with
        STEPBible's word-by-word English. Under each verse, the KJV. Select a word for its full study.
      </p>
      {verses.map((v) => {
        const ws = data.v[String(v)]
        return (
          <section key={v} className="il-verse" aria-label={v === 0 ? 'Psalm title' : `Verse ${v}`}>
            <div className="il-head">{v === 0 ? <span className="badge">title</span> : renderVerseHead(v)}</div>
            {ws?.length ? (
              <div className={`il-words ${heb ? 'rtl' : ''}`} dir={heb ? 'rtl' : 'ltr'}>
                {ws.map((w, i) => {
                  const sid = baseStrong(heb ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3])
                  const isSel = selection?.orig && selection.verse === v && selection.chapter === chapter && selection.book === book && selection.orig.index === i
                  const flag = heb ? (w[6] === 'Q' ? 'Qere' : '') : w[7] === 'T' ? 'TR only' : w[7] === 'N' ? 'not in TR' : w[7] === 'O' ? 'other eds.' : ''
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`il-word ${isSel ? 'sel' : ''} ${flag ? 'flagged' : ''}`}
                      data-rove="w"
                      tabIndex={-1}
                      onClick={() => open(v, i, w)}
                      aria-label={`${w[0].replace(/\//g, '')}, ${heb ? plainXlit(w[1]) : w[1]}, "${w[2].replace(/\//g, '')}"${sid ? `, Strong's ${sid}` : ''}${flag ? `, ${flag}` : ''}`}
                    >
                      <span className={`il-orig ${heb ? 'hebrew' : 'greek'}`} lang={heb ? 'he' : 'grc'} dir={heb ? 'rtl' : 'ltr'}>
                        {w[0].replace(/\//g, '')}
                      </span>
                      <span className="il-xlit" dir="ltr">{heb ? plainXlit(w[1]) : w[1]}</span>
                      <span className="il-gloss" dir="ltr">{w[2].replace(/\//g, ' ').replace(/\s+/g, ' ')}</span>
                      {showGrammar && (
                        <>
                          <span className="il-meta" dir="ltr">{sid}</span>
                          <span className="il-meta" dir="ltr">{w[4]}</span>
                        </>
                      )}
                      {flag && <span className="il-flag" dir="ltr">{flag}</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="small muted">No tagged {heb ? 'Hebrew' : 'Greek'} text is available for this verse.</div>
            )}
            {v > 0 && <div className="il-translation">{translationLine(v)}</div>}
            {v > 0 && ws && <KjvCorrespondence verse={kjv.verses.find((x) => x.v === v)} ids={ws.map((w) => baseStrong(heb ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3]))} />}
          </section>
        )
      })}
    </div>
  )
}

/** For each original word, the KJV words the KJV's own tagging links to the same Strong's number (when any). */
function KjvCorrespondence({ verse, ids }: { verse?: Chapter['verses'][number]; ids: (string | null)[] }) {
  const { settings } = useStudy()
  if (!verse?.w || settings.studyLevel !== 'advanced') return null
  const byId = new Map<string, string[]>()
  verse.w.forEach((tag, wi) => {
    for (const s of parseWord(tag).strongs) {
      const text = verse.s.filter((seg) => seg[2] === wi).map(segText).join('').trim()
      if (text) byId.set(s, [...(byId.get(s) ?? []), text])
    }
  })
  const pairs = [...new Set(ids.filter((x): x is string => !!x))].filter((id) => byId.has(id))
  if (!pairs.length) return null
  return (
    <details className="small il-kjv">
      <summary>KJV words tagged with the same Strong's numbers</summary>
      <ul>
        {pairs.map((id) => (
          <Fragment key={id}>
            <li>
              <code>{id}</code> → {byId.get(id)!.join(' · ')}
            </li>
          </Fragment>
        ))}
      </ul>
    </details>
  )
}
