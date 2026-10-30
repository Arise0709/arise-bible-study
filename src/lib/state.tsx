import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSetting, setSetting } from '../db/db'

export interface WordSelection {
  book: string
  chapter: number
  verse: number
  word: number // index into verse.w; -1 for an untagged/added segment
  english: string // the English text clicked (the whole tagged phrase)
  segIndex: number
}

export type ToolTab = 'word' | 'dictionary' | 'thesaurus' | 'xrefs' | 'notes' | 'ai'

export interface Settings {
  theme: 'system' | 'light' | 'dark'
  readerSize: number
  redLetters: boolean
  showMarginNotes: boolean
  showTagged: boolean
  aiEnabled: boolean
}

const DEFAULTS: Settings = { theme: 'system', readerSize: 19, redLetters: true, showMarginNotes: false, showTagged: false, aiEnabled: false }

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
}

const StudyCtx = createContext<Ctx | null>(null)

export function StudyProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [focusVerse, setFocusVerse] = useState<Ctx['focusVerse']>(null)
  const [tool, setTool] = useState<ToolTab>('word')
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

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
    root.style.setProperty('--reader-size', `${settings.readerSize}px`)
  }, [settings.theme, settings.readerSize])

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
    () => ({ selection, select, focusVerse, setFocusVerse, tool, setTool, lookup, setLookup, settings, updateSettings, toolsOpen, setToolsOpen }),
    [selection, select, focusVerse, tool, lookup, setLookup, settings, updateSettings, toolsOpen],
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
}
export const StudySinkCtx = createContext<StudySink | null>(null)
export const useStudySink = () => useContext(StudySinkCtx)
