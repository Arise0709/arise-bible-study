/**
 * Group Bible studies (Release 6.2, Stage D): the Groups section of a workspace, a group's page (studies,
 * discussion, members, settings), and a group study (the leader prepares and reviews it; members read, study,
 * and submit). Loaded only with the workspace pages.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BookOpen, ExternalLink, Flag, Lock, MessageSquare, Plus, Unlock, Users } from 'lucide-react'
import { db, emptyWorksheet, uid } from '../db/db'
import { Dialog, Empty, ErrorBox, Loading, Tabs, toast, useAsync } from '../components/ui'
import { LinkedText, SourceHtml } from '../components/Scripture'
import { formatRef, parseOsis, parseRef, toOsis, isValidRef } from '../lib/refs'
import { loadCommentaryChapter, loadCommentaryIndex } from '../lib/data'
import { ROLE_LABEL, members, myMemberships, rank, type Membership } from '../lib/cloud/orgs'
import {
  VISIBILITY_LABEL,
  addPost,
  createTopic,
  editPost,
  group,
  groupMembers,
  groups,
  moderate,
  myGroupRows,
  myId,
  myResponse,
  names,
  noteOnResponse,
  openReports,
  posts,
  report,
  requestToJoin,
  resolveReport,
  responses,
  saveGroup,
  saveResponse,
  saveStudy,
  setGroupMember,
  studies,
  study,
  submittedCounts,
  topics,
  type GroupResponse,
  type GroupStudy,
  type OrgGroup,
  type StudyResource,
  type Topic,
} from '../lib/cloud/orgGroups'
import type { OrgCtx } from './ChurchPages'
import { PrimaryScripture } from './CoursePages'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const refText = (o: string) => (parseOsis(o) ? formatRef(parseOsis(o)!) : o)
const bibleHref = (o: string) => {
  const r = parseOsis(o)
  return r ? `/bible/${r.book}/${r.chapter}${r.verse ? '/' + r.verse : ''}` : '/bible'
}

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

/* =============================== the Groups section =============================== */

export function GroupsTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const data = useAsync(async () => {
    const [all, mine] = await Promise.all([groups(org.id), myGroupRows(org.id)])
    return { all, mine }
  }, [org.id])
  const [creating, setCreating] = useState(false)
  const act = useAction()
  const nav = useNavigate()
  if (data.loading && !data.data) return <Loading label="Loading groups" />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { all, mine } = data.data!
  const row = new Map(mine.map((m) => [m.group_id, m]))
  const active = all.filter((g) => !g.archived_at)
  const myGroups = active.filter((g) => row.get(g.id)?.status === 'active')
  const open = active.filter((g) => g.visibility === 'org' && row.get(g.id)?.status !== 'active')
  const others = rank(me.role) >= 5 ? active.filter((g) => !myGroups.includes(g) && !open.includes(g)) : []
  const base = `/church/${org.id}/groups`
  const item = (g: OrgGroup, extra?: ReactNode) => (
    <li key={g.id} className="stack" style={{ gap: 2 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <Link to={`${base}/${g.id}`} style={{ fontWeight: 600 }}>
          {g.name}
        </Link>
        {row.get(g.id)?.role === 'leader' && row.get(g.id)?.status === 'active' && <span className="badge source">You lead</span>}
        <span className="spacer" />
        {extra}
      </div>
      {(g.topic || g.schedule) && (
        <span className="muted small">
          {g.topic}
          {g.topic && g.schedule ? ' · ' : ''}
          {g.schedule}
        </span>
      )}
    </li>
  )
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Your groups</h2>
        <span className="spacer" />
        {rank(me.role) >= 4 && (
          <button className="btn" onClick={() => setCreating(true)} data-testid="create-group">
            <Plus size={16} aria-hidden /> Create a group
          </button>
        )}
      </div>
      {!myGroups.length ? <Empty>You are not in a group yet.</Empty> : <ul className="list" data-testid="my-groups">{myGroups.map((g) => item(g))}</ul>}
      <Alert>{act.error}</Alert>
      {open.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Groups you can ask to join</h2>
          <ul className="list" data-testid="open-groups">
            {open.map((g) =>
              item(
                g,
                row.get(g.id)?.status === 'requested' ? (
                  <span className="muted small">Request sent</span>
                ) : (
                  <button className="btn small" disabled={act.busy} onClick={() => void act.run(() => requestToJoin(g.id), 'Request sent to the group leader.').then(data.reload)}>
                    Ask to join
                  </button>
                ),
              ),
            )}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Other groups in this workspace</h2>
          <ul className="list">{others.map((g) => item(g))}</ul>
        </section>
      )}
      <GroupDialog ctx={ctx} open={creating} onClose={() => setCreating(false)} onSaved={(id) => nav(`${base}/${id}`)} />
    </div>
  )
}

