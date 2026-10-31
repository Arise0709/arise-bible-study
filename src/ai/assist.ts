/**
 * Client side of the optional AI assistant: builds the study materials, calls /api/assist,
 * and verifies the answer against the app's own data before it is shown.
 */
import {
  baseStrong,
  getPassage,
  loadCommentaryChapter,
  loadCommentaryCoverage,
  loadCommentaryIndex,
  loadMorphTable,
  loadOrigChapter,
  loadStrongs,
  passageToText,
} from '../lib/data'
import { grammarText } from '../lib/grammar'
import { findRefs, formatRef, parseOsis, toOsis } from '../lib/refs'
import { WORKSHEET_SECTIONS, type AiSource, type Block, type Study } from '../db/db'

export type AiTask = 'organize' | 'questions' | 'summarize' | 'outline' | 'explain' | 'commentaries' | 'words' | 'ask'

export const AI_TASKS: { id: AiTask; label: string; hint: string }[] = [
  { id: 'organize', label: 'Organize observations', hint: 'Groups what you noticed in the passage.' },
  { id: 'questions', label: 'Suggest study questions', hint: 'Questions that send you back into the text.' },
  { id: 'summarize', label: 'Summarize my notes', hint: 'A faithful summary of what you wrote.' },
  { id: 'outline', label: 'Draft an outline', hint: 'A teaching outline built from your study.' },
  { id: 'explain', label: 'Explain this passage', hint: 'Context, key words, and the commentaries, with sources.' },
  { id: 'commentaries', label: 'Compare the commentaries', hint: 'Where your chosen commentaries agree and differ.' },
  { id: 'words', label: 'Explain the original words', hint: 'Lexicon range and grammar, without root fallacies.' },
]

interface AiResult {
  sections: { heading: string; body: string; sources?: string[] }[]
  citations: string[]
  strongs: string[]
  quotes: { ref: string; text: string }[]
  uncertainties: string[]
}

function blockText(b: Block): string {
  switch (b.kind) {
    case 'scripture':
      return `[Scripture ${b.ref}] ${b.text}`
    case 'source':
      return `[Source: ${b.citation}] ${b.text}`
    case 'word':
      return `[Word study ${b.strongs} "${b.english}" in ${b.ref}: ${b.original}; ${b.gloss}] Reader's conclusion: ${b.note}`
    case 'xref':
      return `[Cross-reference ${b.from} -> ${b.to}] Reader's explanation: ${b.explanation}`
    case 'note':
      return `[Reader's note${b.uncertain ? ', marked uncertain' : ''}] ${b.text}`
    case 'ai':
      return ''
  }
}

const plainText = (h: string) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Sourced resources for the passage, each with an id the assistant must cite: commentary notes that cover the
 * passage (from the chosen commentaries) and the passage's Hebrew/Greek words with grammar and Strong's entries.
 */
async function sourcedMaterials(study: Study, commentaryIds: string[]): Promise<{ lines: string[]; sources: Map<string, AiSource>; strongs: Set<string> }> {
  const lines: string[] = []
  const sources = new Map<string, AiSource>()
  const strongs = new Set<string>()
  const p = parseOsis(study.passage)
  if (!p || p.verse === undefined) return { lines, sources, strongs }
  const from = p.verse
  const to = (p.endChapter ?? p.chapter) === p.chapter ? (p.endVerse ?? p.verse) : from + 5
  // original-language words
  const orig = await loadOrigChapter(p.book, p.chapter).catch(() => null)
  if (orig) {
    const table = await loadMorphTable(orig.l).catch(() => ({}) as Record<string, string>)
    const heb = orig.l === 'H'
    lines.push('', `ORIGINAL-LANGUAGE WORDS (STEPBible ${heb ? 'TAHOT, Hebrew' : 'TAGNT, Greek'}):`)
    let count = 0
    for (let v = from; v <= Math.min(to, from + 5); v++) {
      for (const [i, w] of (orig.v[String(v)] ?? []).entries()) {
        const id = baseStrong(heb ? (/\{([^}]+)\}/.exec(w[3])?.[1] ?? w[3]) : w[3])
        if (!id || count >= 40) continue
        const gram = (heb ? w[4].split('/') : w[4].split(' + ').filter((c) => !/^G\d/.test(c))).map((c) => (table[c] ? grammarText(table[c], 'beginner') : c)).join(' + ')
        const e = await loadStrongs(id).catch(() => undefined)
        const sid = `LEX:${id}`
        if (!sources.has(sid)) {
          sources.set(sid, { id: sid, label: `${e?.lemma ?? w[0]} (${id})`, kind: 'lex', book: p.book, chapter: p.chapter, verse: v, index: i, strongs: id })
          strongs.add(id)
        }
        lines.push(`[SRC:${sid}] ${p.book}.${p.chapter}.${v} word ${i + 1}: ${w[0].replace(/\//g, '')} "${w[2].replace(/\//g, ' ')}"; grammar: ${gram}${e ? `; Strong's ${id} ${e.lemma}: ${e.def}` : ''}${e?.senses ? `; Abbott-Smith: ${plainText(e.senses).slice(0, 400)}` : ''}`)
        count++
      }
    }
  }
  // commentary notes covering the passage
  const index = await loadCommentaryIndex().catch(() => null)
  for (const wid of commentaryIds) {
    const work = index?.works.find((w) => w.id === wid)
    if (!work) continue
    const cov = await loadCommentaryCoverage(wid, p.book).catch(() => null)
    if (!cov?.chapters[String(p.chapter)]) continue
    const ch = await loadCommentaryChapter(wid, p.book, p.chapter).catch(() => null)
    for (const [s, e, h] of ch?.e ?? []) {
      if (e < from || s > to) continue
      const sid = `COMM:${wid}:${p.book}.${p.chapter}.${s}-${e}`
      const ref = formatRef({ book: p.book, chapter: p.chapter, verse: s, endVerse: e !== s ? e : undefined })
      sources.set(sid, { id: sid, label: `${work.short} on ${ref}`, kind: 'comm', work: wid, book: p.book, chapter: p.chapter, verse: s })
      lines.push('', `[SRC:${sid}] COMMENTARY: ${work.short}, ${work.title} (${work.era}; ${work.tradition}), on ${ref}:`, plainText(h).slice(0, 5000))
    }
  }
  return { lines, sources, strongs }
}

