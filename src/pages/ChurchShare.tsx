/**
 * Shared teaching resources and announcements in a workspace (Release 6.2, Stage E), plus the "Share a copy"
 * dialog opened from the Study Workspace and the sermon editor. Loaded only when used.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, Flag, Megaphone, Pin, Plus, Share2, Trash2 } from 'lucide-react'
import { WORKSHEET_SECTIONS, db, uid, type Block, type Lesson, type Sermon, type Study } from '../db/db'
import { Dialog, Empty, ErrorBox, Loading, downloadBlob, toast, useAsync } from '../components/ui'
import { BlockView } from '../components/Blocks'
import { LinkedText, ScriptureRef } from '../components/Scripture'
import { formatRef, isValidRef, parseOsis, parseRef, toOsis } from '../lib/refs'
import { members, myMemberships, rank, type Membership } from '../lib/cloud/orgs'
import { groups, myGroupRows, names, type OrgGroup } from '../lib/cloud/orgGroups'
import { myTeaching, orgCourses } from '../lib/cloud/orgCourses'
import {
  HANDOUT_MAX,
  HANDOUT_TYPES,
  KIND_LABEL,
  announcements,
  approveShare,
  copyOf,
  deleteAnnouncement,
  editors,
  markRead,
  postAnnouncement,
  readIds,
  revokeShare,
  setEditor,
  share,
  shared,
  sharedOne,
  updateShare,
  type ShareContent,
  type ShareKind,
  type SharedResource,
} from '../lib/cloud/orgShare'
import type { OrgCtx } from './ChurchPages'
import { ReportDialog } from './ChurchGroups'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const refText = (o: string) => (parseOsis(o) ? formatRef(parseOsis(o)!) : o)
function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      if (done) toast(done)
      return true
    } catch (e) {
      setError(errText(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}
const Alert = ({ children }: { children: ReactNode }) =>
  children ? (
    <div className="notice error" role="alert">
      {children}
    </div>
  ) : null

/* =============================== the Share a copy dialog =============================== */

export interface ShareSource {
  kind: ShareKind
  title: string
  content: ShareContent
  sourceId?: string
}

