/**
 * One document model feeds every export format (Markdown, Word, PDF, print), so headings,
 * Scripture quotations and notes come out the same everywhere.
 */
import { formatRef, parseOsis } from '../lib/refs'
import { WORKSHEET_SECTIONS, type Block, type Sermon, type Study } from '../db/db'

export type DocNode =
  | { t: 'title'; text: string }
  | { t: 'meta'; label: string; text: string }
  | { t: 'h1' | 'h2' | 'h3'; text: string }
  | { t: 'p'; text: string }
  | { t: 'quote'; text: string; cite: string }
  | { t: 'note'; label: string; text: string }

const refLabel = (osis: string) => {
  const r = parseOsis(osis)
  return r ? formatRef(r) : osis
}

export function blockToNodes(b: Block): DocNode[] {
  switch (b.kind) {
    case 'scripture':
      return [{ t: 'quote', text: b.text, cite: `${refLabel(b.ref)} (${b.tr ?? 'KJV'})` }]
    case 'source':
      return [{ t: 'note', label: `Source: ${b.citation}`, text: b.text }]
    case 'word':
      return [
        { t: 'note', label: `Word study: ${b.strongs}, “${b.english}” in ${refLabel(b.ref)}`, text: `${b.original}. ${b.gloss} (Strong's)` },
        ...(b.note ? [{ t: 'p' as const, text: b.note }] : []),
      ]
    case 'xref':
      return [{ t: 'note', label: `Cross-reference: ${b.from ? refLabel(b.from) + ' and ' : ''}${refLabel(b.to)}`, text: b.explanation || '(connection not yet explained)' }]
    case 'note':
      return b.text.trim() ? [{ t: 'p', text: b.uncertain ? `[Uncertain or debated] ${b.text}` : b.text }] : []
    case 'ai':
      return [{ t: 'note', label: 'AI-generated draft (verify before use)', text: b.text + (b.warnings.length ? `\nChecks: ${b.warnings.join(' ')}` : '') }]
  }
}

export function sermonToDoc(s: Sermon, passageText?: string, approach?: string): DocNode[] {
  const out: DocNode[] = [{ t: 'title', text: s.title || 'Untitled' }]
  if (s.passage) out.push({ t: 'meta', label: 'Primary passage', text: refLabel(s.passage) })
  out.push({ t: 'meta', label: 'Translation', text: s.translation ?? 'KJV' })
  if (s.subtitle) out.push({ t: 'meta', label: 'Secondary title', text: s.subtitle })
  if (s.series) out.push({ t: 'meta', label: 'Series', text: s.series })
  if (s.mainIdea) out.push({ t: 'meta', label: 'Main idea', text: s.mainIdea })
  if (s.objective) out.push({ t: 'meta', label: 'Teaching objective', text: s.objective })
  if (s.audience) out.push({ t: 'meta', label: 'Audience', text: s.audience })
  if (s.length) out.push({ t: 'meta', label: 'Estimated length', text: s.length })
  if (approach) out.push({ t: 'meta', label: 'Approach', text: approach })
  if (s.passage && passageText) out.push({ t: 'quote', text: passageText, cite: `${refLabel(s.passage)} (${s.translation ?? 'KJV'})` })
  for (const sec of s.sections) {
    out.push({ t: sec.level === 2 ? 'h3' : 'h2', text: sec.title || 'Untitled section' })
    for (const b of sec.blocks) out.push(...blockToNodes(b))
  }
  if (s.sources.trim()) {
    out.push({ t: 'h2', text: 'Sources and further study' })
    out.push({ t: 'p', text: s.sources })
  }
  return out
}

export function studyToDoc(s: Study, passageText?: string): DocNode[] {
  const out: DocNode[] = [{ t: 'title', text: s.title || 'Untitled study' }]
  if (s.passage) out.push({ t: 'meta', label: 'Primary passage', text: refLabel(s.passage) })
  out.push({ t: 'meta', label: 'Translation', text: s.translation ?? 'KJV' })
  out.push({ t: 'h2', text: 'Passage' })
  if (passageText) out.push({ t: 'quote', text: passageText, cite: `${refLabel(s.passage)} (${s.translation ?? 'KJV'})` })
  for (const sec of WORKSHEET_SECTIONS) {
    out.push({ t: 'h2', text: sec.title })
    const blocks = s.sections[sec.key]
    if (!blocks.length) out.push({ t: 'p', text: '(empty)' })
    for (const b of blocks) out.push(...blockToNodes(b))
  }
  return out
}

/* ---------------- Markdown ---------------- */

