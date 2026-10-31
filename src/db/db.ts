import Dexie, { type EntityTable } from 'dexie'

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))

/* ---------- Block model shared by studies and sermons ----------
 * Kinds keep Scripture, sourced material and the reader's own words structurally separate.
 */
export type Block =
  | { id: string; kind: 'scripture'; ref: string; text: string; tr?: string } // exact text in translation tr (KJV when absent), ref is OSIS
  | { id: string; kind: 'source'; source: string; title: string; text: string; citation: string } // quoted reference work
  | { id: string; kind: 'word'; strongs: string; english: string; ref: string; original: string; gloss: string; note: string }
  | { id: string; kind: 'xref'; from: string; to: string; explanation: string }
  | { id: string; kind: 'note'; text: string; uncertain?: boolean } // the reader's own words
  | { id: string; kind: 'ai'; text: string; citations: string[]; warnings: string[]; createdAt: number; sources?: AiSource[] } // labeled AI draft

/** A study resource an AI draft relied on, checked to be one the app gave it. */
export interface AiSource {
  id: string // e.g. COMM:JFB:Rom.8.28-28 or LEX:G4903
  label: string
  kind: 'comm' | 'lex'
  work?: string
  book: string
  chapter: number
  verse: number
  index?: number // position of the word in the Hebrew/Greek verse
  strongs?: string
}
export type BlockKind = Block['kind']

export interface Highlight {
  id: string
  key: string // OSIS verse id, e.g. John.3.16
  book: string
  color: string
  createdAt: number
}

export interface Bookmark {
  id: string
  key: string
  book: string
  label: string
  createdAt: number
}

export interface VerseNote {
  id: string
  ref: string // OSIS, verse or range: John.3.16 or John.3.16-John.3.18
  book: string
  startKey: number // numeric sortable key for lookups
  endKey: number
  text: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface DictEntry {
  id: string
  term: string
  definition: string // the reader's own words
  strongs: string[]
  refs: string[] // OSIS
  examples: string
  notes: string
  tags: string[]
  sources: string // where the reader got supporting information
  createdAt: number
  updatedAt: number
}

export const WORKSHEET_SECTIONS = [
  { key: 'context', title: 'Context', hint: 'Surrounding argument, literary genre, audience, historical background.' },
  { key: 'observation', title: 'Observation', hint: 'Repeated words, commands, promises, contrasts, questions, connections.' },
  { key: 'wordStudy', title: 'Word study', hint: "Important words, Strong's references, and meanings supported by this context." },
  { key: 'crossRefs', title: 'Cross-references', hint: 'Related passages and how each one connects.' },
  { key: 'interpretation', title: 'Interpretation', hint: 'The central meaning, the evidence for it, and unresolved questions.' },
  { key: 'application', title: 'Application', hint: 'Practical implications grounded in the passage.' },
  { key: 'summary', title: 'Summary', hint: 'The main idea in your own words.' },
] as const

export type WorksheetKey = (typeof WORKSHEET_SECTIONS)[number]['key']

export interface Study {
  id: string
  title: string
  passage: string // OSIS range
  translation?: string // translation for quotes (KJV when absent)
  sections: Record<WorksheetKey, Block[]>
  tags: string[]
  folderId?: string
  createdAt: number
  updatedAt: number
}

export interface SermonSection {
  id: string
  type: string // intro, point, subpoint, illustration, application, questions, conclusion, custom
  title: string
  level: 1 | 2
  collapsed?: boolean
  blocks: Block[]
}

export interface Sermon {
  id: string
  title: string
  subtitle?: string // secondary title under the main title
  series?: string // e.g. "The Anointing, Part 2 of 3"
  translation?: string // translation for quotes (KJV when absent)
  passage: string
  mainIdea: string
  objective: string
  audience: string
  length: string
  template: string
  status: 'draft' | 'ready'
  tags: string[]
  folderId?: string
  studyId?: string
  sections: SermonSection[]
  sources: string
  createdAt: number
  updatedAt: number
}

export interface Folder {
  id: string
  name: string
  kind: 'sermon' | 'study'
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

export interface SessionEntry {
  id: string
  kind: 'bible' | 'study' | 'sermon' | 'dictionary'
  path: string
  label: string
  at: number
}

class StudyDB extends Dexie {
  highlights!: EntityTable<Highlight, 'id'>
  bookmarks!: EntityTable<Bookmark, 'id'>
  notes!: EntityTable<VerseNote, 'id'>
  dict!: EntityTable<DictEntry, 'id'>
  studies!: EntityTable<Study, 'id'>
  sermons!: EntityTable<Sermon, 'id'>
  folders!: EntityTable<Folder, 'id'>
  settings!: EntityTable<Setting, 'key'>
  sessions!: EntityTable<SessionEntry, 'id'>

  constructor() {
    super('arise-bible-study')
    this.version(1).stores({
      highlights: 'id, &key, book',
      bookmarks: 'id, &key, book, createdAt',
      notes: 'id, book, startKey, endKey, updatedAt, *tags',
      dict: 'id, term, updatedAt, *tags, *strongs',
      studies: 'id, updatedAt, folderId, *tags',
      sermons: 'id, updatedAt, folderId, status, *tags',
      folders: 'id, kind',
      settings: 'key',
      sessions: 'id, at, kind',
    })
  }
}

export const db = new StudyDB()

export const TABLES = ['highlights', 'bookmarks', 'notes', 'dict', 'studies', 'sermons', 'folders', 'settings', 'sessions'] as const

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key)
  return (s?.value as T) ?? fallback
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value })
}

/** Remember where the reader was, newest first, de-duplicated by path. */
export async function recordSession(kind: SessionEntry['kind'], path: string, label: string) {
  await db.transaction('rw', db.sessions, async () => {
    const same = await db.sessions.filter((s) => s.path === path).toArray()
    await db.sessions.bulkDelete(same.map((s) => s.id))
    await db.sessions.add({ id: uid(), kind, path, label, at: Date.now() })
    const all = await db.sessions.orderBy('at').reverse().toArray()
    if (all.length > 40) await db.sessions.bulkDelete(all.slice(40).map((s) => s.id))
  })
}

export function emptyWorksheet(): Record<WorksheetKey, Block[]> {
  return Object.fromEntries(WORKSHEET_SECTIONS.map((s) => [s.key, []])) as unknown as Record<WorksheetKey, Block[]>
}