function GroupDialog({ ctx, open, onClose, onSaved, existing }: { ctx: OrgCtx | { org: { id: string }; me: Membership; myId: string }; open: boolean; onClose: () => void; onSaved: (id: string) => void; existing?: OrgGroup }) {
  const [f, setF] = useState({ name: existing?.name ?? '', description: existing?.description ?? '', topic: existing?.topic ?? '', schedule: existing?.schedule ?? '', visibility: existing?.visibility ?? ('private' as OrgGroup['visibility']), discussions: existing?.discussions ?? false, leader: '' })
  const leaders = useAsync(async () => (open && !existing ? (await members(ctx.org.id)).rows.filter((m) => rank(m.role) >= 2) : []), [open, ctx.org.id])
  const act = useAction()
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
  return (
    <Dialog open={open} onClose={onClose} title={existing ? 'Group settings' : 'Create a group'}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          let id = existing?.id ?? ''
          const { leader, ...rest } = f
          void act
            .run(async () => {
              id = await saveGroup(ctx.org.id, existing?.id ?? null, existing ? rest : { ...rest, leader: leader || ctx.myId })
            }, existing ? 'Saved.' : 'Group created.')
            .then((ok) => ok && (onClose(), onSaved(id)))
        }}
      >
        <label className="stack" style={{ gap: 4 }}>
          <strong>Group name</strong>
          <input required maxLength={120} value={f.name} onChange={set('name')} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Study topic</strong>
          <input maxLength={200} value={f.topic} onChange={set('topic')} placeholder="e.g. Romans 8" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Description</strong>
          <textarea rows={2} maxLength={2000} value={f.description} onChange={set('description')} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Schedule (optional)</strong>
          <input maxLength={200} value={f.schedule} onChange={set('schedule')} placeholder="e.g. Tuesdays 7 PM" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Who can find it</strong>
          <select value={f.visibility} onChange={set('visibility')}>
            {Object.entries(VISIBILITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <span className="muted small">Member lists stay private in every case.</span>
        </label>
        <label className="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={f.discussions} onChange={set('discussions')} /> <span>Turn on group discussion (the leader can hide posts and lock topics)</span>
        </label>
        {!existing && (
          <label className="stack" style={{ gap: 4 }}>
            <strong>Group leader</strong>
            <select value={f.leader} onChange={set('leader')}>
              <option value="">Me</option>
              {(leaders.data ?? [])
                .filter((m) => m.user_id !== ctx.myId)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name} ({ROLE_LABEL[m.role]})
                  </option>
                ))}
            </select>
          </label>
        )}
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            {existing ? 'Save' : 'Create group'}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* =============================== shared route loading =============================== */

interface GroupCtx {
  orgId: string
  me: Membership
  myId: string
  group: OrgGroup
  leader: boolean
  member: boolean
  base: string
}
function useGroupCtx() {
  const { orgId = '', groupId = '' } = useParams()
  const r = useAsync(async () => {
    const [all, g, mine, uid] = await Promise.all([myMemberships(), group(groupId), myGroupRows(orgId), myId()])
    const me = all.find((m) => m.org.id === orgId)
    if (!me || !g || g.org_id !== orgId) return undefined
    const row = mine.find((m) => m.group_id === groupId)
    const leader = rank(me.role) >= 5 || (rank(me.role) >= 2 && row?.role === 'leader' && row.status === 'active')
    return { orgId, me, myId: uid, group: g, leader, member: row?.status === 'active', base: `/church/${orgId}/groups/${groupId}` } as GroupCtx
  }, [orgId, groupId])
  return { loading: r.loading && !r.data, error: r.error, ctx: r.data, reload: r.reload }
}
function GroupNotAvailable({ orgId }: { orgId: string }) {
  return (
    <div className="page stack" style={{ maxWidth: 720 }}>
      <h1>Group not available</h1>
      <p>This group is not open to you, or it no longer exists.</p>
      <Link to={`/church/${orgId}?tab=groups`}>Back to groups</Link>
    </div>
  )
}

/* =============================== a group's page =============================== */

