import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSetting, setSetting } from '../db/db'
import { applyAppearance } from './appearance'
import { setErrorReporting } from './errorReport'

export interface WordSelection {
  book: string
  chapter: number
  verse: number
  word: number // index into verse.w; -1 for an untagged/added segment
  english: string // the English text clicked (the whole tagged phrase)
  segIndex: number
  /** set when chosen in the interlinear view: the word's position in the Hebrew/Greek verse and its Strong's number */
  orig?: { index: number; strongs: string }
}

export type ToolTab = 'word' | 'commentary' | 'context' | 'dictionary' | 'thesaurus' | 'xrefs' | 'notes' | 'ai'

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  readerSize: number
  uiSize: number
  accent: string
  tone: string
  scriptureFont: string
  uiFont: string
  lineSpacing: string
  translation: string // primary translation in the reader ('KJV' or an id from translations/index.json)
  compareWith: string // second translation shown under each verse, '' for none
  quoteTranslation: string // translation for new studies and sermons; '' = same as the reading translation
  redLetters: boolean
  showMarginNotes: boolean
  showTagged: boolean
  aiEnabled: boolean
  errorReports: boolean // send anonymous crash reports (no study content)
  commentary: string // commentator shown first in the Commentary tab
  compareCommentary: string // second commentator shown alongside, '' for none
  studyLevel: 'beginner' | 'advanced' // how much technical detail study tools show first (same sources either way)
  interlinear: boolean // reader shows the Hebrew/Greek interlinear
  interlinearGrammar: boolean // interlinear shows Strong's numbers and grammar codes under each word
}

export const DEFAULTS: Settings = {
  theme: 'system',
  readerSize: 19,
  uiSize: 15,
  accent: 'teal',
  tone: 'warm',
  scriptureFont: 'literata',
  uiFont: 'inter',
  lineSpacing: 'normal',
  translation: 'KJV',
  compareWith: '',
  quoteTranslation: '',
  redLetters: true,
  showMarginNotes: false,
  showTagged: false,
  aiEnabled: false,
  errorReports: true,
  commentary: 'MHCC',
  compareCommentary: '',
  studyLevel: 'beginner',
  interlinear: false,
  interlinearGrammar: false,
}

interface Ctx {
  selection: WordSelection | null
  select: (s: WordSelection | null) => void
  focusVerse: { book: string; chapter: number; verse: number } | null
  setFocusVerse: (v: { book: string; chapter: number; verse: number } | null) => void
  tool: ToolTab
  setTool: (t: ToolTab) => void
  lookup: string
  setLookup: (term: string, tab?: ToolTab) => void
  settings: Settings
  updateSettings: (p: Partial<Settings>) => void
  toolsOpen: boolean
  setToolsOpen: (b: boolean) => void
  /** The chapter the reader is showing, so study tools can follow it before a verse is chosen. */
  readerLoc: { book: string; chapter: number } | null
  setReaderLoc: (l: { book: string; chapter: number }) => void
}

const StudyCtx = createContext<Ctx | null>(null)

export function StudyProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [focusVerse, setFocusVerse] = useState<Ctx['focusVerse']>(null)
  const [tool, setTool] = useState<ToolTab>('word')
  const [readerLoc, setReaderLocState] = useState<Ctx['readerLoc']>(null)
  const setReaderLoc = useCallback((l: { book: string; chapter: number }) => setReaderLocState((cur) => (cur?.book === l.book && cur.chapter === l.chapter ? cur : l)), [])
  const [lookup, setLookupState] = useState('')
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem('abs-settings')
      if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch {
      /* storage may be unavailable */
    }
    return DEFAULTS
  })
  const [toolsOpen, setToolsOpen] = useState(false)

  // Settings live in IndexedDB (backed up with everything else); localStorage gives an instant first paint.
  useEffect(() => {
    getSetting<Partial<Settings>>('settings', {}).then((s) => setSettings((cur) => ({ ...cur, ...s })))
  }, [])

  useEffect(
    () => applyAppearance(settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.theme, settings.readerSize, settings.uiSize, settings.accent, settings.tone, settings.scriptureFont, settings.uiFont, settings.lineSpacing],
  )

  useEffect(() => setErrorReporting(settings.errorReports), [settings.errorReports])

  const updateSettings = useCallback((p: Partial<Settings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem('abs-settings', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      setSetting('settings', next)
      return next
    })
  }, [])

  const select = useCallback((s: WordSelection | null) => {
    setSelection(s)
    if (s) {
      setTool('word')
      setToolsOpen(true)
    }
  }, [])

  const setLookup = useCallback((term: string, tab?: ToolTab) => {
    setLookupState(term)
    if (tab) {
      setTool(tab)
      setToolsOpen(true)
    }
  }, [])

  const value = useMemo(
    () => ({ selection, select, focusVerse, setFocusVerse, tool, setTool, lookup, setLookup, settings, updateSettings, toolsOpen, setToolsOpen, readerLoc, setReaderLoc }),
    [selection, select, focusVerse, tool, lookup, setLookup, settings, updateSettings, toolsOpen, readerLoc, setReaderLoc],
  )
  return <StudyCtx.Provider value={value}>{children}</StudyCtx.Provider>
}

export function useStudy() {
  const c = useContext(StudyCtx)
  if (!c) throw new Error('useStudy must be used inside StudyProvider')
  return c
}

/** When a study is open in the workspace, tools can add blocks straight into it. */
export interface StudySink {
  studyId: string
  study: import('../db/db').Study
  add: (section: string, block: import('../db/db').Block) => void
  /** Show a passage in the workspace's Scripture panel (keeps the study open). */
  showPassage?: (r: { book: string; chapter: number; verse?: number }) => void
}
export const StudySinkCtx = createContext<StudySink | null>(null)
export const useStudySink = () => useContext(StudySinkCtx)

/** The translation new quotes, studies and sermons should use. */
export const quoteTr = (s: Settings) => s.quoteTranslation || s.translation || 'KJV'
