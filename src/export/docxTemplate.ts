/**
 * Word export that fills the church's notes template (public/templates/notes-template.docx).
 *
 * The template keeps its own styles, theme, numbering, header, footer and page setup. This module only
 * writes body paragraphs using the same formatting the template uses for each kind of content:
 *   series line, title, secondary title, reference line, gold divider, meta lines, section headings (Heading1),
 *   gold subheadings, Scripture boxes, body paragraphs, bullet lists, KEY TRUTH bars, HARD TRUTH lines,
 *   bracketed notes such as [PREACHER NOTE], and prayer boxes.
 *
 * In your own notes you can trigger the special formats by starting a line with:
 *   "KEY TRUTH:"  "HARD TRUTH:"  "PRAYER:"  "[PREACHER NOTE]" (or any "[LABEL]")  "- " for a bullet
 */
import type { DocNode } from './doc'

export const TEMPLATE_URL = '/templates/notes-template.docx'

const GOLD = 'B8972A'
const FONT = '<w:rFonts w:ascii="SF Pro" w:hAnsi="SF Pro"/>'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

interface RunOpts {
  b?: boolean
  i?: boolean
  color?: string
  sz?: number // half-points
  spacing?: number
}

function run(text: string, o: RunOpts = {}): string {
  if (!text) return ''
  const rpr =
    FONT +
    (o.b ? '<w:b/><w:bCs/>' : '') +
    (o.i ? '<w:i/><w:iCs/>' : '') +
    (o.color ? `<w:color w:val="${o.color}"/>` : '') +
    (o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : '') +
    (o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : '')
  return `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
}

const para = (ppr: string, runs: string) => `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`

const P = {
  series: (t: string) => para('<w:spacing w:before="480" w:after="80"/><w:jc w:val="center"/>', run(t.toUpperCase(), { color: '888888', spacing: 120, sz: 20 })),
  title: (t: string) => para('<w:spacing w:after="80"/><w:jc w:val="center"/>', run(t.toUpperCase(), { b: true, color: '111111', sz: 48 })),
  subtitle: (t: string) => para('<w:spacing w:after="60"/><w:jc w:val="center"/>', run(t, { i: true, color: GOLD, sz: 28 })),
  refs: (t: string) => para('<w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/>', run(t, { color: '555555', sz: 22 })),
  divider: () => para(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${GOLD}"/></w:pBdr><w:spacing w:before="200" w:after="200"/>`, ''),
  body: (runs: string) => para('<w:spacing w:before="80" w:after="80" w:line="360" w:lineRule="auto"/>', runs),
  heading: (t: string) => para('<w:pStyle w:val="Heading1"/><w:spacing w:after="160"/>', `<w:r><w:rPr>${FONT}</w:rPr><w:t xml:space="preserve">${esc(t.toUpperCase())}</w:t></w:r>`),
  sub: (t: string) => para('<w:spacing w:before="200" w:after="80"/>', run(t, { b: true, color: GOLD, sz: 22 })),
  scripture: (text: string, cite: string) =>
    para(
      `<w:pBdr><w:left w:val="single" w:sz="14" w:space="8" w:color="${GOLD}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F7F6F2"/><w:spacing w:before="180" w:after="180"/><w:ind w:left="720" w:right="360"/>`,
      run(`"${text}"`, { i: true, color: '1C1C1C', sz: 23 }) + run(`  — ${cite}`, { b: true, color: GOLD, sz: 20 }),
    ),
  keyTruth: (t: string) =>
    para('<w:shd w:val="clear" w:color="auto" w:fill="111111"/><w:spacing w:before="200" w:after="200"/><w:jc w:val="center"/>', run(`  KEY TRUTH: ${t}`, { b: true, color: 'FFFFFF', sz: 22 })),
  hardTruth: (t: string) => para('<w:spacing w:before="160" w:after="160"/>', run('HARD TRUTH: ', { b: true, color: GOLD }) + run(t, { i: true, color: '000000' })),
  note: (label: string, t: string) =>
    para('<w:spacing w:before="100" w:after="100"/><w:ind w:left="360"/>', run(`[${label.toUpperCase()}]  `, { b: true, color: GOLD, sz: 20 }) + run(t, { i: true, color: '000000', sz: 20 })),
  prayer: (t: string) => {
    const m = /^(.{3,60},\s)(.*)$/s.exec(t)
    const runs = m ? run(m[1], { b: true, color: '1C1C1C' }) + run(m[2], { color: '1C1C1C' }) : run(t, { color: '1C1C1C' })
    return para(
      `<w:pBdr><w:left w:val="single" w:sz="14" w:space="8" w:color="${GOLD}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F7F6F2"/><w:spacing w:before="180" w:after="180" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:right="360"/>`,
      runs,
    )
  },
  bullet: (t: string) => {
    // "The poor.  Good news ..." -> bold lead-in up to the first sentence break, as in the template
    const m = /^([^.!?:]{2,60}[.!?:])(\s+.*)$/s.exec(t)
    const runs = m ? run(m[1], { b: true, color: '000000' }) + run(m[2], { color: '000000' }) : run(t, { color: '000000' })
    return para('<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="80" w:after="80"/>', runs)
  },
}

