import { db, uid, type Block, type Sermon, type SermonSection, type Study } from '../db/db'

type Def = [type: string, title: string, level?: 1 | 2, hint?: string]

export const TEMPLATES: Record<string, { name: string; description: string; sections: Def[] }> = {
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

export function newSermon(template: string, folderId?: string): Sermon {
  const now = Date.now()
  return {
    id: uid(),
    title: 'Untitled',
    passage: '',
    mainIdea: '',
    objective: '',
    audience: '',
    length: template === 'smallgroup' ? '60 minutes' : template === 'lesson' ? '45 minutes' : '35-45 minutes',
    template,
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

/** Builds an expository outline from a worksheet, keeping every block's kind (Scripture, source, own words). */
export async function createSermonFromStudy(study: Study): Promise<string> {
  const s = newSermon('expository')
  const S = study.sections
  const section = (type: string, title: string, blocks: Block[], level: 1 | 2 = 1): SermonSection => ({ id: uid(), type, title, level, blocks: copy(blocks) })
  s.title = study.title.replace(/^Study of /, '')
  s.passage = study.passage
  s.studyId = study.id
  s.tags = [...study.tags]
  const firstSummary = S.summary.find((b) => b.kind === 'note')
  s.mainIdea = firstSummary && firstSummary.kind === 'note' ? firstSummary.text.split('\n')[0].slice(0, 300) : ''
  s.sections = [
    section('intro', 'Introduction', []),
    section('context', 'Context of the passage', S.context),
    section('point', 'Main point', S.interpretation.length ? S.interpretation : []),
    section('subpoint', 'What the text shows', S.observation, 2),
    section('wordstudy', 'Word-study insights', S.wordStudy),
    section('point', 'Supporting Scripture', S.crossRefs),
    section('illustration', 'Illustrations and examples', []),
    section('application', 'Practical applications', S.application),
    section('questions', 'Discussion questions', []),
    section('conclusion', 'Conclusion and response', S.summary),
  ]
  for (const sec of s.sections) if (!sec.blocks.length) sec.blocks.push({ id: uid(), kind: 'note', text: '' })
  s.sources = "KJV text: CrossWire Bible Society.\nStrong's dictionaries: Open Scriptures (CC BY-SA).\nCross-references: OpenBible.info (CC BY)."
  await db.sermons.add(s)
  return s.id
}
