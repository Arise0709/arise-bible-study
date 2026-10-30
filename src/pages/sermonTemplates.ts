import { db, uid, type Block, type Sermon, type SermonSection, type Study } from '../db/db'
import { getPassage } from '../lib/data'
import { parseOsis } from '../lib/refs'

type Def = [type: string, title: string, level?: 1 | 2, hint?: string]

export const TEMPLATES: Record<string, { name: string; description: string; sections: Def[] }> = {
  arise: {
    name: 'Arise sermon manuscript',
    description: 'The Arise notes template: Opening, numbered sections, and an altar with three prayer points.',
    sections: [
      ['intro', 'Opening — ', 1, 'Opening verse, the setting, and why this matters today.'],
      ['point', 'Section 1 — ', 1, 'Main point. Add a Scripture box, explain it, end with a KEY TRUTH: line.'],
      ['point', 'Section 2 — ', 1, 'Main point.'],
      ['point', 'Section 3 — ', 1, 'Main point.'],
      ['conclusion', 'The Altar — ', 1, 'Response and commissioning.'],
      ['subpoint', 'Prayer Point 1 — ', 2, 'Anchor Scripture, direction, then a PRAYER: line.'],
      ['subpoint', 'Prayer Point 2 — ', 2],
      ['subpoint', 'Prayer Point 3 — ', 2],
    ],
  },
  blank: { name: 'Blank', description: 'Start with an empty outline and add sections as you go.', sections: [] },
  expository: {
    name: 'Expository sermon',
    description: 'Walks through one passage: context, main points drawn from the text, application.',
    sections: [
      ['intro', 'Introduction', 1, 'Hook, the need, and how the passage meets it.'],
      ['context', 'Context of the passage', 1, 'Where this fits in the book and what came before.'],
      ['point', 'Main point 1', 1],
      ['subpoint', 'Supporting point', 2],
      ['point', 'Main point 2', 1],
      ['subpoint', 'Supporting point', 2],
      ['point', 'Main point 3', 1],
      ['wordstudy', 'Word-study insights', 1],
      ['illustration', 'Illustrations and examples', 1],
      ['application', 'Practical applications', 1],
      ['conclusion', 'Conclusion and response', 1, 'Summary, call to respond, closing prayer.'],
    ],
  },
  lesson: {
    name: 'Bible study lesson',
    description: 'Teaching session that moves from observation to interpretation to application.',
    sections: [
      ['intro', 'Opening', 1, 'Welcome, opening question, aim of the lesson.'],
      ['context', 'Read and set the context', 1],
      ['point', 'Observation: what does it say?', 1],
      ['point', 'Interpretation: what does it mean?', 1],
      ['wordstudy', 'Key words', 1],
      ['application', 'Application: how do we live it?', 1],
      ['questions', 'Discussion questions', 1],
      ['conclusion', 'Closing and prayer', 1],
    ],
  },
  topical: {
    name: 'Topical study',
    description: 'Builds one theme from several passages, each read in its own context.',
    sections: [
      ['intro', 'Introduction to the topic', 1],
      ['point', 'Defining the topic from Scripture', 1],
      ['point', 'Passage 1 and what it shows', 1],
      ['point', 'Passage 2 and what it shows', 1],
      ['point', 'Passage 3 and what it shows', 1],
      ['wordstudy', 'Word-study insights', 1],
      ['illustration', 'Illustrations and examples', 1],
      ['application', 'Practical applications', 1],
      ['conclusion', 'Conclusion and response', 1],
    ],
  },
  smallgroup: {
    name: 'Small-group discussion',
    description: 'Interactive guide with questions and room for people to share.',
    sections: [
      ['intro', 'Welcome and icebreaker', 1],
      ['context', 'Read the passage together', 1],
      ['questions', 'Discovery questions', 1],
      ['questions', 'Going deeper', 1],
      ['application', 'Living it out this week', 1],
      ['conclusion', 'Prayer and accountability', 1],
    ],
  },
}

export const SECTION_TYPES: { id: string; label: string }[] = [
  { id: 'intro', label: 'Introduction' },
  { id: 'context', label: 'Context' },
  { id: 'point', label: 'Main point' },
  { id: 'subpoint', label: 'Subpoint' },
  { id: 'wordstudy', label: 'Word-study insights' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'application', label: 'Application' },
  { id: 'questions', label: 'Discussion questions' },
  { id: 'conclusion', label: 'Conclusion and response' },
  { id: 'custom', label: 'Custom' },
]

export function sectionsFromTemplate(key: string): SermonSection[] {
  return (TEMPLATES[key]?.sections ?? []).map(([type, title, level, hint]) => ({
    id: uid(),
    type,
    title,
    level: level ?? (type === 'subpoint' ? 2 : 1),
    blocks: hint ? [{ id: uid(), kind: 'note', text: '' }] : [],
  }))
}