/** Render one block of the reader's own text, honouring the template's special line formats. */
function textToParas(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    if ((m = /^KEY TRUTH:\s*(.*)$/i.exec(line))) out.push(P.keyTruth(m[1]))
    else if ((m = /^HARD TRUTH:\s*(.*)$/i.exec(line))) out.push(P.hardTruth(m[1]))
    else if ((m = /^PRAYER:\s*(.*)$/i.exec(line))) out.push(P.prayer(m[1]))
    else if ((m = /^\[([^\]]{2,40})\]\s*(.*)$/.exec(line))) out.push(P.note(m[1], m[2]))
    else if ((m = /^[-•*]\s+(.*)$/.exec(line))) out.push(P.bullet(m[1]))
    else out.push(P.body(run(line, { color: '000000' })))
  }
  return out
}

export interface TemplateInfo {
  kind: string // footer label, e.g. "Sermon Manuscript" or "Study Notes"
  series: string // small line above the title
  date?: Date
}

export function buildBody(doc: DocNode[], info: TemplateInfo): { body: string; title: string; passage: string } {
  const meta = new Map<string, string>()
  let title = 'Untitled'
  for (const n of doc) {
    if (n.t === 'title') title = n.text
    if (n.t === 'meta') meta.set(n.label, n.text)
  }
  const passage = meta.get('Primary passage') ?? ''
  const supporting = [...new Set(doc.filter((n): n is Extract<DocNode, { t: 'quote' }> => n.t === 'quote').map((n) => n.cite.replace(/\s*\(KJV\)$/, '')))].filter((c) => c !== passage)

  const out: string[] = [P.series(info.series), P.title(title)]
  if (meta.get('Main idea')) out.push(P.subtitle(meta.get('Main idea')!))
  if (passage || supporting.length) out.push(P.refs([passage, ...supporting.slice(0, 3)].filter(Boolean).join('  |  ')))
  out.push(P.divider())
  const textLine = [passage && `Text: ${passage} (KJV)`, supporting.length ? `Supporting: ${supporting.join(', ')}` : ''].filter(Boolean).join('  |  ')
  if (textLine) out.push(P.body(run(textLine, { color: '000000' })))
  const detailLine = [
    meta.get('Audience') && `Audience: ${meta.get('Audience')}`,
    meta.get('Estimated length') && `Estimated length: ${meta.get('Estimated length')}`,
    meta.get('Approach') && `Approach: ${meta.get('Approach')}`,
  ]
    .filter(Boolean)
    .join('  |  ')
  if (detailLine) out.push(P.body(run(detailLine, { color: '000000' })))
  if (meta.get('Teaching objective')) out.push(P.body(run(`Objective: ${meta.get('Teaching objective')}`, { color: '000000' })))
  out.push(P.divider())

  let firstHeading = true
  for (const n of doc) {
    switch (n.t) {
      case 'h1':
      case 'h2':
        if (!firstHeading) out.push(P.divider())
        firstHeading = false
        out.push(P.heading(n.text))
        break
      case 'h3':
        out.push(P.sub(n.text))
        break
      case 'p':
        out.push(...textToParas(n.text))
        break
      case 'quote':
        out.push(P.scripture(n.text, /\(KJV\)$/.test(n.cite) ? n.cite : `${n.cite} (KJV)`))
        break
      case 'note':
        out.push(P.note(n.label, n.text.replace(/\n+/g, ' ')))
        break
    }
  }
  out.push(P.divider())
  return { body: out.join(''), title, passage }
}

const pad = (n: number) => String(n).padStart(2, '0')

export async function toTemplateDocx(doc: DocNode[], info: TemplateInfo): Promise<Blob> {
  const res = await fetch(TEMPLATE_URL)
  if (!res.ok) throw new Error(`The Word template is missing (status ${res.status}).`)
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const { body, title, passage } = buildBody(doc, info)
  const d = info.date ?? new Date()
  const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`
  const fill = async (path: string, map: Record<string, string>) => {
    let xml = await zip.file(path)!.async('string')
    for (const [k, v] of Object.entries(map)) xml = xml.split(`{{${k}}}`).join(v)
    zip.file(path, xml)
  }
  await fill('word/document.xml', { BODY: body })
  await fill('word/header1.xml', { HEADER_TITLE: esc(title.toUpperCase()), HEADER_REF: esc(passage ? `${passage} | KJV` : 'KJV') })
  await fill('word/footer1.xml', { FOOTER: esc(`${info.kind}  |  ${date}`) })
  await fill('docProps/core.xml', { DOC_TITLE: esc(title) })
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