export async function buildMaterials(
  study: Study,
  commentaryIds: string[] = [],
): Promise<{ text: string; verses: Map<string, string>; strongs: Set<string>; tr: string; sources: Map<string, AiSource> }> {
  const verses = new Map<string, string>()
  const strongs = new Set<string>()
  const lines: string[] = []
  const tr = study.translation ?? 'KJV'
  const passage = parseOsis(study.passage)
  if (passage) {
    const vs = await getPassage(passage, tr)
    lines.push(`PASSAGE ${formatRef(passage)} (${tr}):`)
    for (const v of vs) {
      verses.set(`${v.book}.${v.chapter}.${v.verse}`, v.text)
      lines.push(`${v.book}.${v.chapter}.${v.verse} ${v.text}`)
    }
  }
  // other Scripture the reader brought in
  const extraRefs = new Set<string>()
  for (const s of WORKSHEET_SECTIONS) {
    for (const b of study.sections[s.key]) {
      if (b.kind === 'scripture') extraRefs.add(b.ref)
      if (b.kind === 'xref') extraRefs.add(b.to)
      if (b.kind === 'word') strongs.add(b.strongs)
      if (b.kind === 'note') findRefs(b.text).forEach((f) => extraRefs.add(toOsis(f.ref)))
    }
  }
  for (const r of extraRefs) {
    const ref = parseOsis(r)
    if (!ref) continue
    const vs = await getPassage(ref, tr).catch(() => [])
    if (vs.length > 40) continue
    for (const v of vs) {
      const k = `${v.book}.${v.chapter}.${v.verse}`
      if (!verses.has(k)) {
        verses.set(k, v.text)
        lines.push(`${k} ${v.text}`)
      }
    }
  }
  if (strongs.size) {
    lines.push('', "STRONG'S ENTRIES:")
    for (const id of strongs) {
      const e = await loadStrongs(id)
      if (e) lines.push(`${e.id} ${e.lemma} (${e.xlit}), ${e.pos}: ${e.def}. KJV renders: ${e.kjv}`)
    }
  }
  const sourced = await sourcedMaterials(study, commentaryIds)
  lines.push(...sourced.lines)
  sourced.strongs.forEach((s) => strongs.add(s))
  lines.push('', "READER'S STUDY:")
  for (const s of WORKSHEET_SECTIONS) {
    const parts = study.sections[s.key].map(blockText).filter(Boolean)
    if (parts.length) lines.push(`## ${s.title}`, ...parts)
  }
  return { text: lines.join('\n').slice(0, 115_000), verses, strongs, tr, sources: sourced.sources }
}

/* The AI access code lives only in this browser (not in backups) and is sent with each request. */
const CODE_KEY = 'abs-ai-code'
export function getAiCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}
export function setAiCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code)
    else localStorage.removeItem(CODE_KEY)
  } catch {
    /* ignore */
  }
}

export interface AiStatus {
  reachable: boolean
  keyConfigured: boolean
  codeConfigured: boolean
  codeValid?: boolean
}

