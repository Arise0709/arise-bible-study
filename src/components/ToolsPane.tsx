import { BookA, Languages, Link2, NotebookPen, Sparkles, Type } from 'lucide-react'
import { useStudy, type ToolTab } from '../lib/state'
import { Tabs } from './ui'
import { WordPanel } from './WordPanel'
import { DictionaryPanel, ThesaurusPanel, VerseNotesPanel, XrefPanel } from './ReferencePanels'
import { AiPanel } from './AiPanel'

export function ToolsPane() {
  const { tool, setTool, settings } = useStudy()
  const tabs: { id: ToolTab; label: React.ReactNode }[] = [
    { id: 'word', label: <><Languages size={15} aria-hidden /> Word</> },
    { id: 'dictionary', label: <><BookA size={15} aria-hidden /> Dictionary</> },
    { id: 'thesaurus', label: <><Type size={15} aria-hidden /> Thesaurus</> },
    { id: 'xrefs', label: <><Link2 size={15} aria-hidden /> Cross-refs</> },
    { id: 'notes', label: <><NotebookPen size={15} aria-hidden /> Notes</> },
  ]
  if (settings.aiEnabled) tabs.push({ id: 'ai', label: <><Sparkles size={15} aria-hidden /> AI</> })
  return (
    <div className="panel" aria-label="Study tools">
      <h2 className="sr-only">Study tools</h2>
      <Tabs label="Study tools" tabs={tabs} value={tool} onChange={setTool} />
      <div className="panel-body" role="tabpanel">
        {tool === 'word' && <WordPanel />}
        {tool === 'dictionary' && <DictionaryPanel compact />}
        {tool === 'thesaurus' && <ThesaurusPanel />}
        {tool === 'xrefs' && <XrefPanel />}
        {tool === 'notes' && <VerseNotesPanel />}
        {tool === 'ai' && <AiPanel />}
      </div>
    </div>
  )
}
