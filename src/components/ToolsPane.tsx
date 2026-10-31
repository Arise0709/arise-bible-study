import { BookA, BookOpenText, Landmark, Languages, Link2, NotebookPen, Sparkles, Type } from 'lucide-react'
import { useStudy, type ToolTab } from '../lib/state'
import { Tabs } from './ui'
import { WordPanel } from './WordPanel'
import { DictionaryPanel, ThesaurusPanel, VerseNotesPanel, XrefPanel } from './ReferencePanels'
import { AiPanel } from './AiPanel'
import { Suspense, lazy } from 'react'
import { Loading } from './ui'

// research panels load when first opened, so the reader stays light
const CommentaryPanel = lazy(() => import('./CommentaryPanel').then((m) => ({ default: m.CommentaryPanel })))
const ContextPanel = lazy(() => import('./ContextPanel').then((m) => ({ default: m.ContextPanel })))

export function ToolsPane() {
  const { tool, setTool, settings, updateSettings } = useStudy()
  const tabs: { id: ToolTab; label: React.ReactNode }[] = [
    { id: 'word', label: <><Languages size={15} aria-hidden /> Word</> },
    { id: 'commentary', label: <><BookOpenText size={15} aria-hidden /> Commentary</> },
    { id: 'context', label: <><Landmark size={15} aria-hidden /> Context</> },
    { id: 'dictionary', label: <><BookA size={15} aria-hidden /> Dictionary</> },
    { id: 'thesaurus', label: <><Type size={15} aria-hidden /> Thesaurus</> },
    { id: 'xrefs', label: <><Link2 size={15} aria-hidden /> Cross-refs</> },
    { id: 'notes', label: <><NotebookPen size={15} aria-hidden /> Notes</> },
  ]
  if (settings.aiEnabled) tabs.push({ id: 'ai', label: <><Sparkles size={15} aria-hidden /> AI</> })
  return (
    <div className="panel" aria-label="Study tools">
      <h2 className="sr-only">Study tools</h2>
      <div className="row small study-level" role="group" aria-label="Detail level">
        <span className="muted">Detail:</span>
        {(['beginner', 'advanced'] as const).map((l) => (
          <button key={l} className={`btn sm ${settings.studyLevel === l ? 'primary' : ''}`} aria-pressed={settings.studyLevel === l} onClick={() => updateSettings({ studyLevel: l })}>
            {l === 'beginner' ? 'Beginner' : 'Advanced'}
          </button>
        ))}
        <span className="muted" style={{ fontSize: '0.85em' }}>{settings.studyLevel === 'beginner' ? 'Plain explanations first' : 'Full grammar, codes, and lexicons'}</span>
      </div>
      <Tabs label="Study tools" tabs={tabs} value={tool} onChange={setTool} />
      <div className="panel-body" role="tabpanel">
        {tool === 'word' && <WordPanel />}
        <Suspense fallback={<Loading />}>
          {tool === 'commentary' && <CommentaryPanel />}
          {tool === 'context' && <ContextPanel />}
        </Suspense>
        {tool === 'dictionary' && <DictionaryPanel compact />}
        {tool === 'thesaurus' && <ThesaurusPanel />}
        {tool === 'xrefs' && <XrefPanel />}
        {tool === 'notes' && <VerseNotesPanel />}
        {tool === 'ai' && <AiPanel />}
      </div>
    </div>
  )
}
