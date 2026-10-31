import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { loadChapter, loadCommentaryChapter, loadCommentaryCoverage, loadCommentaryIndex, loadCommentaryIntro, loadIsbe, verseText, type CommentaryWork } from '../lib/data'
import { BOOK_BY_ID, formatRef } from '../lib/refs'
import { useStudy } from '../lib/state'
import { SourceHtml } from './Scripture'
import { Empty, Loading, useAsync } from './ui'

/**
 * Which ISBE (1915) article is about each book. Reviewed by hand: same-named articles about a person (Ezra, Esther,
 * Job, Jeremiah) or a doctrine ("Revelation") are excluded. Books with no book article in this ISBE edition are left out.
 */
export const ISBE_BOOK_ARTICLE: Record<string, string> = {
  Gen: 'Genesis', Exod: 'Exodus, the Book of', Lev: 'Leviticus', Num: 'Numbers, Book of', Deut: 'Deuteronomy', Ruth: 'Ruth, the Book of',
  '1Sam': 'Samuel, Books of', '2Sam': 'Samuel, Books of', '1Kgs': 'Kings, Books of', '2Kgs': 'Kings, Books of', Ezra: 'Ezra-Nehemiah', Neh: 'Ezra-Nehemiah',
  Eccl: 'Ecclesiastes, or the Preacher', Song: 'Song of Songs', Isa: 'Isaiah', Lam: 'Lamentations, Book of', Ezek: 'Ezekiel', Dan: 'Daniel, Book of',
  Amos: 'Amos (1)', Obad: 'Obadiah, Book of', Nah: 'Nahum, the Book of', Hab: 'Habakkuk', Zeph: 'Zephaniah, Book of', Hag: 'Haggai',
  Zech: 'Zechariah, Book of', Mal: 'Malachi', Matt: 'Matthew, the Gospel of', Mark: 'Mark, the Gospel According to', Luke: 'Luke, the Gospel of',
  Acts: 'Acts of the Apostles', Rom: 'Romans, Epistle to the', Gal: 'Galatians, Epistle to the', Phil: 'Philippians, the Epistle to',
  '1Thess': 'Thessalonians, the First Epistle of Paul to the', '2Thess': 'Thessalonians, the Second Epistle of Paul to the',
  '1Tim': 'Pastoral Epistles, the', '2Tim': 'Pastoral Epistles, the', Titus: 'Pastoral Epistles, the', Phlm: 'Philemon, Epistle to',
  Heb: 'Hebrews, Epistle to the', Jas: 'James, Epistle of', '1Pet': 'Peter, the First Epistle of', '2Pet': 'Peter, the Second Epistle of',
  Rev: 'Revelation of John:',
}

function Lazy({ title, badge, load, testid }: { title: string; badge: string; load: () => Promise<string | undefined>; testid?: string }) {
  const [open, setOpen] = useState(false)
  const { data, loading, error } = useAsync(() => (open ? load() : Promise.resolve(undefined)), [open])
  return (
    <details className="commentary-block" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} data-testid={testid}>
      <summary>
        <strong>{title}</strong> <span className="badge source">{badge}</span>
      </summary>
      {loading && <Loading />}
      {error && <p className="small muted">This could not be loaded.</p>}
      {data && <SourceHtml className="commentary-text" html={data} />}
    </details>
  )
}

export function ContextPanel() {
  const { focusVerse, selection, readerLoc } = useStudy()
  const v = focusVerse ?? (selection ? { book: selection.book, chapter: selection.chapter, verse: selection.verse } : null)
  const book = v?.book ?? readerLoc?.book
  const chapter = v?.chapter ?? readerLoc?.chapter
  const verse = v && v.book === book && v.chapter === chapter ? v.verse : undefined
  const { data: index } = useAsync(loadCommentaryIndex, [])
  const { data: cover } = useAsync(
    async () => (book && index ? Promise.all(index.works.map(async (w) => [w, await loadCommentaryCoverage(w.id, book).catch(() => null)] as const)) : []),
    [book, index?.works.length],
  )
  const { data: ch } = useAsync(() => (book && chapter && verse ? loadChapter(book, chapter) : Promise.resolve(null)), [book, chapter, verse])
  if (!book || !chapter) return <Empty>Open a chapter in the reader to see its background.</Empty>
  const name = BOOK_BY_ID[book]?.name ?? book
  const article = ISBE_BOOK_ARTICLE[book]
  const withIntro = (cover ?? []).filter(([, c]) => c?.intro).map(([w]) => w as CommentaryWork)
  const withOverview = (cover ?? []).filter(([, c]) => c?.chapters[String(chapter)]?.overview).map(([w]) => w as CommentaryWork)
  const around = ch && verse ? ch.verses.filter((x) => x.v >= verse - 3 && x.v <= verse + 3) : []

  return (
    <div className="stack" data-testid="context-panel">
      <h3 style={{ margin: 0 }}>
        <Landmark size={16} aria-hidden /> Background for {verse ? formatRef({ book, chapter, verse }) : `${name} ${chapter}`}
      </h3>
      <div className="notice small">
        Background from published sources, each labeled with its author and date. Authorship, dates, and setting are given as each source states
        them. These are older works: traditional views and the scholarship of their day are presented as such, and some conclusions are debated
        today. Nothing here is generated.
      </div>

      {around.length > 0 && (
        <section className="commentary-block" aria-label="Surrounding verses">
          <strong>Surrounding verses</strong> <span className="badge">literary context</span>
          <div style={{ fontFamily: 'var(--scripture-font)', marginTop: 6 }}>
            {around.map((x) => (
              <p key={x.v} style={{ margin: '4px 0', fontWeight: x.v === verse ? 600 : undefined }}>
                <sup>{x.v}</sup> {verseText(x)}
              </p>
            ))}
          </div>
        </section>
      )}

      <h4 style={{ margin: '4px 0 0' }}>The book of {name}</h4>
      {article ? (
        <Lazy title={`Encyclopedia article: ${article.replace(/:$/, '')}`} badge="ISBE 1915" load={() => loadIsbe(article)} testid="context-isbe" />
      ) : (
        <p className="small muted" style={{ margin: 0 }} data-testid="context-no-isbe">
          The ISBE edition in this app has no article on the book of {name}.
        </p>
      )}
      {withIntro.map((w) => (
        <Lazy key={w.id} title={`Introduction to ${name}: ${w.short}`} badge={w.era} load={() => loadCommentaryIntro(w.id, book).then((x) => x.h)} />
      ))}

      <h4 style={{ margin: '4px 0 0' }}>
        {name} {chapter}
      </h4>
      {withOverview.length === 0 && cover && <p className="small muted" style={{ margin: 0 }}>No commentary gives a chapter overview for {name} {chapter}.</p>}
      {withOverview.map((w) => (
        <Lazy key={w.id} title={`Chapter overview: ${w.short}`} badge={w.era} load={() => loadCommentaryChapter(w.id, book, chapter).then((x) => x.c.join(''))} />
      ))}
      <p className="small muted" style={{ margin: 0 }}>
        For people and places, look up names in the Dictionary tab (ISBE and Hitchcock's Bible Names).
      </p>
    </div>
  )
}
