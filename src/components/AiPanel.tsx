import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { AI_TASKS, aiStatus, getAiCode, runAssistant, type AiTask } from '../ai/assist'
import { useStudy, useStudySink } from '../lib/state'
import type { Block, WorksheetKey } from '../db/db'
import { BlockView } from './Blocks'
import { Empty, ErrorBox, Loading, toast, useAsync } from './ui'

const TARGET: Record<AiTask, WorksheetKey> = { organize: 'observation', questions: 'interpretation', summarize: 'summary', outline: 'summary', explain: 'interpretation', commentaries: 'interpretation', words: 'wordStudy', ask: 'interpretation' }

export function AiPanel() {
  const { settings } = useStudy()
  const sink = useStudySink()
  const { data: status, loading } = useAsync(() => (settings.aiEnabled ? aiStatus() : Promise.resolve(null)), [settings.aiEnabled])
  const [busy, setBusy] = useState<AiTask | null>(null)
  const [question, setQuestion] = useState('')
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<{ task: AiTask; block: Extract<Block, { kind: 'ai' }> } | null>(null)

  const intro = (
    <div className="notice small">
      <strong>Optional AI study assistant.</strong> It works only from your study (the passage, your word studies and notes), must cite what it
      uses, and every answer is labeled as an AI draft. Quotations and Strong's numbers are checked against the app's data, and anything that
      fails is removed or flagged.
    </div>
  )
  if (!settings.aiEnabled)
    return (
      <div className="stack">
        {intro}
        <Empty>
          The assistant is off. You can turn it on in <Link to="/settings">Settings</Link>.
        </Empty>
      </div>
    )
  if (loading) return <Loading label="Checking the assistant" />
  if (!status?.keyConfigured)
    return (
      <div className="stack">
        {intro}
        <div className="notice warn">
          The assistant is switched on, but this deployment has no AI key. Whoever manages the site needs to add <code>ANTHROPIC_API_KEY</code> in the
          Vercel project settings. Everything else in the app works without it.
        </div>
      </div>
    )
  if (!status.codeConfigured)
    return (
      <div className="stack">
        {intro}
        <div className="notice warn">
          The assistant is locked for safety. Whoever manages the site needs to set <code>AI_ACCESS_CODE</code> in the Vercel project settings, then
          enter the same code in <Link to="/settings">Settings</Link>.
        </div>
      </div>
    )
  if (!getAiCode())
    return (
      <div className="stack">
        {intro}
        <div className="notice warn">
          Enter the AI access code in <Link to="/settings">Settings</Link> to use the assistant on this device.
        </div>
      </div>
    )
  if (!sink)
    return (
      <div className="stack">
        {intro}
        <Empty>Open a study in the Study Workspace to use the assistant on it.</Empty>
      </div>
    )
  const run = async (t: AiTask) => {
    setBusy(t)
    setError(null)
    setResult(null)
    try {
      setResult({ task: t, block: await runAssistant(t, sink.study, { question, commentaries: [settings.commentary, settings.compareCommentary].filter(Boolean) }) })
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="stack">
      {intro}
      <div className="stack">
        {AI_TASKS.map((t) => (
          <button key={t.id} className="btn" style={{ justifyContent: 'flex-start', width: '100%', whiteSpace: 'normal', textAlign: 'left' }} disabled={!!busy} onClick={() => run(t.id)}>
            <Sparkles size={15} /> <span style={{ textAlign: 'left' }}>{t.label} <span className="muted small">· {t.hint}</span></span>
          </button>
        ))}
      </div>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (question.trim()) void run('ask')
        }}
      >
        <label className="field">
          <span>Ask about this passage</span>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value.slice(0, 500))} rows={2} placeholder="For example: What does “all things” include here?" />
        </label>
        <div className="row">
          <button className="btn" disabled={!!busy || !question.trim()}>
            <Sparkles size={15} /> Ask
          </button>
          <span className="muted small">
            Uses this passage, your notes, the {[settings.commentary, settings.compareCommentary].filter(Boolean).join(' and ')} commentary, and the original words.
          </span>
        </div>
      </form>
      {busy && <Loading label="The assistant is reading your study" />}
      {error && <ErrorBox error={error} />}
      {result && (
        <>
          <BlockView block={result.block} onChange={() => {}} readOnly />
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                sink.add(TARGET[result.task], result.block)
                toast('AI draft added to your study (labeled)')
                setResult(null)
              }}
            >
              Add draft to study
            </button>
            <button className="btn" onClick={() => setResult(null)}>Discard</button>
          </div>
        </>
      )}
    </div>
  )
}