export function newSermon(template: string, folderId?: string, translation = 'KJV'): Sermon {
  const now = Date.now()
  return {
    id: uid(),
    title: 'Untitled',
    passage: '',
    mainIdea: '',
    objective: '',
    audience: '',
    length: template === 'smallgroup' ? '60 minutes' : template === 'lesson' ? '45 minutes' : '35-40 minutes',
    template,
    translation,
    status: 'draft',
    tags: [],
    folderId,
    sections: sectionsFromTemplate(template),
    sources: '',
    createdAt: now,
    updatedAt: now,
  }
}

const copy = (blocks: Block[]) => blocks.map((b) => ({ ...b, id: uid() }) as Block)

const firstLine = (b: Block) => (b.kind === 'note' ? b.text.split('\n')[0].trim() : '')
const shortTitle = (text: string, fallback: string) => {
  const t = text.replace(/^(KEY TRUTH|HARD TRUTH|PRAYER):\s*/i, '').replace(/[.:;,]+$/, '')
  return t && t.length <= 60 ? t : fallback
}

/**
 * Builds a sermon in the shape of the Arise notes template from a worksheet:
 *   Opening (opening verse + context), Section 1..n (one per interpretation note, with observations,
 *   word studies and cross-references as subpoints), and The Altar with three prayer points and the
 *   summary as the closing KEY TRUTH. Every block keeps its kind, so Scripture stays exact KJV and
 *   sourced material stays cited.
 */
export async function createSermonFromStudy(study: Study): Promise<string> {
  const tr = study.translation ?? 'KJV'
  const s = newSermon('arise', undefined, tr)
  const S = study.sections
  const sec = (type: string, title: string, blocks: Block[], level: 1 | 2 = 1): SermonSection => ({ id: uid(), type, title, level, blocks: copy(blocks) })
  const note = (text = ''): Block => ({ id: uid(), kind: 'note', text })
  s.title = study.title.replace(/^Study of /, '')
  s.passage = study.passage
  s.studyId = study.id
  s.tags = [...study.tags]
  const summary = S.summary.find((b) => b.kind === 'note' && b.text.trim())
  s.mainIdea = summary ? firstLine(summary).slice(0, 300) : ''

  // Opening: the first verse of the passage, exactly as in the KJV, then the reader's context notes
  const opening: Block[] = []
  const ref = parseOsis(study.passage)
  if (ref) {
    const first = (await getPassage(ref, tr).catch(() => []))[0]
    if (first) opening.push({ id: uid(), kind: 'scripture', ref: `${first.book}.${first.chapter}.${first.verse}`, text: first.text, tr })
  }
  opening.push(...S.context, note())

  // Sections: one per interpretation note (main points); scripture/source blocks in Interpretation join the first
  const points = S.interpretation.filter((b) => b.kind === 'note' && b.text.trim())
  const extras = S.interpretation.filter((b) => !(b.kind === 'note' && b.text.trim()))
  const sections: SermonSection[] = [sec('intro', 'Opening — ' + shortTitle(s.mainIdea, 'Theme of the opening'), opening)]
  const count = Math.max(points.length, 1)
  for (let i = 0; i < count; i++) {
    const p = points[i]
    const body: Block[] = p ? [p] : [note()]
    if (i === 0) body.unshift(...extras)
    body.push(note()) // room for an explanation or a KEY TRUTH: line
    sections.push(sec('point', `Section ${i + 1} — ` + (p ? shortTitle(firstLine(p), 'Main point') : 'Main point'), body))
    if (i === 0 && S.observation.length) sections.push(sec('subpoint', 'What the text shows', S.observation, 2))
    if (i === 0 && S.wordStudy.length) sections.push(sec('wordstudy', 'Key words', S.wordStudy, 2))
  }
  if (S.crossRefs.length) sections.push(sec('subpoint', 'Supporting Scripture', S.crossRefs, 2))
  if (S.application.length) sections.push(sec('application', `Section ${count + 1} — Living it out`, S.application))

  // The Altar
  const closing = summary && summary.kind === 'note' ? [note(`KEY TRUTH: ${firstLine(summary)}`), ...copy(S.summary.filter((b) => b !== summary))] : [note()]
  sections.push(sec('conclusion', 'The Altar — Response', [note('[LEADER CUE] Read the anchor Scripture over the room before each prayer point.')]))
  for (let i = 1; i <= 3; i++) sections.push(sec('subpoint', `Prayer Point ${i} — `, [note()], 2))
  sections.push(sec('conclusion', 'Closing charge', closing, 2))

  s.sections = sections
  s.sources = "KJV text: CrossWire Bible Society.\nStrong's dictionaries: Open Scriptures (CC BY-SA).\nCross-references: OpenBible.info (CC BY)."
  await db.sermons.add(s)
  return s.id
}