export function toMarkdown(doc: DocNode[]): string {
  const lines: string[] = []
  for (const n of doc) {
    switch (n.t) {
      case 'title':
        lines.push(`# ${n.text}`, '')
        break
      case 'meta':
        lines.push(`**${n.label}:** ${n.text}  `)
        break
      case 'h1':
        lines.push('', `# ${n.text}`, '')
        break
      case 'h2':
        lines.push('', `## ${n.text}`, '')
        break
      case 'h3':
        lines.push('', `### ${n.text}`, '')
        break
      case 'p':
        lines.push(n.text, '')
        break
      case 'quote':
        lines.push(...n.text.split('\n').map((l) => `> ${l}`), '>', `> ${n.cite}`, '')
        break
      case 'note':
        lines.push(`> **${n.label}**`, ...n.text.split('\n').map((l) => `> ${l}`), '')
        break
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/* ---------------- Word (.docx) ---------------- */

export async function toDocx(doc: DocNode[]): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle } = await import('docx')
  const paras: InstanceType<typeof Paragraph>[] = []
  const textRuns = (text: string, opts: Record<string, unknown> = {}) =>
    text.split('\n').map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : 0, ...opts }))
  for (const n of doc) {
    switch (n.t) {
      case 'title':
        paras.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(n.text)] }))
        break
      case 'meta':
        paras.push(new Paragraph({ children: [new TextRun({ text: `${n.label}: `, bold: true }), new TextRun(n.text)] }))
        break
      case 'h1':
        paras.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(n.text)] }))
        break
      case 'h2':
        paras.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun(n.text)] }))
        break
      case 'h3':
        paras.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(n.text)] }))
        break
      case 'p':
        paras.push(new Paragraph({ spacing: { after: 120 }, children: textRuns(n.text) }))
        break
      case 'quote':
        paras.push(
          new Paragraph({
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: '1F5F7A', space: 8 } },
            children: [...textRuns(n.text, { italics: true }), new TextRun({ text: n.cite, break: 1, size: 18, color: '5B6168' })],
            spacing: { after: 160 },
          }),
        )
        break
      case 'note':
        paras.push(
          new Paragraph({
            indent: { left: 340 },
            shading: { fill: 'F2F6F9' },
            children: [new TextRun({ text: n.label, bold: true, size: 18 }), ...textRuns('\n' + n.text, { size: 20 })],
            spacing: { after: 120 },
          }),
        )
        break
    }
  }
  const d = new Document({ creator: 'Arise Bible Study', styles: { default: { document: { run: { font: 'Georgia', size: 22 } } } }, sections: [{ children: paras }] })
  return Packer.toBlob(d)
}

/* ---------------- PDF ---------------- */

export async function toPdf(doc: DocNode[]): Promise<Blob> {
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vfs: any = (vfsMod as any).default ?? vfsMod
  pdfMake.addVirtualFileSystem(vfs)
  const content: unknown[] = []
  for (const n of doc) {
    switch (n.t) {
      case 'title':
        content.push({ text: n.text, style: 'title' })
        break
      case 'meta':
        content.push({ text: [{ text: `${n.label}: `, bold: true }, n.text], margin: [0, 0, 0, 2] })
        break
      case 'h1':
      case 'h2':
        content.push({ text: n.text, style: 'h2' })
        break
      case 'h3':
        content.push({ text: n.text, style: 'h3' })
        break
      case 'p':
        content.push({ text: n.text, margin: [0, 0, 0, 8] })
        break
      case 'quote':
        content.push({
          table: { widths: [3, '*'], body: [[{ text: '', fillColor: '#1F5F7A' }, { stack: [{ text: n.text, italics: true }, { text: n.cite, fontSize: 9, color: '#5B6168', margin: [0, 3, 0, 0] }], margin: [6, 2, 0, 2] }]] },
          layout: 'noBorders',
          margin: [10, 2, 0, 10],
        })
        break
      case 'note':
        content.push({
          table: { widths: ['*'], body: [[{ stack: [{ text: n.label, bold: true, fontSize: 9 }, { text: n.text, fontSize: 10 }], fillColor: '#F2F6F9', margin: [6, 4, 6, 4] }]] },
          layout: 'noBorders',
          margin: [10, 0, 0, 8],
        })
        break
    }
  }
  const def = {
    content,
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.25 },
    pageMargins: [56, 56, 56, 56],
    styles: { title: { fontSize: 20, bold: true, margin: [0, 0, 0, 10] }, h2: { fontSize: 15, bold: true, margin: [0, 14, 0, 6] }, h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] } },
    footer: (page: number, count: number) => ({ text: `${page} / ${count}`, alignment: 'center', fontSize: 8, color: '#888' }),
  }
  return pdfMake.createPdf(def).getBlob()
}

/** Word export: fills the church notes template; falls back to the built-in layout if the template cannot load. */
export async function wordExport(doc: DocNode[], info: { kind: string; series: string }): Promise<Blob> {
  try {
    const { toTemplateDocx } = await import('./docxTemplate')
    return await toTemplateDocx(doc, info)
  } catch (e) {
    console.warn('Template export failed, using the built-in layout instead.', e)
    return toDocx(doc)
  }
}

/** PDF export in the church notes template style; falls back to the built-in layout if it fails. */
export async function pdfExport(doc: DocNode[], info: { kind: string; series: string }): Promise<Blob> {
  try {
    const { toTemplatePdf } = await import('./pdfTemplate')
    return await toTemplatePdf(doc, info)
  } catch (e) {
    console.warn('Template PDF failed, using the built-in layout instead.', e)
    return toPdf(doc)
  }
}
