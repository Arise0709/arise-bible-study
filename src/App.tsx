import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, BookA, Columns3, GraduationCap, HelpCircle, Library, Mic, Search, Settings as SettingsIcon } from 'lucide-react'
import { StudyProvider } from './lib/state'
import { db } from './db/db'
import { loadBookIndex } from './lib/data'
import { Dialog, Loading, ToastHost } from './components/ui'
import { BackupReminder } from './components/DataSafety'
import { AppStatusBanners } from './components/Offline'
import { autoRequestPersistence } from './lib/dataSafety'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BiblePage } from './pages/BiblePage'

import { DictionaryPage, KeyboardHelp, SavedStudiesPage, SearchPage, SettingsPage, SourcesPage } from './pages/OtherPages'

// The study and sermon editors load when first opened, so the first chapter appears sooner.
const workspace = () => import('./pages/WorkspacePage')
const sermons = () => import('./pages/SermonPages')
const StudyStart = lazy(() => workspace().then((m) => ({ default: m.StudyStart })))
const WorkspacePage = lazy(() => workspace().then((m) => ({ default: m.WorkspacePage })))
const SermonsPage = lazy(() => sermons().then((m) => ({ default: m.SermonsPage })))
const SermonEditorPage = lazy(() => sermons().then((m) => ({ default: m.SermonEditorPage })))
const TeachingView = lazy(() => sermons().then((m) => ({ default: m.TeachingView })))
// The Learn area (reading plans and courses) also loads only when opened.
const learn = () => import('./pages/LearnPages')
const plans = () => import('./pages/PlanPages')
const LearnHome = lazy(() => learn().then((m) => ({ default: m.LearnHome })))
const NewPlanPage = lazy(() => plans().then((m) => ({ default: m.NewPlanPage })))
const PlanPage = lazy(() => plans().then((m) => ({ default: m.PlanPage })))

const NAV = [
  { to: '/bible', label: 'Bible', icon: BookOpen },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/study', label: 'Study Workspace', short: 'Study', icon: Columns3 },
  { to: '/learn', label: 'Learn', icon: GraduationCap },
  { to: '/dictionary', label: 'Dictionary', icon: BookA },
  { to: '/sermons', label: 'Sermons & Lessons', short: 'Sermons', icon: Mic },
  { to: '/studies', label: 'Saved Studies', short: 'Saved', icon: Library },
]

function Home() {
  const [to, setTo] = useState<string | null>(null)
  useEffect(() => {
    db.sessions
      .orderBy('at')
      .reverse()
      .first()
      .then((s) => setTo(s?.kind === 'bible' ? s.path : '/bible/John/1'))
      .catch(() => setTo('/bible/John/1'))
  }, [])
  return to ? <Navigate to={to} replace /> : null
}

function BibleRedirect() {
  const [to, setTo] = useState<string | null>(null)
  useEffect(() => {
    db.sessions
      .where('kind')
      .equals('bible')
      .reverse()
      .sortBy('at')
      .then((s) => setTo(s[0]?.path ?? '/bible/John/1'))
      .catch(() => setTo('/bible/John/1'))
  }, [])
  return to ? <Navigate to={to} replace /> : null
}

function Shell() {
  const nav = useNavigate()
  const loc = useLocation()
  const [q, setQ] = useState('')
  const [help, setHelp] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const gPressed = useRef(0)

  useEffect(() => {
    loadBookIndex().catch(() => {})
    void autoRequestPersistence()
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === '?') setHelp(true)
      else if (e.key === 'g') gPressed.current = Date.now()
      else if (Date.now() - gPressed.current < 1200) {
        const map: Record<string, string> = { b: '/bible', w: '/study', d: '/dictionary', s: '/sermons', l: '/studies' }
        if (map[e.key]) nav(map[e.key])
        gPressed.current = 0
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [nav])

  const teaching = /\/teach/.test(loc.pathname)

  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      {!teaching && (
        <header className="topbar no-print">
          <NavLink to="/" className="brand" aria-label="Arise Bible Study home">
            <span className="brand-mark" aria-hidden>A</span>
            <span className="brand-text">Arise Bible Study</span>
          </NavLink>
          <nav className="mainnav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')} title={n.label}>
                <n.icon size={17} aria-hidden />
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <form
            className="topsearch"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`)
            }}
          >
            <Search size={16} aria-hidden />
            <label className="sr-only" htmlFor="global-search">Search the Bible</label>
            <input ref={searchRef} id="global-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="John 3:16, a word, or a phrase  ( / )" />
          </form>
          <button className="iconbtn" onClick={() => setHelp(true)} aria-label="Help and shortcuts">
            <HelpCircle size={19} />
          </button>
          <NavLink to="/settings" className="iconbtn" aria-label="Settings">
            <SettingsIcon size={19} />
          </NavLink>
        </header>
      )}
      {!teaching && <AppStatusBanners />}
      {!teaching && <BackupReminder />}
      <main id="main" className="content">
        <ErrorBoundary key={loc.pathname}>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/bible" element={<BibleRedirect />} />
          <Route path="/bible/:book" element={<BiblePage />} />
          <Route path="/bible/:book/:chapter" element={<BiblePage />} />
          <Route path="/bible/:book/:chapter/:verse" element={<BiblePage />} />
          <Route path="/study" element={<StudyStart />} />
          <Route path="/study/:id" element={<WorkspacePage />} />
          <Route path="/dictionary" element={<DictionaryPage />} />
          <Route path="/sermons" element={<SermonsPage />} />
          <Route path="/sermons/:id" element={<SermonEditorPage />} />
          <Route path="/sermons/:id/teach" element={<TeachingView />} />
          <Route path="/studies" element={<SavedStudiesPage />} />
          <Route path="/learn" element={<LearnHome />} />
          <Route path="/learn/plans/new" element={<NewPlanPage />} />
          <Route path="/learn/plans/:id" element={<PlanPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="*" element={<div className="page"><h1>Page not found</h1><p><NavLink to="/bible">Open the Bible</NavLink></p></div>} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      {!teaching && (
        <nav className="bottomnav no-print" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon size={20} aria-hidden />
              {n.short ?? n.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Dialog open={help} onClose={() => setHelp(false)} title="How to use Arise Bible Study">
        <div className="stack">
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li><strong>Read.</strong> Open a chapter in the Bible. Click any word to see the Hebrew or Greek word behind it.</li>
            <li><strong>Mark.</strong> Click a verse number to highlight, bookmark, note, copy, or see cross-references.</li>
            <li><strong>Study.</strong> Choose “Study this passage” to open the Study Workspace: Scripture, tools, and a guided worksheet side by side.</li>
            <li><strong>Teach.</strong> From a study, choose “Turn into sermon or lesson”, edit the outline, then teach from it or export it.</li>
          </ol>
          <h3>Keyboard</h3>
          <KeyboardHelp />
          <p className="small muted" style={{ margin: 0 }}>
            Data sources and licenses are listed on the <NavLink to="/sources" onClick={() => setHelp(false)}>Sources</NavLink> page.
          </p>
        </div>
      </Dialog>
      <ToastHost />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <StudyProvider>
        <Shell />
      </StudyProvider>
    </BrowserRouter>
  )
}
