/**
 * Shared layout for the Arise notes template. Both the Word export (docxTemplate.ts) and the PDF export
 * (pdfTemplate.ts) render this same list of blocks, so the two always match.
 *
 * In your own notes, start a line with one of these to get the matching template format:
 *   "KEY TRUTH:"  "HARD TRUTH:"  "PRAYER:"  "[PREACHER NOTE]" (or any "[LABEL]")  "- " for a bullet
 */
import type { DocNode } from './doc'

export type TBlock =
  | { k: 'series' | 'title' | 'subtitle' | 'refs' | 'body' | 'heading' | 'sub' | 'keyTruth' | 'hardTruth'; text: string }
  | { k: 'divider' }
  | { k: 'scripture'; text: string; cite: string }
  | { k: 'note'; label: string; text: string }
  | { k: 'prayer'; lead: string; rest: string }
  | { k: 'bullet'; lead: string; rest: string }

export interface TemplateInfo {
  kind: string // footer label, e.g. "Sermon Manuscript" or "Study Notes"
  series: string // small spaced line above the title
  date?: Date
}

export interface TemplateLayout {
  blocks: TBlock[]
  title: string
  passage: string
  headerTitle: string
  headerRef: string
  footer: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "The poor.  Good news ..." -> bold lead-in up to the first sentence break, as in the template. */
function splitLead(t: string): [string, string] {
  const m = /^([^.!?:]{2,60}[.!?:])(\s+.*)$/s.exec(t)
  return m ? [m[1], m[2]] : ['', t]
}

/** "Father, in the name of Jesus Christ, ..." -> bold opening phrase. */
function splitPrayer(t: string): [string, string] {
  const m = /^(.{3,60},\s)(.*)$/s.exec(t)
  return m ? [m[1], m[2]] : ['', t]
}

function textToBlocks(text: string): TBlock[] {
  const out: TBlock[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let m: RegExpExecArray | null
    if ((m = /^KEY TRUTH:\s*(.*)$/i.exec(line))) out.push({ k: 'keyTruth', text: m[1] })
    else if ((m = /^HARD TRUTH:\s*(.*)$/i.exec(line))) out.push({ k: 'hardTruth', text: m[1] })
    else if ((m = /^PRAYER:\s*(.*)$/i.exec(line))) {
      const [lead, rest] = splitPrayer(m[1])
      out.push({ k: 'prayer', lead, rest })
    } else if ((m = /^\[([^\]]{2,40})\]\s*(.*)$/.exec(line))) out.push({ k: 'note', label: m[1], text: m[2] })
    else if ((m = /^[-•*]\s+(.*)$/.exec(line))) {
      const [lead, rest] = splitLead(m[1])
      out.push({ k: 'bullet', lead, rest })
    } else out.push({ k: 'body', text: line })
  }
  return out
}

export function layoutTemplate(doc: DocNode[], info: TemplateInfo): TemplateLayout {
  const meta = new Map<string, string>()
  let title = 'Untitled'
  for (const n of doc) {
    if (n.t === 'title') title = n.text
    if (n.t === 'meta') meta.set(n.label, n.text)
  }
  const passage = meta.get('Primary passage') ?? ''
  const supporting = [...new Set(doc.filter((n): n is Extract<DocNode, { t: 'quote' }> => n.t === 'quote').map((n) => n.cite.replace(/\s*\(KJV\)$/, '')))].filter(
    (c) => c !== passage,
  )

  const b: TBlock[] = [{ k: 'series', text: info.series }, { k: 'title', text: title }]
  const subtitle = meta.get('Secondary title') || meta.get('Main idea')
  if (subtitle) b.push({ k: 'subtitle', text: subtitle })
  if (passage || supporting.length) b.push({ k: 'refs', text: [passage, ...supporting.slice(0, 3)].filter(Boolean).join('  |  ') })
  b.push({ k: 'divider' })
  const textLine = [passage && `Text: ${passage} (KJV)`, supporting.length ? `Supporting: ${supporting.join(', ')}` : ''].filter(Boolean).join('  |  ')
  if (textLine) b.push({ k: 'body', text: textLine })
  const detailLine = [
    meta.get('Audience') && `Audience: ${meta.get('Audience')}`,
    meta.get('Estimated length') && `Estimated length: ${meta.get('Estimated length')}`,
    meta.get('Approach') && `Approach: ${meta.get('Approach')}`,
    meta.get('Series') && `Series: ${meta.get('Series')}`,
  ]
    .filter(Boolean)
    .join('  |  ')
  if (detailLine) b.push({ k: 'body', text: detailLine })
  if (meta.get('Secondary title') && meta.get('Main idea')) b.push({ k: 'body', text: `Main idea: ${meta.get('Main idea')}` })
  if (meta.get('Teaching objective')) b.push({ k: 'body', text: `Objective: ${meta.get('Teaching objective')}` })
  b.push({ k: 'divider' })

  let firstHeading = true
  for (const n of doc) {
    switch (n.t) {
      case 'h1':
      case 'h2':
        if (!firstHeading) b.push({ k: 'divider' })
        firstHeading = false
        b.push({ k: 'heading', text: n.text })
        break
      case 'h3':
        b.push({ k: 'sub', text: n.text })
        break
      case 'p':
        b.push(...textToBlocks(n.text))
        break
      case 'quote':
        b.push({ k: 'scripture', text: n.text, cite: /\(KJV\)$/.test(n.cite) ? n.cite : `${n.cite} (KJV)` })
        break
      case 'note':
        b.push({ k: 'note', label: n.label, text: n.text.replace(/\n+/g, ' ') })
        break
    }
  }
  b.push({ k: 'divider' })

  const d = info.date ?? new Date()
  return {
    blocks: b,
    title,
    passage,
    headerTitle: title.toUpperCase(),
    headerRef: passage ? `${passage} | KJV` : 'KJV',
    footer: `${info.kind}  |  ${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`,
  }
}
