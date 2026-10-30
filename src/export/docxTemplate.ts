/**
 * Word export that fills the church's notes template (public/templates/notes-template.docx).
 *
 * The template keeps its own styles, theme, numbering, header, footer and page setup. This module only
 * writes body paragraphs, using the same paragraph formatting the template uses for each block kind.
 */
import type { DocNode } from './doc'
import { layoutTemplate, type TBlock, type TemplateInfo } from './templateLayout'

export type { TemplateInfo } from './templateLayout'

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
const BOX = `<w:pBdr><w:left w:val="single" w:sz="14" w:space="8" w:color="${GOLD}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F7F6F2"/>`

function blockXml(b: TBlock): string {
  switch (b.k) {
    case 'series':
      return para('<w:spacing w:before="480" w:after="80"/><w:jc w:val="center"/>', run(b.text.toUpperCase(), { color: '888888', spacing: 120, sz: 20 }))
    case 'title':
      return para('<w:spacing w:after="80"/><w:jc w:val="center"/>', run(b.text.toUpperCase(), { b: true, color: '111111', sz: 48 }))
    case 'subtitle':
      return para('<w:spacing w:after="60"/><w:jc w:val="center"/>', run(b.text, { i: true, color: GOLD, sz: 28 }))
    case 'refs':
      return para('<w:spacing w:before="60" w:after="60"/><w:jc w:val="center"/>', run(b.text, { color: '555555', sz: 22 }))
    case 'divider':
      return para(`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${GOLD}"/></w:pBdr><w:spacing w:before="200" w:after="200"/>`, '')
    case 'body':
      return para('<w:spacing w:before="80" w:after="80" w:line="360" w:lineRule="auto"/>', run(b.text, { color: '000000' }))
    case 'heading':
      return para('<w:pStyle w:val="Heading1"/><w:spacing w:after="160"/>', `<w:r><w:rPr>${FONT}</w:rPr><w:t xml:space="preserve">${esc(b.text.toUpperCase())}</w:t></w:r>`)
    case 'sub':
      return para('<w:spacing w:before="200" w:after="80"/>', run(b.text, { b: true, color: GOLD, sz: 22 }))
    case 'scripture':
      return para(
        `${BOX}<w:spacing w:before="180" w:after="180"/><w:ind w:left="720" w:right="360"/>`,
        run(`"${b.text}"`, { i: true, color: '1C1C1C', sz: 23 }) + run(`  — ${b.cite}`, { b: true, color: GOLD, sz: 20 }),
      )
    case 'keyTruth':
      return para('<w:shd w:val="clear" w:color="auto" w:fill="111111"/><w:spacing w:before="200" w:after="200"/><w:jc w:val="center"/>', run(`  KEY TRUTH: ${b.text}`, { b: true, color: 'FFFFFF', sz: 22 }))
    case 'hardTruth':
      return para('<w:spacing w:before="160" w:after="160"/>', run('HARD TRUTH: ', { b: true, color: GOLD }) + run(b.text, { i: true, color: '000000' }))
    case 'note':
      return para('<w:spacing w:before="100" w:after="100"/><w:ind w:left="360"/>', run(`[${b.label.toUpperCase()}]  `, { b: true, color: GOLD, sz: 20 }) + run(b.text, { i: true, color: '000000', sz: 20 }))
    case 'prayer':
      return para(
        `${BOX}<w:spacing w:before="180" w:after="180" w:line="360" w:lineRule="auto"/><w:ind w:left="720" w:right="360"/>`,
        run(b.lead, { b: true, color: '1C1C1C' }) + run(b.rest, { color: '1C1C1C' }),
      )
    case 'bullet':
      return para(
        '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="80" w:after="80"/>',
        run(b.lead, { b: true, color: '000000' }) + run(b.rest, { color: '000000' }),
      )
  }
}

export async function toTemplateDocx(doc: DocNode[], info: TemplateInfo): Promise<Blob> {
  const res = await fetch(TEMPLATE_URL)
  if (!res.ok) throw new Error(`The Word template is missing (status ${res.status}).`)
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const L = layoutTemplate(doc, info)
  const fill = async (path: string, map: Record<string, string>) => {
    let xml = await zip.file(path)!.async('string')
    for (const [k, v] of Object.entries(map)) xml = xml.split(`{{${k}}}`).join(v)
    zip.file(path, xml)
  }
  await fill('word/document.xml', { BODY: L.blocks.map(blockXml).join('') })
  await fill('word/header1.xml', { HEADER_TITLE: esc(L.headerTitle), HEADER_REF: esc(L.headerRef) })
  await fill('word/footer1.xml', { FOOTER: esc(L.footer) })
  await fill('docProps/core.xml', { DOC_TITLE: esc(L.title) })
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}