/** Asks the server whether the AI is set up, and (when a code is saved here) whether the code is right. */
export async function aiStatus(checkCode = false): Promise<AiStatus> {
  try {
    const code = getAiCode()
    const r = await fetch('/api/assist', { headers: checkCode && code ? { 'x-ai-access-code': code } : {} })
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { reachable: false, keyConfigured: false, codeConfigured: false }
    const j = await r.json()
    return { reachable: true, keyConfigured: !!(j.keyConfigured ?? j.configured), codeConfigured: !!j.codeConfigured, codeValid: j.codeValid }
  } catch {
    return { reachable: false, keyConfigured: false, codeConfigured: false }
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Commentators by the names a draft might use for them. */
const COMMENTATORS: { name: string; works: string[]; re: RegExp }[] = [
  { name: 'Matthew Henry', works: ['MHCC', 'MHC'], re: /Matthew Henry|\bHenry\b/ },
  { name: 'Jamieson, Fausset & Brown', works: ['JFB'], re: /Jamieson|Fausset|\bJFB\b/ },
  { name: 'Adam Clarke', works: ['Clarke'], re: /\bClarke\b/ },
  { name: 'Keil & Delitzsch', works: ['KD'], re: /\bKeil\b|Delitzsch/ },
  { name: 'Scofield', works: ['Scofield'], re: /Scofield/ },
]

export async function runAssistant(task: AiTask, study: Study, opts: { question?: string; commentaries?: string[] } = {}): Promise<Extract<Block, { kind: 'ai' }>> {
  const m = await buildMaterials(study, opts.commentaries ?? [])
  let res: Response
  try {
    res = await fetch('/api/assist', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-access-code': getAiCode() },
      body: JSON.stringify({ task, materials: m.text, ...(task === 'ask' ? { question: opts.question ?? '' } : {}) }),
    })
  } catch {
    throw new Error('Could not reach the assistant. Check your connection.')
  }
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error ?? `The assistant is unavailable (${res.status}).`)
  const r = j.result as AiResult
  const warnings: string[] = []

  // 1. Every quotation must match the study translation exactly (ignoring punctuation and case).
  const quoteLines: string[] = []
  for (const q of r.quotes ?? []) {
    const ref = parseOsis(q.ref)
    if (!ref) {
      warnings.push(`Removed a quotation with an unreadable reference (“${q.ref}”).`)
      continue
    }
    const vs = await getPassage(ref, m.tr).catch(() => [])
    const exact = norm(passageToText(vs).replace(/\b\d+\s/g, ' '))
    if (!vs.length || !exact.includes(norm(q.text.replace(/\.\.\.|…/g, ' ')))) {
      warnings.push(`Removed a quotation attributed to ${formatRef(ref)} because it does not match the ${m.tr} text.`)
      continue
    }
    quoteLines.push(`“${q.text}” (${formatRef(ref)}, ${m.tr})`)
  }

  // 2. Strong's numbers must exist and come from the study.
  for (const id of r.strongs ?? []) {
    const e = await loadStrongs(id).catch(() => undefined)
    if (!e) warnings.push(`The draft mentioned ${id}, which is not a Strong's entry. Ignore that reference.`)
    else if (!m.strongs.has(id)) warnings.push(`The draft mentioned ${id}, which is not in your word study. Check it yourself before using it.`)
  }
  // 2b. Sources: only ids the app actually provided; a section that names a commentator must cite that commentator's excerpt.
  const used = new Map<string, AiSource>()
  const sectionText = r.sections.map((s) => {
    const ok: AiSource[] = []
    for (const id of s.sources ?? []) {
      const src = m.sources.get(id.replace(/^SRC:/, ''))
      if (src) {
        ok.push(src)
        used.set(src.id, src)
      } else warnings.push(`Removed a source the draft listed that was not in your study materials (“${id}”).`)
    }
    for (const c of COMMENTATORS) {
      if (c.re.test(`${s.heading} ${s.body}`) && !ok.some((x) => x.work && c.works.includes(x.work)))
        warnings.push(`“${s.heading}” mentions ${c.name} without citing that commentary's excerpt. Check it against the commentary before relying on it.`)
    }
    return `${s.heading}\n${s.body}${ok.length ? `\nSources: ${ok.map((x) => x.label).join('; ')}` : ''}`
  })
  const body = sectionText.join('\n\n')
  for (const mm of body.matchAll(/\b[HG]\d{1,4}\b/g)) {
    if (!(r.strongs ?? []).includes(mm[0]) && !m.strongs.has(mm[0])) warnings.push(`The draft mentions ${mm[0]} without listing it. Verify before use.`)
  }

  // 3. Citations must be real references; flag ones outside the study materials.
  const citations: string[] = []
  for (const c of r.citations ?? []) {
    const ref = parseOsis(c)
    if (!ref) {
      warnings.push(`Ignored an unreadable citation (“${c}”).`)
      continue
    }
    const vs = await getPassage(ref).catch(() => [])
    if (!vs.length) {
      warnings.push(`Removed citation ${c}: that passage does not exist.`)
      continue
    }
    if (!vs.some((v) => m.verses.has(`${v.book}.${v.chapter}.${v.verse}`))) warnings.push(`${formatRef(ref)} is not in your study materials. Read it in context before relying on it.`)
    citations.push(toOsis(ref))
  }

  let text = body
  if (quoteLines.length) text += `\n\nScripture quoted:\n${quoteLines.join('\n')}`
  if (r.uncertainties?.length) text += `\n\nOpen questions and uncertainty:\n${r.uncertainties.map((u) => `- ${u}`).join('\n')}`
  return { id: crypto.randomUUID(), kind: 'ai', text, citations, warnings: [...new Set(warnings)], createdAt: Date.now(), sources: [...used.values()] }
}
