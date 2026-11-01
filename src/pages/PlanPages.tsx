import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, CheckCircle2, Circle, Download, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { db, type PlanProgress, type ReadingPlan } from '../db/db'
import { Dialog, Empty, Loading, Tabs, downloadBlob, slug, toast, useAsync } from '../components/ui'
import { loadBookIndex, loadTranslationIndex } from '../lib/data'
import { SaveOffline } from '../components/OfflinePacks'
import {
  ALL_DAYS,
  DAY_NAMES,
  PLAN_TEMPLATES,
  addDays,
  changeDays,
  chunkedSessions,
  createPlan,
  formatDay,
  keepFinishDate,
  markSession,
  pausePlan,
  planStatus,
  planToIcs,
  resetPace,
  restartPlan,
  reflectionKey,
  resumePlan,
  saveReflection,
  selectionUnits,
  sessionLabel,
  sessionParts,
  today,
  type PlanStatus,
} from '../lib/plans'

/** Link that opens a reading in the Bible reader with the plan bar. */
export function readingPath(plan: ReadingPlan, sessionIndex: number, part = 0) {
  const parts = sessionParts(plan.sessions[sessionIndex])
  const p = parts[Math.min(part, parts.length - 1)]
  return `${p?.path ?? '/bible'}?plan=${plan.id}&s=${plan.sessions[sessionIndex].id}`
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <div style={{ width: `${percent}%` }} />
    </div>
  )
}

const useChapterCounts = () => useAsync(loadBookIndex, []) // also fills the chapter counts the plans need

function usePlans() {
  const plans = useLiveQuery(() => db.plans.orderBy('updatedAt').reverse().toArray(), [])
  const progress = useLiveQuery(() => db.planProgress.toArray(), [])
  return { plans, progress }
}

/* ---------------- Learn dashboard section ---------------- */