/** Chooses a workspace and an audience, explains what is shared, then shares a copy. */
export function ShareDialog({ source, onClose, orgId: fixedOrg }: { source: ShareSource; onClose: () => void; orgId?: string }) {
  const nav = useNavigate()
  const mine = useAsync(() => myMemberships(), [])
  const [orgId, setOrgId] = useState(fixedOrg ?? '')
  useEffect(() => {
    if (!orgId && mine.data?.length) setOrgId(mine.data[0].org.id)
  }, [mine.data, orgId])
  const myGroups = useAsync(async () => {
    if (!orgId) return [] as OrgGroup[]
    const [all, rows] = await Promise.all([groups(orgId), myGroupRows(orgId)])
    const active = new Set(rows.filter((r) => r.status === 'active').map((r) => r.group_id))
    return all.filter((g) => active.has(g.id) && !g.archived_at)
  }, [orgId])
  const [audience, setAudience] = useState('')
  const [title, setTitle] = useState(source.title)
  const [description, setDescription] = useState('')
  const act = useAction()
  const me = mine.data?.find((m) => m.org.id === orgId)
  const needsApproval = !audience && me && rank(me.role) < 4
  return (
    <Dialog open onClose={onClose} title="Share a copy">
      <form
        className="stack"
        data-testid="share-dialog"
        onSubmit={(e) => {
          e.preventDefault()
          let id = ''
          void act
            .run(async () => {
              id = await share(orgId, audience || null, { kind: source.kind, title, description, content: source.content, source_id: source.sourceId })
            })
            .then((ok) => {
              if (!ok) return
              toast(needsApproval ? 'Shared. An administrator will approve it for the whole workspace.' : 'Shared.', { label: 'Open', onClick: () => nav(`/church/${orgId}/shared/${id}`) })
              onClose()
            })
        }}
      >
        {mine.loading && !mine.data ? (
          <Loading />
        ) : !mine.data?.length ? (
          <p style={{ margin: 0 }}>You do not belong to a church workspace yet.</p>
        ) : (
          <>
            {!fixedOrg && mine.data.length > 1 && (
              <label className="stack" style={{ gap: 4 }}>
                <strong>Workspace</strong>
                <select value={orgId} onChange={(e) => (setOrgId(e.target.value), setAudience(''))}>
                  {mine.data.map((m) => (
                    <option key={m.org.id} value={m.org.id}>
                      {m.org.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="stack" style={{ gap: 4 }}>
              <strong>Share with</strong>
              <select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option value="">Everyone in {me?.org.name ?? 'the workspace'}</option>
                {(myGroups.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    Group: {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Title</strong>
              <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Note for readers (optional)</strong>
              <textarea rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="notice info small" style={{ margin: 0 }}>
              This shares a copy of this {KIND_LABEL[source.kind].toLowerCase()} only, as it is now. Your original stays private on your devices, and nothing else of yours is
              shared. You can update the copy, invite editors, or withdraw it at any time.
              {needsApproval ? ' Shares to the whole workspace appear after an administrator approves them.' : ''}
            </div>
            <Alert>{act.error}</Alert>
            <div className="row">
              <button className="btn primary" type="submit" disabled={act.busy || !orgId}>
                <Share2 size={16} aria-hidden /> Share a copy
              </button>
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  )
}

/* =============================== the Shared section =============================== */

export function SharedTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const data = useAsync(async () => {
    const [list, gs] = await Promise.all([shared(org.id), groups(org.id)])
    const n = await names(org.id, list.map((r) => r.owner_id))
    return { list, gs: new Map(gs.map((g) => [g.id, g.name])), n }
  }, [org.id])
  const [adding, setAdding] = useState(false)
  const act = useAction()
  if (data.loading && !data.data) return <Loading label="Loading shared resources" />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { list, gs, n } = data.data!
  const pending = list.filter((r) => !r.approved_at)
  const visible = list.filter((r) => r.approved_at || r.owner_id === ctx.myId)
  const base = `/church/${org.id}/shared`
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <p className="muted small" style={{ margin: 0, flex: 1, minWidth: 220 }}>
          Copies that members chose to share. Originals stay private with their owners, who can update or withdraw them.
        </p>
        <button className="btn" onClick={() => setAdding(true)} data-testid="share-something">
          <Plus size={16} aria-hidden /> Share something
        </button>
      </div>
      {rank(me.role) >= 5 && pending.filter((r) => r.owner_id !== ctx.myId).length > 0 && (
        <section className="card stack" data-testid="pending-shares">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Waiting for your approval</h2>
          {pending
            .filter((r) => r.owner_id !== ctx.myId)
            .map((r) => (
              <div key={r.id} className="row small" style={{ flexWrap: 'wrap' }}>
                <Link to={`${base}/${r.id}`}>{r.title}</Link>
                <span className="muted">
                  {KIND_LABEL[r.kind]} from {n.get(r.owner_id) ?? 'a member'}
                </span>
                <span className="spacer" />
                <button className="btn small primary" disabled={act.busy} onClick={() => void act.run(() => approveShare(r.id), 'Approved for the workspace.').then(data.reload)}>
                  Approve
                </button>
                <button className="btn small" disabled={act.busy} onClick={() => void act.run(() => revokeShare(r.id), 'Removed.').then(data.reload)}>
                  Decline
                </button>
              </div>
            ))}
        </section>
      )}
      <Alert>{act.error}</Alert>
      {!visible.length ? (
        <Empty>Nothing shared yet.</Empty>
      ) : (
        <ul className="list" data-testid="shared-list">
          {visible.map((r) => (
            <li key={r.id} className="stack" style={{ gap: 2 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <Link to={`${base}/${r.id}`} style={{ fontWeight: 600 }}>
                  {r.title}
                </Link>
                <span className="badge">{KIND_LABEL[r.kind]}</span>
                {!r.approved_at && <span className="muted small">waiting for approval</span>}
              </div>
              <span className="muted small">
                {r.owner_id === ctx.myId ? 'You' : (n.get(r.owner_id) ?? 'A member')} · {r.group_id ? `Group: ${gs.get(r.group_id) ?? 'a group'}` : 'Whole workspace'} · updated {new Date(r.updated_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding && <ShareSomething orgId={org.id} onClose={() => (setAdding(false), data.reload())} />}
    </div>
  )
}

/** Choose what to share: something from this device (a study, outline, or lesson), or a collection, handout, or note. */
function ShareSomething({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const [kind, setKind] = useState<ShareKind>('study')
  const [pick, setPick] = useState('')
  const [refs, setRefs] = useState('')
  const [note, setNote] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<{ name: string; type: string; size: number; data: string } | null>(null)
  const [source, setSource] = useState<ShareSource | null>(null)
  const [err, setErr] = useState('')
  const local = useAsync(async () => {
    const [st, se, co] = await Promise.all([db.studies.orderBy('updatedAt').reverse().toArray(), db.sermons.orderBy('updatedAt').reverse().toArray(), db.courses.filter((c) => c.role === 'instructor').toArray()])
    const ls = await db.lessons.where('courseId').anyOf(co.map((c) => c.id)).toArray()
    return { st, se, ls }
  }, [])
  const next = async () => {
    setErr('')
    if (kind === 'study') {
      const s = local.data?.st.find((x) => x.id === pick)
      if (!s) return setErr('Choose a study.')
      return setSource({ kind, title: s.title, content: copyOf('study', s), sourceId: s.id })
    }
    if (kind === 'sermon_outline') {
      const s = local.data?.se.find((x) => x.id === pick)
      if (!s) return setErr('Choose an outline.')
      return setSource({ kind, title: s.title || 'Untitled outline', content: copyOf('sermon_outline', s), sourceId: s.id })
    }
    if (kind === 'lesson') {
      const l = local.data?.ls.find((x) => x.id === pick)
      if (!l) return setErr('Choose a lesson.')
      return setSource({ kind, title: l.title, content: copyOf('lesson', l), sourceId: l.id })
    }
    if (kind === 'scripture_collection') {
      const list = refs.split(/[\n;]+/).map((x) => x.trim()).filter(Boolean)
      const out: string[] = []
      for (const x of list) {
        const r = parseRef(x)
        if (!r || !isValidRef(r)) return setErr(`"${x}" is not a passage the Bible has.`)
        out.push(toOsis(r))
      }
      if (!out.length) return setErr('Enter at least one passage.')
      return setSource({ kind, title: title || 'Scripture collection', content: { refs: out, note } })
    }
    if (kind === 'handout') {
      if (!file) return setErr('Choose a file.')
      return setSource({ kind, title: title || file.name, content: file })
    }
    if (!note.trim()) return setErr('Write the note first.')
    return setSource({ kind, title: title || 'Research note', content: { text: note } })
  }
  if (source) return <ShareDialog source={source} orgId={orgId} onClose={onClose} />
  return (
    <Dialog open onClose={onClose} title="Share something">
      <div className="stack">
        <label className="stack" style={{ gap: 4 }}>
          <strong>What would you like to share?</strong>
          <select value={kind} onChange={(e) => (setKind(e.target.value as ShareKind), setPick(''), setErr(''))}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {(kind === 'study' || kind === 'sermon_outline' || kind === 'lesson') && (
          <label className="stack" style={{ gap: 4 }}>
            <strong>From this device</strong>
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose</option>
              {(kind === 'study' ? local.data?.st : kind === 'sermon_outline' ? local.data?.se : local.data?.ls)?.map((x) => (
                <option key={x.id} value={x.id}>
                  {(x as { title: string }).title || 'Untitled'}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === 'scripture_collection' || kind === 'handout' || kind === 'note') && (
          <label className="stack" style={{ gap: 4 }}>
            <strong>Title</strong>
            <input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        )}
        {kind === 'scripture_collection' && (
          <>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Passages (one per line)</strong>
              <textarea rows={4} value={refs} onChange={(e) => setRefs(e.target.value)} placeholder={'Romans 8:28\nPhilippians 4:6-7'} />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Note (optional)</strong>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        {kind === 'note' && (
          <label className="stack" style={{ gap: 4 }}>
            <strong>Note</strong>
            <textarea rows={5} maxLength={20000} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {kind === 'handout' && (
          <label className="stack" style={{ gap: 4 }}>
            <strong>File (PDF, Word, PowerPoint, text, or image; up to 2 MB)</strong>
            <input
              type="file"
              accept={HANDOUT_TYPES.join(',')}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (!HANDOUT_TYPES.includes(f.type)) return setErr('That kind of file cannot be shared here.')
                if (f.size > HANDOUT_MAX) return setErr('That file is larger than 2 MB.')
                const bytes = new Uint8Array(await f.arrayBuffer())
                let bin = ''
                for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
                setErr('')
                setFile({ name: f.name, type: f.type, size: f.size, data: btoa(bin) })
              }}
            />
          </label>
        )}
        <Alert>{err}</Alert>
        <div className="row">
          <button className="btn primary" onClick={() => void next()}>
            Next
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/* =============================== one shared resource =============================== */

export function SharedResourcePage() {
  const { orgId = '', id = '' } = useParams()
  const nav = useNavigate()
  const data = useAsync(async () => {
    const [all, r, me] = await Promise.all([myMemberships(), sharedOne(id), import('../lib/cloud/orgGroups').then((m) => m.myId())])
    const mem = all.find((m) => m.org.id === orgId)
    if (!mem || !r || r.org_id !== orgId) return undefined
    const [eds, n] = await Promise.all([editors(id), names(orgId, [r.owner_id, r.updated_by ?? ''])])
    return { mem, r, me, eds, n }
  }, [orgId, id])
  const [reporting, setReporting] = useState(false)
  const [managing, setManaging] = useState(false)
  const act = useAction()
  if (data.loading && !data.data) return <Loading label="Loading" />
  if (data.error) return <div className="page"><ErrorBox error={data.error} onRetry={data.reload} /></div>
  if (!data.data)
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Not available</h1>
        <p>This was withdrawn by its owner, or it is not shared with you.</p>
        <Link to={`/church/${orgId}?tab=shared`}>Back to shared resources</Link>
      </div>
    )
  const { mem, r, me, eds, n } = data.data
  const owner = r.owner_id === me
  const editor = r.access === 'edit' && eds.includes(me)
  const isAdmin = rank(mem.role) >= 5
  const keepCopy = async () => {
    const now = Date.now()
    if ('study' in r.content) await db.studies.add({ ...(r.content.study as Study), id: uid(), title: `${r.title} (copy)`, tags: [...(r.content.study.tags ?? []), 'shared copy'], createdAt: now, updatedAt: now })
    else if ('sermon' in r.content) await db.sermons.add({ ...(r.content.sermon as Sermon), id: uid(), title: `${r.title} (copy)`, status: 'draft', createdAt: now, updatedAt: now })
  }
  const updateFromMine = async () => {
    if (r.kind === 'study') {
      const s = await db.studies.get(r.source_id ?? '')
      if (!s) throw new Error('The original is not on this device.')
      await updateShare(r.id, { content: copyOf('study', s) })
    } else if (r.kind === 'sermon_outline') {
      const s = await db.sermons.get(r.source_id ?? '')
      if (!s) throw new Error('The original is not on this device.')
      await updateShare(r.id, { content: copyOf('sermon_outline', s) })
    } else if (r.kind === 'lesson') {
      const l = await db.lessons.get(r.source_id ?? '')
      if (!l) throw new Error('The original is not on this device.')
      await updateShare(r.id, { content: copyOf('lesson', l) })
    }
  }
  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to={`/church/${orgId}`}>{mem.org.name}</Link> / <Link to={`/church/${orgId}?tab=shared`}>Shared</Link>
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{r.title}</h1>
        <span className="badge">{KIND_LABEL[r.kind]}</span>
        {!r.approved_at && <span className="badge editorial">Waiting for approval</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }} data-testid="share-byline">
        Shared by {owner ? 'you' : (n.get(r.owner_id) ?? 'a member')} · updated {new Date(r.updated_at).toLocaleString()}
        {r.updated_by && r.updated_by !== r.owner_id ? ` by ${n.get(r.updated_by) ?? 'an editor'}` : ''}
      </p>
      {r.description && <p style={{ margin: 0 }}>{r.description}</p>}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        {('study' in r.content || 'sermon' in r.content) && (
          <button className="btn" onClick={() => void act.run(keepCopy, 'A copy was saved to your own studies or outlines.')}>
            Save my own copy
          </button>
        )}
        {owner && r.source_id && (
          <button className="btn" onClick={() => void act.run(updateFromMine, 'Updated from your current version.').then(data.reload)} data-testid="update-share">
            Update from my current version
          </button>
        )}
        {owner && (
          <button className="btn" onClick={() => setManaging(true)}>
            Editors and access
          </button>
        )}
        {isAdmin && !r.approved_at && !owner && (
          <button className="btn primary" onClick={() => void act.run(() => approveShare(r.id), 'Approved.').then(data.reload)}>
            Approve
          </button>
        )}
        {(owner || isAdmin) && (
          <button
            className="btn"
            data-testid="revoke-share"
            onClick={() => confirm(owner ? 'Withdraw this share? The copy is deleted for everyone. Your original is not affected.' : 'Remove this from the workspace?') && void act.run(() => revokeShare(r.id), owner ? 'Withdrawn.' : 'Removed.').then((ok) => ok && nav(`/church/${orgId}?tab=shared`))}
          >
            <Trash2 size={15} aria-hidden /> {owner ? 'Withdraw' : 'Remove'}
          </button>
        )}
        {!owner && (
          <button className="btn" onClick={() => setReporting(true)}>
            <Flag size={15} aria-hidden /> Report
          </button>
        )}
      </div>
      <Alert>{act.error}</Alert>
      <ResourceContent r={r} canEdit={owner || editor} onSaved={data.reload} />
      {reporting && <ReportDialog kind="resource" id={r.id} onClose={() => setReporting(false)} />}
      {managing && <EditorsDialog r={r} orgId={orgId} eds={eds} me={mem} onClose={() => (setManaging(false), data.reload())} />}
    </div>
  )
}

function ResourceContent({ r, canEdit, onSaved }: { r: SharedResource; canEdit: boolean; onSaved: () => void }) {
  const c = r.content
  const blocks = (bs: Block[]) => bs.map((b) => <BlockView key={b.id} block={b} onChange={() => {}} readOnly />)
  if ('study' in c)
    return (
      <div className="stack" data-testid="shared-content">
        <p style={{ margin: 0 }}>
          Passage: <ScriptureRef r={c.study.passage} />
        </p>
        {WORKSHEET_SECTIONS.map((s) =>
          c.study.sections?.[s.key]?.length ? (
            <section key={s.key} className="stack">
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{s.title}</h2>
              {blocks(c.study.sections[s.key])}
            </section>
          ) : null,
        )}
      </div>
    )
  if ('sermon' in c)
    return (
      <div className="stack" data-testid="shared-content">
        {c.sermon.subtitle && <p style={{ margin: 0 }}>{c.sermon.subtitle}</p>}
        {c.sermon.passage && (
          <p style={{ margin: 0 }}>
            Passage: <ScriptureRef r={c.sermon.passage} />
          </p>
        )}
        {c.sermon.mainIdea && (
          <p style={{ margin: 0 }}>
            <strong>Main idea:</strong> {c.sermon.mainIdea}
          </p>
        )}
        {c.sermon.sections.map((s) => (
          <section key={s.id} className="stack" style={{ marginLeft: s.level === 2 ? 20 : 0 }}>
            <h2 style={{ margin: 0, fontSize: s.level === 2 ? '1rem' : '1.1rem' }}>{s.title}</h2>
            {blocks(s.blocks)}
          </section>
        ))}
      </div>
    )
  if ('lesson' in c) return <SharedLesson l={c.lesson as Lesson} />
  if ('refs' in c) return <EditableCollection r={r} c={c} canEdit={canEdit} onSaved={onSaved} />
  if ('data' in c)
    return (
      <div className="block" data-testid="shared-content">
        <div className="block-label">Handout</div>
        <button
          className="btn"
          onClick={() => {
            const bin = atob(c.data)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            downloadBlob(new Blob([bytes], { type: c.type }), c.name)
          }}
        >
          <Download size={15} aria-hidden /> {c.name} ({Math.max(1, Math.round(c.size / 1024))} KB)
        </button>
      </div>
    )
  return <EditableNote r={r} text={(c as { text: string }).text} canEdit={canEdit} onSaved={onSaved} />
}

function SharedLesson({ l }: { l: Lesson }) {
  const view = useAsync(() => import('./CoursePages'), [])
  return (
    <div className="stack" data-testid="shared-content">
      {l.intro && <LinkedText text={l.intro} className="prewrap" />}
      {l.primaryRef && (
        <p style={{ margin: 0 }}>
          Scripture: <ScriptureRef r={l.primaryRef} />
        </p>
      )}
      {view.data && l.blocks.map((b) => {
        const V = view.data!.LessonBlockView
        return <V key={b.id} block={b} />
      })}
      {l.discussion.length > 0 && (
        <section>
          <h2 style={{ fontSize: '1.05rem' }}>Discussion</h2>
          <ul>
            {l.discussion.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function EditableNote({ r, text, canEdit, onSaved }: { r: SharedResource; text: string; canEdit: boolean; onSaved: () => void }) {
  const [v, setV] = useState(text)
  const act = useAction()
  if (!canEdit)
    return (
      <div className="block" data-testid="shared-content">
        <LinkedText text={text} className="prewrap" />
      </div>
    )
  return (
    <div className="stack" data-testid="shared-content">
      <label className="sr-only" htmlFor="note-edit">
        Note
      </label>
      <textarea id="note-edit" rows={8} value={v} onChange={(e) => setV(e.target.value)} />
      <Alert>{act.error}</Alert>
      <div>
        <button className="btn primary" disabled={act.busy || v === text} onClick={() => void act.run(() => updateShare(r.id, { content: { text: v } }), 'Saved for everyone.').then(onSaved)}>
          Save changes
        </button>
      </div>
    </div>
  )
}

function EditableCollection({ r, c, canEdit, onSaved }: { r: SharedResource; c: { refs: string[]; note: string }; canEdit: boolean; onSaved: () => void }) {
  const [refs, setRefs] = useState(c.refs.map(refText).join('\n'))
  const [note, setNote] = useState(c.note)
  const act = useAction()
  return (
    <div className="stack" data-testid="shared-content">
      <ul>
        {c.refs.map((x) => (
          <li key={x}>
            <ScriptureRef r={x} />
          </li>
        ))}
      </ul>
      {c.note && <LinkedText text={c.note} className="prewrap" />}
      {canEdit && (
        <details>
          <summary>Edit the collection</summary>
          <div className="stack" style={{ marginTop: 8 }}>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Passages (one per line)</strong>
              <textarea rows={4} value={refs} onChange={(e) => setRefs(e.target.value)} />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <strong>Note</strong>
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Alert>{act.error}</Alert>
            <div>
              <button
                className="btn primary"
                disabled={act.busy}
                onClick={() =>
                  void act
                    .run(async () => {
                      const out = refs.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => {
                        const p = parseRef(x)
                        if (!p || !isValidRef(p)) throw new Error(`"${x}" is not a passage the Bible has.`)
                        return toOsis(p)
                      })
                      await updateShare(r.id, { content: { refs: out, note } })
                    }, 'Saved for everyone.')
                    .then(onSaved)
                }
              >
                Save changes
              </button>
            </div>
          </div>
        </details>
      )}
    </div>
  )
}

function EditorsDialog({ r, orgId, eds, me, onClose }: { r: SharedResource; orgId: string; eds: string[]; me: Membership; onClose: () => void }) {
  const people = useAsync(async () => (await members(orgId)).rows.filter((m) => m.user_id !== r.owner_id), [orgId])
  const [current, setCurrent] = useState(eds)
  const act = useAction()
  void me
  return (
    <Dialog open onClose={onClose} title="Editors and access">
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Everyone it is shared with can read it. Editors you invite can also change it. You can remove an editor, or withdraw the share, at any time.
        </p>
        {people.loading && !people.data ? (
          <Loading />
        ) : (
          <fieldset className="stack" style={{ gap: 4, maxHeight: 300, overflow: 'auto' }}>
            <legend>
              <strong>Editors</strong>
            </legend>
            {(people.data ?? []).map((m) => (
              <label key={m.user_id} className="row">
                <input
                  type="checkbox"
                  checked={current.includes(m.user_id)}
                  disabled={act.busy}
                  onChange={(e) => {
                    const allow = e.target.checked
                    void act.run(() => setEditor(r.id, m.user_id, allow)).then((ok) => ok && setCurrent(allow ? [...current, m.user_id] : current.filter((x) => x !== m.user_id)))
                  }}
                />{' '}
                {m.display_name}
              </label>
            ))}
          </fieldset>
        )}
        <Alert>{act.error}</Alert>
        <div>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/* =============================== announcements =============================== */

export function AnnouncementsTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const data = useAsync(async () => {
    const [list, gs, rows, cs, teach] = await Promise.all([announcements(org.id), groups(org.id), myGroupRows(org.id), orgCourses(org.id), myTeaching(org.id)])
    const read = await readIds(list.map((a) => a.id))
    const n = await names(org.id, list.map((a) => a.created_by ?? ''))
    const leads = new Set(rows.filter((r) => r.role === 'leader' && r.status === 'active').map((r) => r.group_id))
    return {
      list,
      read,
      n,
      gName: new Map(gs.map((g) => [g.id, g.name])),
      cName: new Map(cs.map((c) => [c.id, c.title])),
      myGroups: gs.filter((g) => rank(me.role) >= 5 || (rank(me.role) >= 2 && leads.has(g.id))),
      myCourses: cs.filter((c) => rank(me.role) >= 5 || (rank(me.role) >= 3 && teach.has(c.id))),
    }
  }, [org.id])
  const [writing, setWriting] = useState(false)
  const act = useAction()
  useEffect(() => {
    const d = data.data
    if (d) {
      const unread = d.list.filter((a) => !d.read.has(a.id)).map((a) => a.id)
      if (unread.length) void markRead(unread).then(() => window.dispatchEvent(new Event('abs-announcements-read')))
    }
  }, [data.data])
  if (data.loading && !data.data) return <Loading label="Loading announcements" />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const d = data.data!
  const canPost = rank(me.role) >= 4 || d.myGroups.length > 0 || d.myCourses.length > 0
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <p className="muted small" style={{ margin: 0, flex: 1, minWidth: 220 }}>
          Announcements for the workspace and for your groups and courses. They appear here in the app; they are not emailed.
        </p>
        {canPost && (
          <button className="btn" onClick={() => setWriting(true)} data-testid="new-announcement">
            <Megaphone size={16} aria-hidden /> Post an announcement
          </button>
        )}
      </div>
      <Alert>{act.error}</Alert>
      {!d.list.length ? (
        <Empty>No announcements.</Empty>
      ) : (
        <ul className="list" data-testid="announcements">
          {d.list.map((a) => (
            <li key={a.id} className="stack" style={{ gap: 4 }} data-unread={!d.read.has(a.id) || undefined}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {a.pinned && <Pin size={14} aria-label="Pinned" />}
                <strong>{a.title}</strong>
                {!d.read.has(a.id) && <span className="badge source">New</span>}
                <span className="muted small">
                  {a.group_id ? `Group: ${d.gName.get(a.group_id) ?? ''}` : a.course_id ? `Course: ${d.cName.get(a.course_id) ?? ''}` : 'Whole workspace'} · {d.n.get(a.created_by ?? '') ?? 'A leader'} ·{' '}
                  {new Date(a.created_at).toLocaleDateString()}
                </span>
                <span className="spacer" />
                {(a.created_by === ctx.myId || rank(me.role) >= 5) && (
                  <button className="btn small" onClick={() => confirm('Delete this announcement?') && void act.run(() => deleteAnnouncement(a.id), 'Deleted.').then(data.reload)}>
                    Delete
                  </button>
                )}
              </div>
              {a.body && <LinkedText text={a.body} className="prewrap" />}
            </li>
          ))}
        </ul>
      )}
      {writing && <AnnouncementDialog ctx={ctx} groups={d.myGroups} courses={d.myCourses} onClose={() => (setWriting(false), data.reload())} />}
    </div>
  )
}

function AnnouncementDialog({ ctx, groups: gs, courses: cs, onClose }: { ctx: OrgCtx; groups: OrgGroup[]; courses: { id: string; title: string }[]; onClose: () => void }) {
  const orgWide = rank(ctx.me.role) >= 4
  const [scope, setScope] = useState(orgWide ? '' : gs[0] ? `g:${gs[0].id}` : cs[0] ? `c:${cs[0].id}` : '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [expires, setExpires] = useState('')
  const act = useAction()
  return (
    <Dialog open onClose={onClose} title="Post an announcement">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void act
            .run(() => postAnnouncement(ctx.org.id, { title, body, pinned, expires_on: expires || undefined, group_id: scope.startsWith('g:') ? scope.slice(2) : undefined, course_id: scope.startsWith('c:') ? scope.slice(2) : undefined }), 'Posted.')
            .then((ok) => ok && onClose())
        }}
      >
        <label className="stack" style={{ gap: 4 }}>
          <strong>For</strong>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {orgWide && <option value="">Everyone in {ctx.org.name}</option>}
            {gs.map((g) => (
              <option key={g.id} value={`g:${g.id}`}>
                Group: {g.name}
              </option>
            ))}
            {cs.map((c) => (
              <option key={c.id} value={`c:${c.id}`}>
                Course: {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Title</strong>
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Class moves to Thursday" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Message</strong>
          <textarea rows={4} maxLength={8000} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="row small">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top
          </label>
          <label className="row small">
            Show until (optional)
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Shown in the app to the people it is for. Not emailed.
        </p>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Post
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
