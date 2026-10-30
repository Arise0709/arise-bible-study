/**
 * PDF export in the Arise notes template style. Renders the same layout blocks as the Word export,
 * with the template's sizes, colors, rules, Scripture boxes, KEY TRUTH bars, header and footer.
 *
 * Measurements come from the template (twips / 20 = points). The template's SF Pro font cannot be embedded,
 * so the PDF uses Inter (SIL Open Font License, public/fonts/OFL.txt), which is designed to look very close.
 * If the font files cannot load, it falls back to pdfmake's bundled Roboto.
 */
import type { DocNode } from './doc'
import { layoutTemplate, type TBlock, type TemplateInfo } from './templateLayout'

const GOLD = '#B8972A'
const CONTENT_W = 612 - 72 * 2 // Letter width minus 1in margins

const rule = (color: string, width: number, top: number, bottom: number) => ({
  canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: width, lineColor: color }],
  margin: [0, top, 0, bottom],
})

/** A shaded box with a gold bar on the left, used for Scripture and prayers. */
function goldBox(content: unknown, top = 9, bottom = 9) {
  return {
    table: { widths: ['*'], body: [[{ ...(content as object), fillColor: '#F7F6F2', margin: [8, 4, 6, 4] }]] },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 1.75 : 0),
      vLineColor: () => GOLD,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [36, top, 18, bottom],
  }
}

function blockPdf(b: TBlock): unknown {
  switch (b.k) {
    case 'series':
      return { text: b.text.toUpperCase(), alignment: 'center', fontSize: 10, color: '#888888', characterSpacing: 6, margin: [0, 24, 0, 4] }
    case 'title':
      return { text: b.text.toUpperCase(), alignment: 'center', fontSize: 24, bold: true, color: '#111111', margin: [0, 0, 0, 4] }
    case 'subtitle':
      return { text: b.text, alignment: 'center', fontSize: 14, italics: true, color: GOLD, margin: [0, 0, 0, 3] }
    case 'refs':
      return { text: b.text, alignment: 'center', fontSize: 11, color: '#555555', margin: [0, 3, 0, 3] }
    case 'divider':
      return rule(GOLD, 0.75, 10, 10)
    case 'body':
      return { text: b.text, lineHeight: 1.5, margin: [0, 4, 0, 4] }
    case 'heading':
      return { text: b.text.toUpperCase(), fontSize: 18, bold: true, color: '#111111', margin: [0, 8, 0, 8], headlineLevel: 1 }
    case 'sub':
      return { text: b.text, fontSize: 11, bold: true, color: GOLD, margin: [0, 10, 0, 4], headlineLevel: 2 }
    case 'scripture':
      return goldBox({ text: [{ text: `"${b.text}"`, italics: true, color: '#1C1C1C', fontSize: 11.5 }, { text: `  — ${b.cite}`, bold: true, color: GOLD, fontSize: 10 }] })
    case 'keyTruth':
      return {
        table: { widths: ['*'], body: [[{ text: `KEY TRUTH: ${b.text}`, bold: true, color: '#FFFFFF', fontSize: 11, alignment: 'center', fillColor: '#111111', margin: [8, 4, 8, 4] }]] },
        layout: 'noBorders',
        margin: [0, 10, 0, 10],
        unbreakable: true,
      }
    case 'hardTruth':
      return { text: [{ text: 'HARD TRUTH: ', bold: true, color: GOLD }, { text: b.text, italics: true }], margin: [0, 8, 0, 8] }
    case 'note':
      return { text: [{ text: `[${b.label.toUpperCase()}]  `, bold: true, color: GOLD, fontSize: 10 }, { text: b.text, italics: true, fontSize: 10 }], margin: [18, 5, 0, 5] }
    case 'prayer':
      return goldBox({ text: [{ text: b.lead, bold: true, color: '#1C1C1C' }, { text: b.rest, color: '#1C1C1C' }], lineHeight: 1.5 })
    case 'bullet':
      return { ul: [{ text: [{ text: b.lead, bold: true }, { text: b.rest }] }], margin: [18, 4, 0, 4] }
  }
}

const INTER: Record<string, string> = {
  'Inter-Regular.ttf': '/fonts/Inter-Regular.ttf',
  'Inter-Italic.ttf': '/fonts/Inter-Italic.ttf',
  'Inter-Bold.ttf': '/fonts/Inter-Bold.ttf',
  'Inter-BoldItalic.ttf': '/fonts/Inter-BoldItalic.ttf',
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

let interLoaded: Promise<boolean> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadInter(pdfMake: any): Promise<boolean> {
  if (!interLoaded) {
    interLoaded = (async () => {
      try {
        const files: Record<string, string> = {}
        await Promise.all(
          Object.entries(INTER).map(async ([name, url]) => {
            const r = await fetch(url)
            if (!r.ok) throw new Error(url)
            files[name] = toBase64(await r.arrayBuffer())
          }),
        )
        pdfMake.addVirtualFileSystem(files)
        pdfMake.addFonts({ Inter: { normal: 'Inter-Regular.ttf', italics: 'Inter-Italic.ttf', bold: 'Inter-Bold.ttf', bolditalics: 'Inter-BoldItalic.ttf' } })
        return true
      } catch {
        interLoaded = null
        return false
      }
    })()
  }
  return interLoaded
}

export async function toTemplatePdf(doc: DocNode[], info: TemplateInfo): Promise<Blob> {
  const pdfMakeMod = await import('pdfmake/build/pdfmake')
  const vfsMod = await import('pdfmake/build/vfs_fonts')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vfs: any = (vfsMod as any).default ?? vfsMod
  pdfMake.addVirtualFileSystem(vfs)
  const font = (await loadInter(pdfMake)) ? 'Inter' : 'Roboto'
  const L = layoutTemplate(doc, info)

  // merge consecutive bullets into one list
  const content: unknown[] = []
  for (const b of L.blocks) {
    const node = blockPdf(b) as { ul?: unknown[] }
    const prev = content[content.length - 1] as { ul?: unknown[] } | undefined
    if (b.k === 'bullet' && prev?.ul) prev.ul.push(...node.ul!)
    else content.push(node)
  }

  const def = {
    pageSize: 'LETTER',
    pageMargins: [72, 72, 72, 72],
    info: { title: L.title, creator: 'Arise Bible Study' },
    defaultStyle: { font, fontSize: 12, color: '#000000' },
    header: () => ({
      margin: [72, 30, 72, 0],
      stack: [
        {
          columns: [
            { text: L.headerTitle, bold: true, fontSize: 10, color: '#111111' },
            { text: L.headerRef, fontSize: 9, color: '#888888', alignment: 'right' },
          ],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 4, x2: CONTENT_W, y2: 4, lineWidth: 0.5, lineColor: GOLD }] },
      ],
    }),
    footer: (page: number, count: number) => ({
      margin: [72, 20, 72, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0, lineWidth: 0.25, lineColor: '#DDDDDD' }] },
        { columns: [{ text: L.footer, fontSize: 9, color: '#888888' }, { text: `${page} / ${count}`, fontSize: 9, color: '#888888', alignment: 'right' }], margin: [0, 4, 0, 0] },
      ],
    }),
    // keep headings with the content that follows them
    pageBreakBefore: (node: { headlineLevel?: number }, q: { getFollowingNodesOnPage: () => unknown[] }) =>
      !!node.headlineLevel && q.getFollowingNodesOnPage().length === 0,
    content,
  }
  return pdfMake.createPdf(def).getBlob()
}