export function GroupPage() {
  const { orgId = '' } = useParams()
  const c = useGroupCtx()
  const [tab, setTab] = useState<'studies' | 'discussion' | 'members'>('studies')
  const [editing, setEditing] = useState(false)
  const act = useAction()
  const nav = useNavigate()
  useEffect(() => {
    if (c.ctx) document.title = `${c.ctx.group.name} · Arise Bible Study`
  }, [c.ctx])
  if (c.loading) return <Loading label="Loading the group" />
  if (c.error) return <div className="page"><ErrorBox error={c.error} onRetry={c.reload} /></div>
  if (!c.ctx) return <GroupNotAvailable orgId={orgId} />
  const g = c.ctx
  const canSee = g.leader || g.member
  const tabs = [{ id: 'studies' as const, label: 'Studies' }, ...(g.group.discussions || g.leader ? [{ id: 'discussion' as const, label: 'Discussion' }] : []), { id: 'members' as const, label: 'Members' }]
  return (
    <div className="page stack" style={{ maxWidth: 960 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to={`/church/${g.orgId}`}>{g.me.org.name}</Link> / <Link to={`/church/${g.orgId}?tab=groups`}>Groups</Link>
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{g.group.name}</h1>
        {g.group.archived_at && <span className="badge">Archived</span>}
        <span className="spacer" />
        {g.leader && (
          <button className="btn small" onClick={() => setEditing(true)}>
            Group settings
          </button>
        )}
        {g.member && !g.leader && (
          <button className="btn small" onClick={() => confirm(`Leave ${g.group.name}? Your submitted responses stay with the group.`) && void act.run(() => setGroupMember(g.group.id, g.myId, null), 'You left the group.').then((ok) => ok && nav(`/church/${g.orgId}?tab=groups`))}>
            Leave group
          </button>
        )}
      </div>
      {(g.group.topic || g.group.schedule) && (
        <p className="muted" style={{ margin: 0 }}>
          {g.group.topic}
          {g.group.topic && g.group.schedule ? ' · ' : ''}
          {g.group.schedule}
        </p>
      )}
      {g.group.description && <p style={{ margin: 0 }}>{g.group.description}</p>}
      <Alert>{act.error}</Alert>
      {!canSee ? (
        <div className="notice info">This group is open to workspace members. Ask to join from the Groups list; the leader will add you.</div>
      ) : (
        <>
          <Tabs tabs={tabs} value={tab} onChange={setTab} label="Group sections" />
          <div role="tabpanel">
            {tab === 'studies' && <StudiesPanel g={g} />}
            {tab === 'discussion' && <DiscussionPanel g={g} />}
            {tab === 'members' && <GroupMembersPanel g={g} />}
          </div>
        </>
      )}
      {editing && <GroupDialog ctx={{ org: { id: g.orgId }, me: g.me, myId: g.myId }} existing={g.group} open={editing} onClose={() => setEditing(false)} onSaved={() => c.reload()} />}
    </div>
  )
}

function StudiesPanel({ g }: { g: GroupCtx }) {
  const data = useAsync(async () => {
    const list = await studies(g.group.id)
    const counts = g.leader ? await submittedCounts(list.map((s) => s.id)) : new Map<string, number>()
    const memberCount = g.leader ? (await groupMembers(g.group.id)).filter((m) => m.status === 'active' && m.role === 'member').length : 0
    return { list, counts, memberCount }
  }, [g.group.id])
  const nav = useNavigate()
  const act = useAction()
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { list, counts, memberCount } = data.data!
  return (
    <div className="stack">
      {g.leader && (
        <div>
          <button
            className="btn primary"
            data-testid="new-group-study"
            disabled={act.busy}
            onClick={() => void act.run(async () => nav(`${g.base}/studies/${await saveStudy(g.group.id, null, { title: 'New study', passage: 'Rom.8.1-Rom.8.39', questions: [], resources: [] })}`))}
          >
            <Plus size={16} aria-hidden /> Prepare a study
          </button>
        </div>
      )}
      <Alert>{act.error}</Alert>
      {!list.length ? (
        <Empty>{g.leader ? 'No studies yet. Prepare one, then assign it to the group.' : 'No studies assigned yet.'}</Empty>
      ) : (
        <ul className="list" data-testid="group-studies">
          {list.map((s) => (
            <li key={s.id} className="row" style={{ flexWrap: 'wrap' }}>
              <Link to={`${g.base}/studies/${s.id}`} style={{ fontWeight: 600 }}>
                {s.title}
              </Link>
              <span className="muted small">{refText(s.passage)}</span>
              <span className={`badge ${s.status === 'assigned' ? 'source' : ''}`}>{s.status === 'draft' ? 'Draft (only leaders see it)' : s.status === 'assigned' ? 'Assigned' : 'Closed'}</span>
              {s.due_on && <span className="muted small">due {s.due_on}</span>}
              {g.leader && s.status !== 'draft' && (
                <span className="muted small">
                  {counts.get(s.id) ?? 0} of {memberCount} submitted
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* =============================== members of a group =============================== */

function GroupMembersPanel({ g }: { g: GroupCtx }) {
  const data = useAsync(async () => {
    const list = await groupMembers(g.group.id)
    return { list, n: await names(g.orgId, list.map((m) => m.user_id)) }
  }, [g.group.id])
  const [adding, setAdding] = useState(false)
  const act = useAction()
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { list, n } = data.data!
  const name = (u: string) => n.get(u) ?? 'Member'
  const requests = list.filter((m) => m.status === 'requested')
  const active = list.filter((m) => m.status === 'active').sort((a, b) => (a.role === b.role ? name(a.user_id).localeCompare(name(b.user_id)) : a.role === 'leader' ? -1 : 1))
  return (
    <div className="stack">
      {g.leader && requests.length > 0 && (
        <section className="card stack" data-testid="join-requests">
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Asking to join</h2>
          {requests.map((m) => (
            <div key={m.user_id} className="row" style={{ flexWrap: 'wrap' }}>
              {name(m.user_id)}
              <span className="spacer" />
              <button className="btn small primary" onClick={() => void act.run(() => setGroupMember(g.group.id, m.user_id, 'member'), `${name(m.user_id)} added.`).then(data.reload)}>
                Add to the group
              </button>
              <button className="btn small" onClick={() => void act.run(() => setGroupMember(g.group.id, m.user_id, null), 'Request declined.').then(data.reload)}>
                Decline
              </button>
            </div>
          ))}
        </section>
      )}
      <Alert>{act.error}</Alert>
      {g.leader && g.group.visibility !== 'invite' && (
        <div>
          <button className="btn" onClick={() => setAdding(true)}>
            <Users size={16} aria-hidden /> Add members
          </button>
        </div>
      )}
      {g.leader && g.group.visibility === 'invite' && <p className="muted small" style={{ margin: 0 }}>People join this group by invitation (workspace Invitations section).</p>}
      <ul className="list" data-testid="group-members">
        {active.map((m) => (
          <li key={m.user_id} className="row" style={{ flexWrap: 'wrap' }}>
            {name(m.user_id)}
            {m.role === 'leader' && <span className="badge source">Leader</span>}
            {m.user_id === g.myId && <span className="muted small">(you)</span>}
            <span className="spacer" />
            {g.leader && m.user_id !== g.myId && (
              <>
                {m.role === 'member' && (
                  <button className="btn small" onClick={() => void act.run(() => setGroupMember(g.group.id, m.user_id, 'leader'), `${name(m.user_id)} now co-leads.`).then(data.reload)}>
                    Make co-leader
                  </button>
                )}
                <button className="btn small" onClick={() => confirm(`Remove ${name(m.user_id)} from the group?`) && void act.run(() => setGroupMember(g.group.id, m.user_id, null), 'Removed.').then(data.reload)}>
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding && <AddMembersDialog g={g} existing={new Set(list.filter((m) => m.status === 'active').map((m) => m.user_id))} onClose={() => setAdding(false)} onDone={data.reload} />}
    </div>
  )
}

function AddMembersDialog({ g, existing, onClose, onDone }: { g: GroupCtx; existing: Set<string>; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const list = useAsync(async () => (await members(g.orgId, { search })).rows.filter((m) => !existing.has(m.user_id)), [search, g.orgId])
  const [pick, setPick] = useState<string[]>([])
  const act = useAction()
  return (
    <Dialog open onClose={onClose} title="Add members">
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          {rank(g.me.role) >= 5 ? 'Choose workspace members.' : 'You see leaders and the people you already share a group or course with. To add someone else, invite them to this group from the workspace Invitations section.'}
        </p>
        <label className="sr-only" htmlFor="gm-search">
          Search members
        </label>
        <input id="gm-search" type="search" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.length ? (
          <Empty>No one else to add.</Empty>
        ) : (
          <fieldset className="stack" style={{ gap: 4, maxHeight: 280, overflow: 'auto' }}>
            <legend className="sr-only">Members</legend>
            {list.data.map((m) => (
              <label key={m.user_id} className="row">
                <input type="checkbox" checked={pick.includes(m.user_id)} onChange={() => setPick(pick.includes(m.user_id) ? pick.filter((x) => x !== m.user_id) : [...pick, m.user_id])} /> {m.display_name}
              </label>
            ))}
          </fieldset>
        )}
        <Alert>{act.error}</Alert>
        <div className="row">
          <button
            className="btn primary"
            disabled={!pick.length || act.busy}
            onClick={() =>
              void act
                .run(async () => {
                  for (const u of pick) await setGroupMember(g.group.id, u, 'member')
                }, `${pick.length} added.`)
                .then((ok) => ok && (onDone(), onClose()))
            }
          >
            Add {pick.length || ''}
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  )
}

/* =============================== a group study =============================== */

export function GroupStudyPage() {
  const { orgId = '', studyId = '' } = useParams()
  const c = useGroupCtx()
  const s = useAsync(() => study(studyId), [studyId])
  if (c.loading || (s.loading && !s.data)) return <Loading label="Loading the study" />
  if (c.error || s.error) return <div className="page"><ErrorBox error={(c.error ?? s.error)!} onRetry={() => (c.reload(), s.reload())} /></div>
  if (!c.ctx || !s.data || s.data.group_id !== c.ctx.group.id) return <GroupNotAvailable orgId={orgId} />
  const g = c.ctx
  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <p className="small" style={{ margin: 0 }}>
        <Link to={`/church/${g.orgId}`}>{g.me.org.name}</Link> / <Link to={`/church/${g.orgId}?tab=groups`}>Groups</Link> / <Link to={g.base}>{g.group.name}</Link>
      </p>
      {g.leader ? <LeaderStudy g={g} s={s.data} onSaved={s.reload} /> : <MemberStudy g={g} s={s.data} />}
    </div>
  )
}

function StudyBody({ s }: { s: GroupStudy }) {
  const nav = useNavigate()
  const r = parseOsis(s.passage)
  return (
    <div className="stack">
      {r && <PrimaryScripture osis={s.passage} />}
      <div className="row no-print" style={{ flexWrap: 'wrap' }}>
        <button
          className="btn"
          data-testid="study-this-passage"
          onClick={async () => {
            // a private study of the passage in the person's own Study Workspace (never shared unless they choose)
            const id = uid()
            const now = Date.now()
            await db.studies.add({ id, title: `${s.title} (${refText(s.passage)})`, passage: s.passage, sections: emptyWorksheet(), tags: ['group study'], createdAt: now, updatedAt: now })
            nav(`/study/${id}`)
          }}
        >
          <BookOpen size={16} aria-hidden /> Study this passage
        </button>
        <span className="muted small">Opens your own private study of the passage, with word tools and commentaries.</span>
      </div>
      {s.instructions && (
        <section>
          <h2 style={{ fontSize: '1.1rem' }}>Instructions</h2>
          <LinkedText text={s.instructions} className="prewrap" />
        </section>
      )}
      {s.resources.length > 0 && (
        <section className="stack">
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Resources from your leader</h2>
          {s.resources.map((x, i) => (
            <ResourceView key={i} x={x} />
          ))}
        </section>
      )}
    </div>
  )
}

function ResourceView({ x }: { x: StudyResource }) {
  if (x.kind === 'link')
    return (
      <div className="block">
        <div className="block-label">Research link</div>
        <a href={x.url} target="_blank" rel="noopener noreferrer nofollow">
          {x.title || x.url} <ExternalLink size={13} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    )
  if (x.kind === 'passage')
    return (
      <div className="block">
        <div className="block-label">Read also</div>
        <Link to={bibleHref(x.ref)}>{refText(x.ref)}</Link>
        {x.note && <div className="small">{x.note}</div>}
      </div>
    )
  return <CommentaryExcerpt work={x.work} osis={x.ref} />
}

/** The commentary's own note on a verse, quoted with its source (static public text, not anyone's data). */
function CommentaryExcerpt({ work, osis }: { work: string; osis: string }) {
  const r = parseOsis(osis)
  const d = useAsync(async () => {
    if (!r) return null
    const [index, ch] = await Promise.all([loadCommentaryIndex(), loadCommentaryChapter(work, r.book, r.chapter)])
    const v = r.verse ?? 1
    const entry = ch.e.find(([a, b]) => a <= v && v <= b)
    return { name: index.works.find((w) => w.id === work)?.title ?? work, html: entry?.[2] ?? null }
  }, [work, osis])
  return (
    <div className="block source" data-testid="commentary-excerpt">
      <div className="block-label">
        Commentary · {d.data?.name ?? work} on <Link to={bibleHref(osis)}>{refText(osis)}</Link>
      </div>
      {d.loading ? <Loading /> : d.error ? <div className="small muted">Could not load this commentary note.</div> : d.data?.html ? <SourceHtml html={d.data.html} /> : <div className="small muted">This commentary has no note on this verse.</div>}
    </div>
  )
}

function MemberStudy({ g, s }: { g: GroupCtx; s: GroupStudy }) {
  const mine = useAsync(() => myResponse(s.id), [s.id])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [reflection, setReflection] = useState('')
  const [read, setRead] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const act = useAction()
  useEffect(() => {
    if (mine.data !== undefined && !loaded) {
      setAnswers(mine.data?.answers ?? {})
      setReflection(mine.data?.reflection ?? '')
      setRead(mine.data?.read_done ?? false)
      setLoaded(true)
    }
  }, [mine.data, loaded])
  const submitted = mine.data?.status === 'submitted'
  const closed = s.status === 'closed'
  const save = (status: 'draft' | 'submitted') =>
    void act.run(() => saveResponse(s.id, { answers, reflection, read_done: read, status }), status === 'submitted' ? 'Submitted to your leader.' : 'Draft saved. Only you can see it.').then(() => mine.reload())
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{s.title}</h1>
        {s.due_on && <span className="muted">due {s.due_on}</span>}
        {closed && <span className="badge">Closed</span>}
      </div>
      <StudyBody s={s} />
      <form
        className="card stack"
        data-testid="group-response"
        onSubmit={(e) => {
          e.preventDefault()
          save('submitted')
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Your response</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Drafts are private. Your leader sees your answers only after you press Submit. Nothing from your personal notes or studies is shared.
        </p>
        <label className="row">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} disabled={closed} /> I read {refText(s.passage)}
        </label>
        {s.questions.map((q, i) => (
          <label key={i} className="stack" style={{ gap: 4 }}>
            <span>
              {i + 1}. <LinkedText text={q} />
            </span>
            <textarea rows={3} value={answers[String(i)] ?? ''} onChange={(e) => setAnswers({ ...answers, [String(i)]: e.target.value })} disabled={closed} />
          </label>
        ))}
        <label className="stack" style={{ gap: 4 }}>
          <span>Reflection</span>
          <textarea rows={4} value={reflection} onChange={(e) => setReflection(e.target.value)} disabled={closed} />
        </label>
        {submitted && (
          <div className="notice ok small" role="status" data-testid="response-submitted">
            Submitted {new Date(mine.data!.submitted_at!).toLocaleString()}. You can still change it and submit again{closed ? ' (this study is closed now)' : ''}.
          </div>
        )}
        {mine.data?.leader_note && (
          <div className="notice info small" data-testid="leader-note">
            <strong>From your leader:</strong> {mine.data.leader_note}
          </div>
        )}
        <Alert>{act.error}</Alert>
        {!closed && (
          <div className="row">
            <button className="btn primary" type="submit" disabled={act.busy}>
              {submitted ? 'Submit changes' : 'Submit to my leader'}
            </button>
            {!submitted && (
              <button className="btn" type="button" disabled={act.busy} onClick={() => save('draft')}>
                Save draft
              </button>
            )}
          </div>
        )}
      </form>
      {g.group.discussions && (
        <p className="small">
          <Link to={`${g.base}`}>Go to the group discussion</Link>
        </p>
      )}
    </div>
  )
}

function LeaderStudy({ g, s, onSaved }: { g: GroupCtx; s: GroupStudy; onSaved: () => void }) {
  const [f, setF] = useState({ title: s.title, passage: refText(s.passage), instructions: s.instructions, questions: s.questions.join('\n'), due_on: s.due_on ?? '' })
  const [resources, setResources] = useState<StudyResource[]>(s.resources)
  const [view, setView] = useState<'edit' | 'responses' | 'preview'>(s.status === 'draft' ? 'edit' : 'responses')
  const act = useAction()
  const works = useAsync(async () => (await loadCommentaryIndex()).works, [])
  const persist = async (status?: GroupStudy['status']) => {
    const r = parseRef(f.passage)
    if (!r || !isValidRef(r)) throw new Error('Enter a passage such as Romans 8 or Romans 8:1-17.')
    for (const x of resources) {
      if (x.kind === 'link' && !/^https:\/\/\S+$/.test(x.url)) throw new Error('Research links must start with https://')
      if ((x.kind === 'commentary' || x.kind === 'passage') && !parseOsis(x.ref)) throw new Error('Each commentary or passage needs a real verse.')
    }
    await saveStudy(g.group.id, s.id, {
      title: f.title.trim() || 'Untitled study',
      passage: toOsis(r),
      instructions: f.instructions,
      questions: f.questions.split('\n').map((q) => q.trim()).filter(Boolean),
      resources,
      due_on: f.due_on || null,
      ...(status ? { status } : {}),
    })
    onSaved()
  }
  const [newRes, setNewRes] = useState<{ kind: StudyResource['kind']; work: string; ref: string; url: string; title: string }>({ kind: 'commentary', work: 'MHCC', ref: '', url: '', title: '' })
  const addRes = () => {
    if (newRes.kind === 'link') {
      if (!/^https:\/\/\S+$/.test(newRes.url)) return act.setError('Research links must start with https://')
      setResources([...resources, { kind: 'link', url: newRes.url.trim(), title: newRes.title.trim() }])
    } else {
      const r = parseRef(newRes.ref)
      if (!r || !isValidRef(r)) return act.setError('Enter a verse such as Romans 8:28.')
      setResources([...resources, newRes.kind === 'commentary' ? { kind: 'commentary', work: newRes.work, ref: toOsis(r) } : { kind: 'passage', ref: toOsis(r) }])
    }
    act.setError('')
    setNewRes({ ...newRes, ref: '', url: '', title: '' })
  }
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>{s.title}</h1>
        <span className={`badge ${s.status === 'assigned' ? 'source' : ''}`} data-testid="group-study-status">
          {s.status === 'draft' ? 'Draft' : s.status === 'assigned' ? 'Assigned' : 'Closed'}
        </span>
      </div>
      <Tabs
        tabs={[
          { id: 'edit', label: 'Prepare' },
          { id: 'preview', label: 'What members see' },
          { id: 'responses', label: 'Responses' },
        ]}
        value={view}
        onChange={setView}
        label="Study sections"
      />
      {view === 'preview' && <StudyBody s={s} />}
      {view === 'responses' && <Responses g={g} s={s} />}
      {view === 'edit' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void act.run(() => persist(), 'Saved.')
          }}
        >
          <label className="stack" style={{ gap: 4 }}>
            <strong>Title</strong>
            <input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Scripture passage</strong>
            <input required value={f.passage} onChange={(e) => setF({ ...f, passage: e.target.value })} placeholder="e.g. Romans 8" />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Instructions</strong>
            <textarea rows={3} maxLength={8000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Study questions (one per line)</strong>
            <textarea rows={5} value={f.questions} onChange={(e) => setF({ ...f, questions: e.target.value })} />
          </label>
          <fieldset className="stack" style={{ gap: 6 }}>
            <legend>
              <strong>Resources</strong>
            </legend>
            {resources.map((x, i) => (
              <div key={i} className="row small" style={{ flexWrap: 'wrap' }}>
                <span>
                  {x.kind === 'commentary' ? `Commentary: ${(works.data ?? []).find((w) => w.id === x.work)?.title ?? x.work} on ${refText(x.ref)}` : x.kind === 'passage' ? `Read also: ${refText(x.ref)}` : `Link: ${x.title || x.url}`}
                </span>
                <button type="button" className="btn small" onClick={() => setResources(resources.filter((_, j) => j !== i))} aria-label={`Remove resource ${i + 1}`}>
                  Remove
                </button>
              </div>
            ))}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <label className="sr-only" htmlFor="res-kind">
                Resource type
              </label>
              <select id="res-kind" value={newRes.kind} onChange={(e) => setNewRes({ ...newRes, kind: e.target.value as StudyResource['kind'] })}>
                <option value="commentary">Commentary note</option>
                <option value="passage">Related passage</option>
                <option value="link">Research link</option>
              </select>
              {newRes.kind === 'commentary' && (
                <>
                  <label className="sr-only" htmlFor="res-work">
                    Commentary
                  </label>
                  <select id="res-work" value={newRes.work} onChange={(e) => setNewRes({ ...newRes, work: e.target.value })}>
                    {(works.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {newRes.kind !== 'link' ? (
                <>
                  <label className="sr-only" htmlFor="res-ref">
                    Verse
                  </label>
                  <input id="res-ref" placeholder="e.g. Romans 8:28" value={newRes.ref} onChange={(e) => setNewRes({ ...newRes, ref: e.target.value })} />
                </>
              ) : (
                <>
                  <label className="sr-only" htmlFor="res-url">
                    Link address
                  </label>
                  <input id="res-url" placeholder="https://" value={newRes.url} onChange={(e) => setNewRes({ ...newRes, url: e.target.value })} />
                  <label className="sr-only" htmlFor="res-title">
                    Link title
                  </label>
                  <input id="res-title" placeholder="Title" value={newRes.title} onChange={(e) => setNewRes({ ...newRes, title: e.target.value })} />
                </>
              )}
              <button type="button" className="btn small" onClick={addRes}>
                Add resource
              </button>
            </div>
          </fieldset>
          <label className="row small">
            Due date (optional)
            <input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} />
          </label>
          <Alert>{act.error}</Alert>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={act.busy}>
              Save
            </button>
            {s.status !== 'assigned' && (
              <button className="btn primary" type="button" disabled={act.busy} data-testid="assign-study" onClick={() => void act.run(() => persist('assigned'), 'Assigned to the group.')}>
                Assign to the group
              </button>
            )}
            {s.status === 'assigned' && (
              <button className="btn" type="button" disabled={act.busy} onClick={() => void act.run(() => persist('closed'), 'Study closed. Responses are kept.')}>
                Close the study
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}

function Responses({ g, s }: { g: GroupCtx; s: GroupStudy }) {
  const data = useAsync(async () => {
    const [list, mem] = await Promise.all([responses(s.id), groupMembers(g.group.id)])
    const n = await names(g.orgId, [...list.map((r) => r.user_id), ...mem.map((m) => m.user_id)])
    return { list, mem: mem.filter((m) => m.status === 'active' && m.role === 'member'), n }
  }, [s.id])
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { list, mem, n } = data.data!
  const waiting = mem.filter((m) => !list.some((r) => r.user_id === m.user_id))
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        You see responses members have submitted. Drafts stay private to each member.
      </p>
      <p style={{ margin: 0 }}>
        {list.length} of {mem.length} submitted.{waiting.length ? ` Not yet: ${waiting.map((m) => n.get(m.user_id) ?? 'Member').join(', ')}.` : ''}
      </p>
      {!list.length ? <Empty>No responses yet.</Empty> : list.map((r) => <ResponseCard key={r.user_id} r={r} s={s} name={n.get(r.user_id) ?? 'Member'} onDone={data.reload} />)}
    </div>
  )
}

function ResponseCard({ r, s, name, onDone }: { r: GroupResponse; s: GroupStudy; name: string; onDone: () => void }) {
  const [note, setNote] = useState(r.leader_note)
  const act = useAction()
  return (
    <div className="card stack" data-testid="group-response-card">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong>{name}</strong>
        <span className="muted small">
          submitted {new Date(r.submitted_at!).toLocaleString()}
          {r.read_done ? ` · read ${refText(s.passage)}` : ''}
        </span>
      </div>
      {s.questions.map((q, i) =>
        r.answers[String(i)] ? (
          <div key={i} className="small">
            <em>{q}</em>
            <div className="prewrap">{r.answers[String(i)]}</div>
          </div>
        ) : null,
      )}
      {r.reflection && (
        <div className="small">
          <em>Reflection</em>
          <div className="prewrap">{r.reflection}</div>
        </div>
      )}
      <label className="stack small" style={{ gap: 4 }}>
        A note back to {name}
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Alert>{act.error}</Alert>
      <div>
        <button className="btn small" disabled={act.busy} onClick={() => void act.run(() => noteOnResponse(s.id, r.user_id, note), 'Note saved.').then(onDone)}>
          Save note
        </button>
      </div>
    </div>
  )
}

/* =============================== discussion =============================== */

function DiscussionPanel({ g }: { g: GroupCtx }) {
  const data = useAsync(async () => {
    const [ts, reps] = await Promise.all([topics(g.group.id), g.leader ? openReports({ group: g.group.id }) : Promise.resolve([])])
    return { ts, reps }
  }, [g.group.id])
  const [open, setOpen] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const act = useAction()
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { ts, reps } = data.data!
  return (
    <div className="stack">
      {!g.group.discussions && <div className="notice info small">Discussion is off for this group. Members do not see it. Turn it on in Group settings.</div>}
      <p className="muted small" style={{ margin: 0 }}>
        Posts are seen by this group only. Be kind and stay on the passage. Anyone can report a post; the leader reviews reports. There are no private messages.
      </p>
      {g.leader && reps.length > 0 && <ReportsQueue reps={reps} onDone={data.reload} />}
      {g.leader && (
        <form
          className="row"
          style={{ flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault()
            void act.run(async () => setOpen(await createTopic(g.group.id, title)), 'Topic started.').then((ok) => ok && (setTitle(''), data.reload()))
          }}
        >
          <label className="sr-only" htmlFor="topic-title">
            New topic
          </label>
          <input id="topic-title" required maxLength={200} placeholder="Start a topic, e.g. Romans 8:28" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn" type="submit" disabled={act.busy}>
            <MessageSquare size={16} aria-hidden /> Start topic
          </button>
        </form>
      )}
      <Alert>{act.error}</Alert>
      {!ts.length ? (
        <Empty>No topics yet.{g.leader ? '' : ' The leader starts topics.'}</Empty>
      ) : (
        <ul className="list" data-testid="topics">
          {ts.map((t) => (
            <li key={t.id} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn small" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                  {t.title}
                </button>
                {t.locked && (
                  <span className="muted small">
                    <Lock size={12} aria-hidden /> locked
                  </span>
                )}
                <span className="spacer" />
                {g.leader && (
                  <>
                    <button className="btn small" onClick={() => void act.run(() => moderate('topic', t.id, t.locked ? 'unlock' : 'lock')).then(data.reload)}>
                      {t.locked ? <Unlock size={14} aria-hidden /> : <Lock size={14} aria-hidden />} {t.locked ? 'Unlock' : 'Lock'}
                    </button>
                    <button className="btn small" onClick={() => confirm('Delete this topic and its posts?') && void act.run(() => moderate('topic', t.id, 'delete'), 'Topic deleted.').then(data.reload)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
              {open === t.id && <Thread g={g} t={t} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Thread({ g, t }: { g: GroupCtx; t: Topic }) {
  const data = useAsync(async () => {
    const list = await posts(t.id)
    return { list, n: await names(g.orgId, list.map((p) => p.author_id)) }
  }, [t.id])
  const [body, setBody] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const act = useAction()
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  const { list, n } = data.data!
  return (
    <div className="stack" style={{ paddingLeft: 12, borderLeft: '3px solid var(--border)' }} data-testid="thread">
      {!list.length && <span className="muted small">No posts yet.</span>}
      {list.map((p) => (
        <div key={p.id} className="stack" style={{ gap: 2 }} data-testid="post">
          <div className="row small" style={{ flexWrap: 'wrap' }}>
            <strong>{n.get(p.author_id) ?? 'Member'}</strong>
            <span className="muted">
              {new Date(p.created_at).toLocaleString()}
              {p.edited_at ? ' · edited' : ''}
              {p.hidden_at ? ' · hidden by the leader' : ''}
            </span>
            <span className="spacer" />
            {p.author_id === g.myId && !p.hidden_at && !t.locked && (
              <button className="btn small" onClick={() => setEditing({ id: p.id, body: p.body })}>
                Edit
              </button>
            )}
            {p.author_id !== g.myId && (
              <button className="btn small" onClick={() => setReporting(p.id)} aria-label={`Report post by ${n.get(p.author_id) ?? 'member'}`}>
                <Flag size={13} aria-hidden /> Report
              </button>
            )}
            {g.leader && (
              <button className="btn small" onClick={() => void act.run(() => moderate('post', p.id, p.hidden_at ? 'show' : 'hide')).then(data.reload)}>
                {p.hidden_at ? 'Show' : 'Hide'}
              </button>
            )}
          </div>
          {editing?.id === p.id ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                void act.run(() => editPost(p.id, editing.body)).then((ok) => ok && (setEditing(null), data.reload()))
              }}
            >
              <label className="sr-only" htmlFor={`edit-${p.id}`}>
                Edit your post
              </label>
              <textarea id={`edit-${p.id}`} rows={3} maxLength={5000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <div className="row">
                <button className="btn small primary" type="submit">
                  Save
                </button>
                <button className="btn small" type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="prewrap" style={{ opacity: p.hidden_at ? 0.6 : 1 }}>
              <LinkedText text={p.body} />
            </div>
          )}
        </div>
      ))}
      <Alert>{act.error}</Alert>
      {!t.locked ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void act.run(() => addPost(t.id, body)).then((ok) => ok && (setBody(''), data.reload()))
          }}
        >
          <label className="sr-only" htmlFor={`reply-${t.id}`}>
            Your post
          </label>
          <textarea id={`reply-${t.id}`} rows={2} maxLength={5000} required placeholder="Add to the discussion" value={body} onChange={(e) => setBody(e.target.value)} />
          <div>
            <button className="btn small primary" type="submit" disabled={act.busy || !body.trim()}>
              Post
            </button>
          </div>
        </form>
      ) : (
        <span className="muted small">This topic is locked.</span>
      )}
      {reporting && <ReportDialog kind="post" id={reporting} onClose={() => setReporting(null)} />}
    </div>
  )
}

export function ReportDialog({ kind, id, onClose }: { kind: 'post' | 'resource'; id: string; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const act = useAction()
  return (
    <Dialog open onClose={onClose} title="Report this">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void act.run(() => report(kind, id, reason), 'Reported. A leader will review it.').then((ok) => ok && onClose())
        }}
      >
        <p style={{ margin: 0 }}>Tell the leaders what is wrong. They see your report; the person you report does not.</p>
        <label className="stack" style={{ gap: 4 }}>
          <strong>Reason</strong>
          <textarea required rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Send report
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function ReportsQueue({ reps, onDone }: { reps: { id: string; reason: string; created_at: string; target_kind: string }[]; onDone: () => void }) {
  const act = useAction()
  return (
    <section className="card stack" data-testid="reports-queue">
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>
        <Flag size={16} aria-hidden /> Reports to review ({reps.length})
      </h2>
      {reps.map((r) => (
        <div key={r.id} className="row small" style={{ flexWrap: 'wrap' }}>
          <span>
            {new Date(r.created_at).toLocaleString()}: {r.reason}
          </span>
          <span className="spacer" />
          <button className="btn small primary" onClick={() => void act.run(() => resolveReport(r.id, 'hidden'), 'Post hidden.').then(onDone)}>
            Hide the post
          </button>
          <button className="btn small" onClick={() => void act.run(() => resolveReport(r.id, 'no_action'), 'Report closed.').then(onDone)}>
            No action
          </button>
        </div>
      ))}
      <Alert>{act.error}</Alert>
    </section>
  )
}