export function PlansSection() {
  const { plans, progress } = usePlans()
  const { data: counts } = useChapterCounts()
  if (!plans || !progress || !counts) return <Loading label="Loading your reading plans" />
  const active = plans.filter((p) => p.status === 'active')
  const paused = plans.filter((p) => p.status === 'paused')
  const done = plans.filter((p) => p.status === 'completed')
  const due = active.flatMap((p) => {
    const st = planStatus(p, progress)
    return [...st.todays, ...st.earlier.slice(0, 1)].slice(0, 2).map((i) => ({ plan: p, index: i, today: st.todays.includes(i) }))
  })
  return (
    <section className="stack" aria-labelledby="plans-h">
      <div className="row">
        <h2 id="plans-h" style={{ margin: 0 }}>Reading plans</h2>
        <span className="spacer" />
        <Link className="btn primary" to="/learn/plans/new">
          <Plus size={16} aria-hidden /> Start a reading plan
        </Link>
      </div>
      {!plans.length && <Empty>No reading plans yet. Start a built-in plan or make your own.</Empty>}
      {due.length > 0 && (
        <div className="card stack" data-testid="todays-readings">
          <h3 style={{ margin: 0 }}>Today's reading</h3>
          <ul className="list">
            {due.map(({ plan, index, today: isToday }) => (
              <li key={plan.id + index} className="row">
                <Link to={readingPath(plan, index)} style={{ fontWeight: 600 }}>{sessionLabel(plan.sessions[index])}</Link>
                <span className="muted small">
                  {plan.title}
                  {!isToday && ', from an earlier day'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {active.length > 0 && <PlanCards plans={active} progress={progress} />}
      {paused.length > 0 && (
        <>
          <h3 style={{ margin: '8px 0 0' }}>Paused</h3>
          <PlanCards plans={paused} progress={progress} />
        </>
      )}
      {done.length > 0 && (
        <details>
          <summary>Completed plans ({done.length})</summary>
          <PlanCards plans={done} progress={progress} />
        </details>
      )}
    </section>
  )
}

function PlanCards({ plans, progress }: { plans: ReadingPlan[]; progress: PlanProgress[] }) {
  return (
    <ul className="list">
      {plans.map((p) => {
        const st = planStatus(p, progress)
        return (
          <li key={p.id} className="stack" style={{ gap: 6 }}>
            <div className="row">
              <Link to={`/learn/plans/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</Link>
              {p.status === 'paused' && <span className="badge">Paused</span>}
              {p.status === 'completed' && <span className="badge source">Completed {p.completedAt ? new Date(p.completedAt).toLocaleDateString() : ''}</span>}
              <span className="spacer" />
              <span className="muted small">
                {st.done} of {st.total} readings
              </span>
            </div>
            <ProgressBar percent={st.percent} label={`${p.title}: ${st.percent}% complete`} />
            {st.next && p.status === 'active' && (
              <div className="small">
                Next: <Link to={readingPath(p, st.next.index)}>{sessionLabel(st.next.session)}</Link>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ---------------- New plan ---------------- */

function DayPicker({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 600, marginBottom: 4 }}>Reading days</legend>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {ALL_DAYS.map((d) => (
          <label key={d} className="chip tap-24" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={days.includes(d)} onChange={(e) => onChange(e.target.checked ? [...days, d].sort() : days.filter((x) => x !== d))} /> {DAY_NAMES[d].slice(0, 3)}
            <span className="sr-only">{DAY_NAMES[d]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function NewPlanPage() {
  const nav = useNavigate()
  const { data: counts, error } = useChapterCounts()
  const { data: translations } = useAsync(loadTranslationIndex, [])
  const [mode, setMode] = useState<'builtin' | 'custom'>('builtin')
  const [templateId, setTemplateId] = useState('bible-year')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selection, setSelection] = useState('')
  const [perSession, setPerSession] = useState(1)
  const [startDate, setStartDate] = useState(today())
  const [targetDate, setTargetDate] = useState('')
  const [days, setDays] = useState<number[]>(ALL_DAYS)
  const [translation, setTranslation] = useState('')
  const [reflection, setReflection] = useState('')
  const [notes, setNotes] = useState('')
  const [remind, setRemind] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => {
    document.title = 'New reading plan · Arise Bible Study'
  }, [])
  const template = PLAN_TEMPLATES.find((t) => t.id === templateId)!
  const custom = useMemo(() => (counts ? selectionUnits(selection) : { units: [], problems: [] }), [selection, counts])
  const sessions = useMemo(() => {
    if (!counts) return []
    return mode === 'builtin' ? template.sessions() : chunkedSessions(custom.units, Math.max(1, perSession))
  }, [mode, template, custom, perSession, counts])
  if (error) return <div className="page notice error">Could not load the Bible index: {error.message}</div>
  if (!counts) return <Loading />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (mode === 'custom' && custom.problems.length) return setErr(`These could not be read as passages: ${custom.problems.join(', ')}. Fix or remove them first.`)
    try {
      const p = await createPlan({
        title: mode === 'builtin' ? title || template.title : title,
        description: mode === 'builtin' ? description || template.description : description,
        sessions,
        kind: mode,
        templateId: mode === 'builtin' ? template.id : undefined,
        editorial: mode === 'builtin' ? template.editorial : undefined,
        startDate,
        days,
        targetDate: targetDate || undefined,
        translation,
        reflection: reflection.split('\n'),
        notes,
        remind,
      })
      toast('Reading plan started')
      nav(`/learn/plans/${p.id}`)
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  return (
    <form className="page stack" onSubmit={submit} style={{ maxWidth: 760 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to="/learn">Learn</Link> / New reading plan
      </p>
      <h1 style={{ margin: 0 }}>Start a reading plan</h1>
      <Tabs
        label="Kind of plan"
        value={mode}
        onChange={setMode}
        tabs={[
          { id: 'builtin', label: 'Built-in plans' },
          { id: 'custom', label: 'Make my own' },
        ]}
      />
      {mode === 'builtin' ? (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
          <legend className="sr-only">Choose a plan</legend>
          {PLAN_TEMPLATES.map((t) => (
            <label key={t.id} className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', borderColor: t.id === templateId ? 'var(--accent)' : undefined }}>
              <input type="radio" name="template" checked={t.id === templateId} onChange={() => setTemplateId(t.id)} style={{ marginTop: 4, flex: 'none' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <strong>
                  {t.title} {t.editorial && <span className="badge">Editorial selection</span>}
                </strong>
                <span className="small">{t.description}</span>
              </span>
            </label>
          ))}
          {template.editorial && (
            <p className="notice info small" style={{ margin: 0 }}>
              The passages in this plan were chosen by Carter Study Bible's editors. It is not a published plan from another organization. Every reference has been checked against the KJV text.
            </p>
          )}
        </fieldset>
      ) : (
        <div className="stack">
          <label className="stack" style={{ gap: 4 }}>
            <strong>Plan title</strong>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Romans and James this spring" />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Description (optional)</strong>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Scripture to read</strong>
            <span className="muted small" id="sel-help">Books, chapters, or passages, separated by semicolons or new lines. For example: Mark; Romans 1-8; Psalm 23; John 3:1-21</span>
            <textarea rows={3} value={selection} onChange={(e) => setSelection(e.target.value)} aria-describedby="sel-help" />
          </label>
          {custom.problems.length > 0 && (
            <div className="notice warn small" role="alert">
              Not found in the Bible: {custom.problems.join(', ')}. Check the spelling or numbers.
            </div>
          )}
          <label className="row">
            <strong>Chapters or passages per reading</strong>
            <input type="number" min={1} max={20} value={perSession} onChange={(e) => setPerSession(Math.max(1, Math.min(20, +e.target.value || 1)))} style={{ width: 80 }} />
          </label>
        </div>
      )}
      <p className="muted small" data-testid="plan-size" style={{ margin: 0 }}>
        {sessions.length} reading{sessions.length === 1 ? '' : 's'}
        {sessions[0] && <> starting with {sessionLabel(sessions[0])}</>}
      </p>
      {mode === 'builtin' && (
        <label className="stack" style={{ gap: 4 }}>
          <strong>Plan title</strong>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={template.title} />
        </label>
      )}
      <div className="grid-2">
        <label className="stack" style={{ gap: 4 }}>
          <strong>Start date</strong>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today())} required />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Finish by (optional)</strong>
          <input type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} aria-describedby="finish-help" />
          <span className="muted small" id="finish-help">Leave empty for one reading per reading day.</span>
        </label>
      </div>
      <DayPicker days={days} onChange={setDays} />
      <label className="stack" style={{ gap: 4 }}>
        <strong>Preferred translation</strong>
        <select value={translation} onChange={(e) => setTranslation(e.target.value)}>
          <option value="">Whatever I am reading in</option>
          {translations?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.id})
            </option>
          ))}
        </select>
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Reflection questions (optional, one per line)</strong>
        <textarea rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder={'What does this passage show about God?\nWhat will I do differently today?'} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <strong>Notes (optional)</strong>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="row">
        <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} /> Show today's reading when I open the Bible
      </label>
      {err && (
        <div className="notice error" role="alert">
          {err}
        </div>
      )}
      <div className="row">
        <button className="btn primary" type="submit" disabled={!sessions.length || !days.length}>
          Start plan
        </button>
        <Link className="btn" to="/learn">
          Cancel
        </Link>
      </div>
    </form>
  )
}

/* ---------------- One plan ---------------- */

export function PlanPage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const plan = useLiveQuery(() => db.plans.get(id), [id])
  const progress = useLiveQuery(() => db.planProgress.where('planId').equals(id).toArray(), [id])
  const { data: counts } = useChapterCounts()
  const { data: translations } = useAsync(loadTranslationIndex, [])
  const [dialog, setDialog] = useState<'' | 'days' | 'finish' | 'calendar' | 'restart' | 'delete'>('')
  const [err, setErr] = useState('')
  useEffect(() => {
    if (plan) document.title = `${plan.title} · Arise Bible Study`
  }, [plan])
  if (plan === null || (plan === undefined && progress !== undefined)) {
    return (
      <div className="page">
        <h1>Plan not found</h1>
        <Link to="/learn">Back to Learn</Link>
      </div>
    )
  }
  if (!plan || !progress || !counts) return <Loading />
  const st = planStatus(plan, progress)
  const run = async (f: () => Promise<unknown>, msg?: string) => {
    setErr('')
    try {
      await f()
      setDialog('')
      if (msg) toast(msg)
    } catch (x) {
      setErr((x as Error).message)
    }
  }

  return (
    <div className="page stack" style={{ maxWidth: 860 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to="/learn">Learn</Link> / Reading plan
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{plan.title}</h1>
        {plan.editorial && <span className="badge">Editorial selection</span>}
        {plan.status === 'paused' && <span className="badge">Paused</span>}
        {plan.status === 'completed' && <span className="badge source">Completed</span>}
      </div>
      {plan.description && <p style={{ margin: 0 }}>{plan.description}</p>}
      <div className="stack" style={{ gap: 4 }}>
        <ProgressBar percent={st.percent} label={`${st.percent}% complete`} />
        <div className="row small">
          <span>
            <strong>{st.percent}%</strong> complete: {st.done} of {st.total} readings, {st.total - st.done} to go
          </span>
          <span className="spacer" />
          {st.finish && <span className="muted">At this pace you finish {formatDay(st.finish, { month: 'long', day: 'numeric', year: 'numeric' })}</span>}
          {plan.run > 1 && <span className="muted">Time through: {plan.run}</span>}
        </div>
      </div>
      {err && (
        <div className="notice error" role="alert">
          {err}
        </div>
      )}

      {plan.status === 'paused' && (
        <div className="notice info row">
          This plan is paused{plan.pausedOn ? ` since ${formatDay(plan.pausedOn)}` : ''}. Nothing comes due while it is paused.
          <span className="spacer" />
          <button className="btn primary" onClick={() => run(() => resumePlan(plan), 'Plan resumed from today')}>
            <Play size={16} aria-hidden /> Resume
          </button>
        </div>
      )}
      {plan.status === 'completed' && (
        <div className="notice ok row">
          <CheckCircle2 size={18} aria-hidden /> You finished this plan{plan.completedAt ? ` on ${new Date(plan.completedAt).toLocaleDateString()}` : ''}.
          <span className="spacer" />
          <button className="btn" onClick={() => setDialog('restart')}>
            <RotateCcw size={16} aria-hidden /> Read it again
          </button>
        </div>
      )}

      {plan.status === 'active' && <TodayBlock plan={plan} st={st} onCatchUp={() => run(() => resetPace(plan), 'Schedule now continues from today')} onKeepDate={() => setDialog('finish')} />}

      {plan.status === 'active' && st.upcoming.length > 0 && (
        <section aria-labelledby="up-h">
          <h2 id="up-h">Coming up</h2>
          <ul className="list">
            {st.upcoming.map((u) => (
              <li key={u.index} className="row">
                <span className="muted small" style={{ minWidth: 92 }}>{formatDay(u.date)}</span>
                <Link to={readingPath(plan, u.index)}>{sessionLabel(plan.sessions[u.index])}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details>
        <summary>
          All readings ({st.done} of {st.total} done)
        </summary>
        <ol className="list" style={{ paddingLeft: 0 }}>
          {plan.sessions.map((s, i) => {
            const done = st.doneIds.has(s.id)
            return (
              <li key={s.id} className="row">
                <input type="checkbox" checked={done} onChange={(e) => markSession(plan, s.id, e.target.checked)} aria-label={`Reading ${i + 1}, ${sessionLabel(s)}, ${done ? 'done' : 'not done'}`} />
                <span className="muted small" style={{ minWidth: 34 }}>{i + 1}.</span>
                <Link to={readingPath(plan, i)}>{sessionLabel(s)}</Link>
              </li>
            )
          })}
        </ol>
      </details>

      <section aria-labelledby="manage-h" className="stack">
        <h2 id="manage-h" style={{ marginBottom: 0 }}>Plan settings</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Reads on {plan.days.length === 7 ? 'every day' : plan.days.map((d) => DAY_NAMES[d]).join(', ')}
          {plan.targetDate ? `, finishing by ${formatDay(plan.targetDate, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
          {plan.pace !== 1 ? ` (${plan.pace >= 1 ? `about ${Math.round(plan.pace * 10) / 10} readings a day` : `one reading every ${Math.round(10 / plan.pace) / 10} reading days`})` : ''}.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {plan.status === 'active' && (
            <button className="btn" onClick={() => run(() => pausePlan(plan), 'Plan paused')}>
              <Pause size={16} aria-hidden /> Pause
            </button>
          )}
          <button className="btn" onClick={() => setDialog('days')}>
            Change reading days
          </button>
          <button className="btn" onClick={() => setDialog('finish')}>
            Change finish date
          </button>
          <button className="btn" onClick={() => setDialog('calendar')}>
            <CalendarDays size={16} aria-hidden /> Add to my calendar
          </button>
          {plan.status !== 'completed' && (
            <button className="btn" onClick={() => setDialog('restart')}>
              <RotateCcw size={16} aria-hidden /> Restart
            </button>
          )}
          <button className="btn danger" onClick={() => setDialog('delete')}>
            <Trash2 size={16} aria-hidden /> Delete plan
          </button>
        </div>
        <label className="row">
          <input type="checkbox" checked={plan.remind} onChange={(e) => db.plans.update(plan.id, { remind: e.target.checked, updatedAt: Date.now() })} /> Show today's reading when I open the Bible
        </label>
        <label className="row">
          <strong>Translation</strong>
          <select value={plan.translation ?? ''} onChange={(e) => db.plans.update(plan.id, { translation: e.target.value || undefined, updatedAt: Date.now() })}>
            <option value="">Whatever I am reading in</option>
            {translations?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
          </select>
        </label>
        <SaveOffline id={`plan:${plan.id}`} label={`Reading plan: ${plan.title}`} refs={plan.sessions.flatMap((x) => x.refs)} translation={plan.translation} />
        <PlanNotes plan={plan} />
      </section>

      <History plan={plan} progress={progress} />

      <DaysDialog open={dialog === 'days'} plan={plan} onClose={() => setDialog('')} onSave={(d) => run(() => changeDays(plan, d), 'Reading days updated')} err={err} />
      <FinishDialog open={dialog === 'finish'} plan={plan} remaining={st.total - st.done} onClose={() => setDialog('')} onSave={(d) => run(() => keepFinishDate(plan, d), 'Finish date updated')} err={err} />
      <CalendarDialog open={dialog === 'calendar'} plan={plan} progress={progress} onClose={() => setDialog('')} />
      <Dialog open={dialog === 'restart'} onClose={() => setDialog('')} title="Restart this plan?">
        <p>You will start again from the first reading today. Your record of this time through ({st.done} readings) stays in the history below.</p>
        <div className="row">
          <button className="btn primary" onClick={() => run(() => restartPlan(plan), 'Plan restarted')}>
            Restart from today
          </button>
          <button className="btn" onClick={() => setDialog('')}>
            Cancel
          </button>
        </div>
      </Dialog>
      <Dialog open={dialog === 'delete'} onClose={() => setDialog('')} title="Delete this plan?">
        <p>
          This removes the plan and its reading history from this device. Your highlights, notes, and bookmarks are not affected. If you have a backup, the plan can be restored from it.
        </p>
        <div className="row">
          <button
            className="btn danger"
            onClick={() =>
              run(async () => {
                await db.transaction('rw', db.plans, db.planProgress, async () => {
                  await db.planProgress.where('planId').equals(plan.id).delete()
                  await db.plans.delete(plan.id)
                })
                nav('/learn')
              }, 'Plan deleted')
            }
          >
            Delete plan
          </button>
          <button className="btn" onClick={() => setDialog('')}>
            Keep it
          </button>
        </div>
      </Dialog>
    </div>
  )
}

function TodayBlock({ plan, st, onCatchUp, onKeepDate }: { plan: ReadingPlan; st: PlanStatus; onCatchUp: () => void; onKeepDate: () => void }) {
  return (
    <section className="card stack" aria-labelledby="today-h" data-testid="plan-today">
      <h2 id="today-h" style={{ margin: 0 }}>
        Today
      </h2>
      {st.todays.length === 0 && st.earlier.length === 0 && (
        <p style={{ margin: 0 }}>
          Nothing scheduled for today.
          {st.next && (
            <>
              {' '}
              Want to read ahead? <Link to={readingPath(plan, st.next.index)}>{sessionLabel(st.next.session)}</Link>
            </>
          )}
        </p>
      )}
      {st.todays.map((i) => (
        <div key={i} className="row">
          <Circle size={16} aria-hidden />
          <Link to={readingPath(plan, i)} style={{ fontWeight: 600 }}>{sessionLabel(plan.sessions[i])}</Link>
          <span className="muted small">
            Reading {i + 1} of {st.total}
          </span>
        </div>
      ))}
      {st.earlier.length > 0 && (
        <div className="stack" style={{ gap: 6 }} data-testid="earlier-readings">
          <p style={{ margin: 0 }}>
            {st.earlier.length === 1 ? 'One reading' : `${st.earlier.length} readings`} from earlier days {st.earlier.length === 1 ? 'is' : 'are'} still open. Read {st.earlier.length === 1 ? 'it' : 'them'} whenever you can, or let the schedule pick up from today.
          </p>
          <ul className="list">
            {st.earlier.slice(0, 5).map((i) => (
              <li key={i}>
                <Link to={readingPath(plan, i)}>{sessionLabel(plan.sessions[i])}</Link>
              </li>
            ))}
            {st.earlier.length > 5 && <li className="muted small">and {st.earlier.length - 5} more in the full list below</li>}
          </ul>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={onCatchUp}>
              Continue from today
            </button>
            <button className="btn" onClick={onKeepDate}>
              Keep a finish date instead
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function PlanNotes({ plan }: { plan: ReadingPlan }) {
  const [text, setText] = useState(plan.notes)
  useEffect(() => {
    if (text === plan.notes) return
    const t = setTimeout(() => db.plans.update(plan.id, { notes: text, updatedAt: Date.now() }), 600)
    return () => clearTimeout(t)
  }, [text, plan.id, plan.notes])
  return (
    <label className="stack" style={{ gap: 4 }}>
      <strong>My notes on this plan</strong>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
    </label>
  )
}

function History({ plan, progress }: { plan: ReadingPlan; progress: PlanProgress[] }) {
  const byId = new Map(plan.sessions.map((s, i) => [s.id, i]))
  const rows = [...progress].sort((a, b) => b.completedAt - a.completedAt)
  const refl = plan.reflections ?? {}
  const loose = Object.entries(refl).filter(([k]) => !progress.some((p) => reflectionKey(p.run, p.sessionId) === k))
  if (!rows.length && !loose.length) return null
  return (
    <details>
      <summary>Reading history ({rows.length})</summary>
      <ul className="list">
        {rows.slice(0, 200).map((p) => {
          const i = byId.get(p.sessionId)
          return (
            <li key={p.id} className="stack" style={{ gap: 2 }}>
              <div className="row small">
                <span className="muted" style={{ minWidth: 100 }}>{new Date(p.completedAt).toLocaleDateString()}</span>
                <span>{i !== undefined ? sessionLabel(plan.sessions[i]) : 'A reading no longer in this plan'}</span>
                {plan.run > 1 && <span className="muted">time {p.run}</span>}
              </div>
              {refl[reflectionKey(p.run, p.sessionId)] && <div className="small" style={{ whiteSpace: 'pre-wrap', paddingLeft: 108 }}>{refl[reflectionKey(p.run, p.sessionId)].text}</div>}
            </li>
          )
        })}
        {loose.map(([k, r]) => {
          const i = byId.get(k.split(':')[1])
          return (
            <li key={k} className="stack" style={{ gap: 2 }}>
              <div className="row small">
                <span className="muted" style={{ minWidth: 100 }}>{new Date(r.at).toLocaleDateString()}</span>
                <span>{i !== undefined ? sessionLabel(plan.sessions[i]) : 'A reading'} (reflection, not marked complete)</span>
              </div>
              <div className="small" style={{ whiteSpace: 'pre-wrap', paddingLeft: 108 }}>{r.text}</div>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function DaysDialog({ open, plan, onClose, onSave, err }: { open: boolean; plan: ReadingPlan; onClose: () => void; onSave: (d: number[]) => void; err: string }) {
  const [days, setDays] = useState(plan.days)
  useEffect(() => setDays(plan.days), [plan.days, open])
  return (
    <Dialog open={open} onClose={onClose} title="Change reading days">
      <div className="stack">
        <DayPicker days={days} onChange={setDays} />
        <p className="muted small" style={{ margin: 0 }}>Readings you have done stay done. The schedule continues from today on the new days.</p>
        {err && <div className="notice error small">{err}</div>}
        <div className="row">
          <button className="btn primary" onClick={() => onSave(days)} disabled={!days.length}>
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function FinishDialog({ open, plan, remaining, onClose, onSave, err }: { open: boolean; plan: ReadingPlan; remaining: number; onClose: () => void; onSave: (d: string) => void; err: string }) {
  const [date, setDate] = useState(plan.targetDate ?? addDays(today(), 30))
  return (
    <Dialog open={open} onClose={onClose} title="Change finish date">
      <div className="stack">
        <label className="stack" style={{ gap: 4 }}>
          <strong>Finish by</strong>
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          The {remaining} readings left will be spread over your reading days until then, starting today.
        </p>
        {err && <div className="notice error small">{err}</div>}
        <div className="row">
          <button className="btn primary" onClick={() => onSave(date)} disabled={!date}>
            Save
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function CalendarDialog({ open, plan, progress, onClose }: { open: boolean; plan: ReadingPlan; progress: PlanProgress[]; onClose: () => void }) {
  const [alarm, setAlarm] = useState('7')
  return (
    <Dialog open={open} onClose={onClose} title="Add readings to your calendar">
      <div className="stack">
        <p style={{ margin: 0 }}>
          Download a calendar file with your upcoming readings. Open it on your phone or computer to add them to your calendar. Your calendar app does the reminding, so nothing is sent from this app.
        </p>
        <label className="row">
          <strong>Remind me at</strong>
          <select value={alarm} onChange={(e) => setAlarm(e.target.value)}>
            <option value="">No reminder</option>
            {[5, 6, 7, 8, 9, 12, 18, 20, 21].map((h) => (
              <option key={h} value={h}>
                {new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>If you change the plan later, download a new file. Your calendar may show the old dates until you remove them.</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={() => {
              downloadBlob(new Blob([planToIcs(plan, progress, location.origin, alarm === '' ? undefined : +alarm)], { type: 'text/calendar' }), `${slug(plan.title)}.ics`)
              onClose()
            }}
          >
            <Download size={16} aria-hidden /> Download calendar file
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/* ---------------- In the Bible reader ---------------- */

/** Bar above the reader while reading a plan assignment. */
export function PlanBar({ planId, sessionId, book, chapter }: { planId: string; sessionId: string; book: string; chapter: number }) {
  const plan = useLiveQuery(() => db.plans.get(planId), [planId])
  const progress = useLiveQuery(() => db.planProgress.where('planId').equals(planId).toArray(), [planId])
  const { data: counts } = useChapterCounts()
  const [note, setNote] = useState<string | null>(null)
  if (plan === undefined || !progress || !counts) return null
  if (!plan) return null
  const index = plan.sessions.findIndex((s) => s.id === sessionId)
  if (index < 0) return null
  const session = plan.sessions[index]
  const parts = sessionParts(session)
  const here = parts.findIndex((p) => p.ref.book === book && p.ref.chapter === chapter)
  const st = planStatus(plan, progress)
  const done = st.doneIds.has(session.id)
  const mine = plan.reflections?.[reflectionKey(plan.run, session.id)]
  const nextIndex = plan.sessions.findIndex((s, i) => i > index && !st.doneIds.has(s.id))
  const q = `?plan=${plan.id}&s=${session.id}`
  const lastPart = here < 0 || here === parts.length - 1
  return (
    <div className="plan-bar no-print" role="region" aria-label="Reading plan" data-testid="plan-bar">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <Link to={`/learn/plans/${plan.id}`} style={{ fontWeight: 600 }}>
          ← {plan.title}
        </Link>
        <span className="muted small">
          Reading {index + 1} of {plan.sessions.length}
        </span>
        {parts.length > 1 && (
          <nav aria-label="Parts of this reading" className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
            {parts.map((p, i) => (
              <Link key={p.path} to={p.path + q} className={`chip ${i === here ? 'active' : ''}`} aria-current={i === here ? 'step' : undefined}>
                {p.label}
              </Link>
            ))}
          </nav>
        )}
        <span className="spacer" />
        {!lastPart && (
          <Link className="btn" to={parts[here + 1].path + q}>
            Next part: {parts[here + 1].label}
          </Link>
        )}
        <button className={`btn ${done ? '' : 'primary'}`} aria-pressed={done} onClick={() => markSession(plan, session.id, !done)} data-testid="mark-complete">
          {done ? <CheckCircle2 size={16} aria-hidden /> : <Circle size={16} aria-hidden />} {done ? 'Completed' : 'Mark complete'}
        </button>
      </div>
      {done && (
        <div className="row small" style={{ flexWrap: 'wrap', marginTop: 6 }} role="status">
          Well done.
          {nextIndex >= 0 ? (
            <>
              {' '}
              Next reading: <Link to={readingPath(plan, nextIndex)}>{sessionLabel(plan.sessions[nextIndex])}</Link>
            </>
          ) : (
            plan.status === 'completed' && ' You have finished this plan.'
          )}
          <Link to={`/learn/plans/${plan.id}`}>Back to plan</Link>
        </div>
      )}
      {lastPart && plan.reflection.length > 0 && (
        <details style={{ marginTop: 6 }} open={!!mine}>
          <summary className="small">Reflection</summary>
          <ul className="small" style={{ margin: '4px 0' }}>
            {plan.reflection.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">My reflection</span>
            <textarea rows={2} value={note ?? mine?.text ?? ''} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button
            className="btn"
            style={{ marginTop: 4 }}
            onClick={async () => {
              await saveReflection(plan, session.id, note ?? '')
              toast('Reflection saved')
            }}
          >
            Save reflection
          </button>
        </details>
      )}
    </div>
  )
}

/** A quiet line in the reader for plans set to show today's reading. Never shown for paused or finished plans. */
export function TodaysReadingLine() {
  const { plans, progress } = usePlans()
  const { data: counts } = useChapterCounts()
  if (!plans || !progress || !counts) return null
  const items = plans
    .filter((p) => p.status === 'active' && p.remind)
    .map((p) => ({ p, st: planStatus(p, progress) }))
    .filter(({ st }) => st.todays.length)
  if (!items.length) return null
  return (
    <div className="plan-bar no-print small row" role="region" aria-label="Today's reading" data-testid="todays-line" style={{ flexWrap: 'wrap' }}>
      <span>Today's reading:</span>
      {items.map(({ p, st }) => (
        <span key={p.id}>
          <Link to={readingPath(p, st.todays[0])}>{sessionLabel(p.sessions[st.todays[0]])}</Link> <span className="muted">({p.title})</span>
        </span>
      ))}
    </div>
  )
}
