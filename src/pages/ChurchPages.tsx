/**
 * Church and ministry workspaces (Release 6.2): create, join by invitation, switch between workspaces, members,
 * roles, invitations, settings, ownership transfer, and the activity log.
 * Loaded only when a workspace page is opened. Personal notes, sermons and studies are never read here.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Church, Copy, Crown, Mail, Plus, RefreshCw, Trash2, UserMinus, Users } from 'lucide-react'
import { Dialog, Empty, ErrorBox, Loading, Tabs, downloadBlob, slug, toast, useAsync } from '../components/ui'
import { cloudConfigured } from '../lib/cloud/config'
import { cloud, onCloudState, type CloudState } from '../lib/cloud/manager'
import {
  KIND_LABEL,
  ROLE_HELP,
  ROLE_LABEL,
  acceptInvite,
  acceptOwnership,
  assignableRoles,
  auditLog,
  cancelOwnership,
  clearPendingInvite,
  createOrg,
  currentOrgId,
  deleteOrg,
  inviteStatus,
  invitations,
  leaveOrg,
  logoFromFile,
  members,
  myDeletedOrgs,
  myMemberships,
  myOwnershipOffers,
  offerOwnership,
  openTransfer,
  pendingInvite,
  previewInvite,
  rank,
  removeMember,
  restoreOrg,
  revokeInvite,
  savePendingInvite,
  sendInvite,
  setCurrentOrgId,
  setMySettings,
  setRole,
  updateOrg,
  type Invitation,
  type InviteResult,
  type Member,
  type Membership,
  type Org,
  type OrgKind,
  type Role,
} from '../lib/cloud/orgs'

import { CoursesTab } from './ChurchCourses'
import { GroupsTab } from './ChurchGroups'
import { AnnouncementsTab, SharedTab } from './ChurchShare'
import { ReportsTab } from './ChurchReports'
import { unreadCount } from '../lib/cloud/orgShare'

/* ---------------- shared bits ---------------- */

function useSession(): CloudState | null {
  const [s, setS] = useState<CloudState | null>(null)
  useEffect(() => {
    if (!cloudConfigured()) return
    cloud()
    return onCloudState(setS)
  }, [])
  return s
}

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')

/** Runs an action, shows its error inline, and reports success with a toast. */
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

function Alert({ children }: { children: ReactNode }) {
  return children ? (
    <div className="notice error" role="alert">
      {children}
    </div>
  ) : null
}

export function OrgLogo({ org, size = 40 }: { org: Pick<Org, 'name' | 'logo'>; size?: number }) {
  return org.logo ? (
    <img src={org.logo} alt="" width={size} height={size} style={{ borderRadius: 8, objectFit: 'contain', background: 'var(--surface-2)' }} />
  ) : (
    <span aria-hidden className="brand-mark" style={{ width: size, height: size, fontSize: size * 0.45, display: 'inline-grid', placeItems: 'center', borderRadius: 8 }}>
      {org.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Gate({ children }: { children: (s: CloudState) => ReactNode }) {
  const s = useSession()
  if (!cloudConfigured())
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Church workspaces</h1>
        <p>Accounts are not switched on for this site, so church workspaces are not available here.</p>
      </div>
    )
  if (!s) return <Loading />
  if (!s.session)
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Church workspaces</h1>
        <p>Sign in to see the churches and ministries you belong to. Your personal Bible study works the same with or without an account.</p>
        <p>
          <Link className="btn primary" to="/account">
            Sign in or create an account
          </Link>
        </p>
      </div>
    )
  if (s.needsCode)
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Church workspaces</h1>
        <p>
          Finish two-step sign-in on the <Link to="/account">Account page</Link> first.
        </p>
      </div>
    )
  return <>{children(s)}</>
}

const ADULT_TEXT = 'I am 18 or older. (Church workspaces are for adults in this release. Teens can keep using their personal account.)'

/* ---------------- /church: my workspaces ---------------- */

export function ChurchHome() {
  useEffect(() => {
    document.title = 'Church workspaces · Arise Bible Study'
  }, [])
  return <Gate>{() => <ChurchHomeInner />}</Gate>
}

function ChurchHomeInner() {
  const nav = useNavigate()
  const list = useAsync(() => myMemberships(), [])
  const offers = useAsync(() => myOwnershipOffers(), [])
  const deleted = useAsync(() => myDeletedOrgs(), [])
  const [creating, setCreating] = useState(false)
  const invite = pendingInvite()
  const act = useAction()
  return (
    <div className="page stack" style={{ maxWidth: 860 }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Church workspaces</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)} data-testid="create-org">
          <Plus size={16} aria-hidden /> Create a workspace
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Workspaces let a church or ministry teach courses, run group Bible studies, and share teaching resources. Your personal notes, highlights, sermons, and studies stay
        private. A workspace sees only what you choose to submit or share.
      </p>
      {invite && (
        <div className="notice info row" style={{ flexWrap: 'wrap' }}>
          <span>You have an invitation waiting.</span>
          <Link className="btn primary" to="/church/join">
            Review the invitation
          </Link>
        </div>
      )}
      {(offers.data ?? []).map((o) => (
        <div key={o.id} className="card stack" data-testid="ownership-offer">
          <strong>
            <Crown size={16} aria-hidden /> {o.from_name} offered you ownership of {o.org_name}
          </strong>
          <span className="muted small">The current owner becomes an administrator. The offer ends {new Date(o.expires_at).toLocaleDateString()}.</span>
          <Alert>{act.error}</Alert>
          <div className="row">
            <button className="btn primary" disabled={act.busy} onClick={() => act.run(() => acceptOwnership(o.id), `You now own ${o.org_name}.`).then((ok) => ok && (offers.reload(), list.reload()))}>
              Accept ownership
            </button>
            <button className="btn" disabled={act.busy} onClick={() => act.run(() => cancelOwnership(o.id), 'Offer declined.').then(() => offers.reload())}>
              Decline
            </button>
          </div>
        </div>
      ))}
      {list.loading ? (
        <Loading label="Loading your workspaces" />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <Empty>
          You do not belong to a workspace yet. Ask your church for an invitation, or create a workspace for your church or ministry.
        </Empty>
      ) : (
        <ul className="list" aria-label="Your workspaces" data-testid="org-list">
          {list.data.map((m) => (
            <li key={m.org.id}>
              <Link to={`/church/${m.org.id}`} className="row" style={{ gap: 12, textDecoration: 'none', color: 'inherit', padding: '8px 0' }} onClick={() => setCurrentOrgId(m.org.id)}>
                <OrgLogo org={m.org} />
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{m.org.name}</strong>
                  <span className="muted small">
                    {KIND_LABEL[m.org.kind]}
                    {m.org.city ? ` · ${m.org.city}${m.org.state ? `, ${m.org.state}` : ''}` : ''} · You: {ROLE_LABEL[m.role]}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {!!deleted.data?.length && (
        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Recently deleted</h2>
          {deleted.data.map((d) => (
            <div key={d.id} className="row" style={{ flexWrap: 'wrap' }}>
              <span>
                {d.name} <span className="muted small">(removed for good on {new Date(d.purge_after).toLocaleDateString()})</span>
              </span>
              <button className="btn" onClick={() => act.run(() => restoreOrg(d.id), `${d.name} is back.`).then(() => (deleted.reload(), list.reload()))}>
                Restore
              </button>
            </div>
          ))}
        </section>
      )}
      <CreateOrgDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false)
          nav(`/church/${id}`)
        }}
      />
    </div>
  )
}

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu']
const guessZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'
  } catch {
    return 'America/Chicago'
  }
}

function CreateOrgDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: '', kind: 'church' as OrgKind, description: '', city: '', state: '', website: '', contact_email: '', time_zone: guessZone(), display_name: '', adult: false })
  const act = useAction()
  useEffect(() => {
    if (open) void cloud().auth.getSession().then(({ data }) => setF((x) => ({ ...x, contact_email: x.contact_email || data.session?.user.email || '' })))
  }, [open])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
  return (
    <Dialog open={open} onClose={onClose} title="Create a workspace">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (f.website && !/^https:\/\//.test(f.website)) return act.setError('The website must start with https://')
          let id = ''
          void act.run(async () => (id = await createOrg(f)), 'Workspace created.').then((ok) => ok && onCreated(id))
        }}
      >
        <Field label="Workspace name" required>
          <input required minLength={2} maxLength={120} value={f.name} onChange={set('name')} placeholder="e.g. Arise Church" />
        </Field>
        <Field label="Type">
          <select value={f.kind} onChange={set('kind')}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea rows={3} maxLength={2000} value={f.description} onChange={set('description')} />
        </Field>
        <div className="grid-2">
          <Field label="City (optional)">
            <input maxLength={80} value={f.city} onChange={set('city')} />
          </Field>
          <Field label="State (optional)">
            <input maxLength={40} value={f.state} onChange={set('state')} />
          </Field>
        </div>
        <Field label="Website (optional)">
          <input type="url" maxLength={200} value={f.website} onChange={set('website')} placeholder="https://" />
        </Field>
        <Field label="Contact email" required>
          <input type="email" required maxLength={254} value={f.contact_email} onChange={set('contact_email')} />
        </Field>
        <Field label="Time zone">
          <select value={f.time_zone} onChange={set('time_zone')}>
            {[...new Set([f.time_zone, ...ZONES])].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <Field label="Your name as members will see it" required>
          <input required maxLength={80} value={f.display_name} onChange={set('display_name')} placeholder="e.g. Pastor J. Davon Carter" />
        </Field>
        <label className="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={f.adult} onChange={set('adult')} required /> <span>{ADULT_TEXT}</span>
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          You will be the owner. You can add a logo and invite people next.
        </p>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Create workspace
          </button>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Field({ label, required, children, help }: { label: string; required?: boolean; children: ReactNode; help?: string }) {
  return (
    <label className="stack" style={{ gap: 4 }}>
      <strong>
        {label}
        {required && <span className="sr-only"> (required)</span>}
      </strong>
      {children}
      {help && <span className="muted small">{help}</span>}
    </label>
  )
}

/* ---------------- /church/join ---------------- */

export function JoinPage() {
  useEffect(() => {
    document.title = 'Invitation · Arise Bible Study'
    const m = location.hash.match(/token=([0-9a-f]{64})/)
    if (m) {
      savePendingInvite(m[1])
      history.replaceState(null, '', location.pathname) // keep the token out of history and screenshots
    }
  }, [])
  const s = useSession()
  const token = pendingInvite() ?? location.hash.match(/token=([0-9a-f]{64})/)?.[1]
  if (!cloudConfigured()) return <Gate>{() => null}</Gate>
  if (!token)
    return (
      <div className="page stack" style={{ maxWidth: 640 }}>
        <h1>Invitation</h1>
        <p>This invitation link is incomplete. Open the link from your email again, or ask for a new invitation.</p>
      </div>
    )
  if (!s) return <Loading />
  if (!s.session)
    return (
      <div className="page stack" style={{ maxWidth: 640 }} data-testid="join-signed-out">
        <h1>You are invited</h1>
        <p>
          Sign in, or create a free account, <strong>with the email address the invitation was sent to</strong>. Then come back here (or open Church from the top bar) to review
          and accept. Your invitation is remembered on this device.
        </p>
        <p>
          <Link className="btn primary" to="/account">
            Sign in or create an account
          </Link>
        </p>
      </div>
    )
  if (s.needsCode) return <Gate>{() => null}</Gate>
  return <JoinInner token={token} />
}

function JoinInner({ token }: { token: string }) {
  const nav = useNavigate()
  const p = useAsync(() => previewInvite(token), [token])
  const [name, setName] = useState('')
  const [adult, setAdult] = useState(false)
  const act = useAction()
  if (p.loading) return <Loading label="Checking the invitation" />
  if (p.error) return <div className="page"><ErrorBox error={p.error} onRetry={p.reload} /></div>
  const v = p.data!
  const reason: Record<string, string> = {
    invalid: 'This invitation link is not valid. Ask for a new invitation.',
    wrong_account: 'This invitation was sent to a different email address. Sign out, then sign in with the address the invitation was sent to.',
    used: 'This invitation has already been used.',
    revoked: 'This invitation was withdrawn. Ask for a new one if you still need it.',
    expired: 'This invitation has expired. Ask the person who invited you to send a new one.',
  }
  return (
    <div className="page stack" style={{ maxWidth: 640 }} data-testid="join-page">
      <h1>Invitation</h1>
      {v.status !== 'ok' ? (
        <>
          <div className="notice error" role="alert" data-testid="join-status" data-status={v.status}>
            {reason[v.status]}
          </div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                clearPendingInvite()
                nav('/church')
              }}
            >
              Dismiss
            </button>
            {v.status === 'wrong_account' && (
              <Link className="btn" to="/account">
                Go to Account
              </Link>
            )}
          </div>
        </>
      ) : (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault()
            let id = ''
            void act.run(async () => (id = await acceptInvite(token, name, adult)), `Welcome to ${v.org!.name}.`).then((ok) => ok && nav(`/church/${id}`))
          }}
        >
          <div className="row" style={{ gap: 12 }}>
            <OrgLogo org={{ name: v.org!.name, logo: v.org!.logo }} size={48} />
            <div className="stack" style={{ gap: 2 }}>
              <strong style={{ fontSize: '1.2rem' }}>{v.org!.name}</strong>
              <span className="muted small">
                {KIND_LABEL[v.org!.kind]}
                {v.org!.city ? ` · ${v.org!.city}${v.org!.state ? `, ${v.org!.state}` : ''}` : ''}
              </span>
            </div>
          </div>
          {v.org!.description && <p style={{ margin: 0 }}>{v.org!.description}</p>}
          <p style={{ margin: 0 }}>
            {v.invited_by ? `${v.invited_by} invited you` : 'You are invited'} to join as <strong>{ROLE_LABEL[v.role!]}</strong>. {ROLE_HELP[v.role!]}
          </p>
          {!!(v.groups?.length || v.courses?.length) && (
            <p style={{ margin: 0 }}>
              You will also join {[...(v.groups ?? []).map((g) => `the group "${g}"`), ...(v.courses ?? []).map((c) => `the course "${c}"`)].join(' and ')}.
            </p>
          )}
          {v.already_member && <p className="muted" style={{ margin: 0 }}>You are already a member. Accepting adds what this invitation offers.</p>}
          <div className="notice info small" style={{ margin: 0 }}>
            What the workspace can see: your name as you enter it below, your role, and what you submit or share there (assignments, answers, posts). It cannot see your
            personal notes, highlights, bookmarks, sermons, studies, or AI conversations.
          </div>
          <Field label="Your name as members will see it" required>
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="row" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required /> <span>{ADULT_TEXT}</span>
          </label>
          <Alert>{act.error}</Alert>
          <div className="row">
            <button className="btn primary" type="submit" disabled={act.busy} data-testid="accept-invite">
              Accept and join
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                clearPendingInvite()
                nav('/church')
              }}
            >
              Not now
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

/* ---------------- /church/:orgId ---------------- */

export interface OrgCtx {
  org: Org
  me: Membership
  myId: string
  reload: () => void
  all: Membership[]
}

export function OrgPage() {
  return <Gate>{() => <OrgPageInner />}</Gate>
}

function OrgPageInner() {
  const { orgId = '' } = useParams()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const data = useAsync(async () => {
    const [all, s] = await Promise.all([myMemberships(), cloud().auth.getSession()])
    return { all, myId: s.data.session?.user.id ?? '' }
  }, [orgId])
  useEffect(() => {
    if (orgId) setCurrentOrgId(orgId)
  }, [orgId])
  const mine = data.data?.all.find((m) => m.org.id === orgId)
  // the "new announcements" count, unless the member turned the badge off (My membership)
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    if (!mine || mine.notify?.announcements === false) return setUnread(0)
    let alive = true
    const load = () => void unreadCount(orgId).then((n) => alive && setUnread(n), () => {})
    load()
    window.addEventListener('abs-announcements-read', load)
    return () => {
      alive = false
      window.removeEventListener('abs-announcements-read', load)
    }
  }, [mine, orgId])
  useEffect(() => {
    if (mine) document.title = `${mine.org.name} · Arise Bible Study`
  }, [mine])
  if (data.loading && !data.data) return <Loading label="Loading the workspace" />
  if (data.error) return <div className="page"><ErrorBox error={data.error} onRetry={data.reload} /></div>
  if (!mine)
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Workspace not available</h1>
        <p>You are not a member of this workspace, or it was deleted.</p>
        <p>
          <Link to="/church">Your workspaces</Link>
        </p>
      </div>
    )
  const ctx: OrgCtx = { org: mine.org, me: mine, myId: data.data!.myId, reload: data.reload, all: data.data!.all }
  const tabs = ORG_TABS.filter((t) => rank(mine.role) >= t.min)
  const tab = tabs.find((t) => t.id === params.get('tab')) ?? tabs[0]
  const label = (t: (typeof tabs)[number]) => (t.id === 'announcements' && unread ? `Announcements (${unread} new)` : t.label)
  return (
    <div className="page stack" style={{ maxWidth: 1000 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <OrgLogo org={mine.org} size={48} />
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{mine.org.name}</h1>
          <span className="muted small">
            {KIND_LABEL[mine.org.kind]} · You: {ROLE_LABEL[mine.role]}
          </span>
        </div>
        <span className="spacer" />
        {data.data!.all.length > 1 && (
          <label className="row small" style={{ gap: 6 }}>
            <span>Workspace</span>
            <select
              value={orgId}
              onChange={(e) => {
                setCurrentOrgId(e.target.value)
                nav(`/church/${e.target.value}`)
              }}
              data-testid="org-switcher"
            >
              {data.data!.all.map((m) => (
                <option key={m.org.id} value={m.org.id}>
                  {m.org.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <Tabs tabs={tabs.map((t) => ({ id: t.id, label: label(t) }))} value={tab.id} onChange={(id) => setParams({ tab: id })} label="Workspace sections" />
      <div role="tabpanel" aria-label={tab.label}>
        <tab.View ctx={ctx} />
      </div>
    </div>
  )
}

/* ---------------- overview ---------------- */

export function OverviewTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const leaders = useAsync(() => members(org.id), [org.id])
  const visible = leaders.data?.rows ?? []
  return (
    <div className="stack">
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>About</h2>
        {org.description ? <p style={{ margin: 0 }} className="prewrap">{org.description}</p> : <p className="muted" style={{ margin: 0 }}>No description yet.</p>}
        <dl className="kv">
          {org.city && (
            <>
              <dt>Location</dt>
              <dd>
                {org.city}
                {org.state ? `, ${org.state}` : ''}
              </dd>
            </>
          )}
          {org.website && (
            <>
              <dt>Website</dt>
              <dd>
                <a href={org.website} target="_blank" rel="noopener noreferrer">
                  {org.website.replace(/^https:\/\//, '')}
                </a>
              </dd>
            </>
          )}
          <dt>Contact</dt>
          <dd>
            <a href={`mailto:${org.contact_email}`}>{org.contact_email}</a>
          </dd>
          <dt>Time zone</dt>
          <dd>{org.time_zone}</dd>
        </dl>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Your role: {ROLE_LABEL[me.role]}</h2>
        <p style={{ margin: 0 }}>{ROLE_HELP[me.role]}</p>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
          <Users size={18} aria-hidden /> {rank(me.role) >= 5 ? 'Members' : 'Leaders and people you study with'}
        </h2>
        {leaders.loading ? (
          <Loading />
        ) : (
          <p style={{ margin: 0 }}>
            {visible.length}
            {leaders.data?.more ? '+' : ''} {visible.length === 1 ? 'person' : 'people'}
            {rank(me.role) < 5 && <span className="muted small"> (you see leaders and the people in your groups and courses)</span>}
          </p>
        )}
      </section>
    </div>
  )
}

/* ---------------- members ---------------- */

export function MembersTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me, myId } = ctx
  const isAdmin = rank(me.role) >= 5
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
  const list = useAsync(() => members(org.id, { page, search: q, withEmail: isAdmin, includeRemoved: showRemoved }), [org.id, page, q, showRemoved])
  const act = useAction()
  const [removing, setRemoving] = useState<Member | null>(null)
  const roles = assignableRoles(me.role)
  return (
    <div className="stack">
      <form
        className="row"
        style={{ flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          setPage(0)
          setQ(search)
        }}
        role="search"
      >
        <label className="sr-only" htmlFor="member-search">
          Search members by name
        </label>
        <input id="member-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" />
        <button className="btn" type="submit">
          Search
        </button>
        {isAdmin && (
          <label className="row small">
            <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show former members
          </label>
        )}
      </form>
      {!isAdmin && <p className="muted small" style={{ margin: 0 }}>You see leaders and the people in your groups and courses.</p>}
      <Alert>{act.error}</Alert>
      {list.loading ? (
        <Loading label="Loading members" />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.data!.rows.length ? (
        <Empty>No one matches.</Empty>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" data-testid="members-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                {isAdmin && <th scope="col">Email</th>}
                <th scope="col">Role</th>
                {isAdmin && <th scope="col">Joined</th>}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data!.rows.map((m) => {
                const canManage = isAdmin && m.user_id !== myId && rank(m.role) < rank(me.role) && !m.removed_at
                return (
                  <tr key={m.user_id}>
                    <td>
                      {m.display_name}
                      {m.user_id === myId && <span className="muted small"> (you)</span>}
                      {m.removed_at && <span className="muted small"> (former member)</span>}
                    </td>
                    {isAdmin && <td className="small">{m.email ?? ''}</td>}
                    <td>
                      {canManage ? (
                        <select
                          aria-label={`Role for ${m.display_name}`}
                          value={m.role}
                          disabled={act.busy}
                          onChange={(e) => {
                            const r = e.target.value as Role
                            void act.run(() => setRole(org.id, m.user_id, r), `${m.display_name} is now ${ROLE_LABEL[r]}.`).then(() => list.reload())
                          }}
                        >
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_LABEL[m.role]
                      )}
                    </td>
                    {isAdmin && <td className="small">{new Date(m.joined_at).toLocaleDateString()}</td>}
                    <td>
                      {canManage && (
                        <button className="btn small" onClick={() => setRemoving(m)} aria-label={`Remove ${m.display_name}`}>
                          <UserMinus size={15} aria-hidden /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="row">
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span className="small muted">Page {page + 1}</span>
        <button className="btn" disabled={!list.data?.more} onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove member">
        {removing && (
          <div className="stack">
            <p style={{ margin: 0 }}>
              Remove <strong>{removing.display_name}</strong> from {org.name}? Their access ends right away. Their personal notes and studies are not affected. The workspace keeps its
              records of their course work and attendance, marked as a former member.
            </p>
            <div className="row">
              <button
                className="btn primary"
                disabled={act.busy}
                onClick={() =>
                  void act.run(() => removeMember(org.id, removing.user_id), `${removing.display_name} was removed.`).then(() => {
                    setRemoving(null)
                    list.reload()
                  })
                }
              >
                Remove
              </button>
              <button className="btn" onClick={() => setRemoving(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}

/* ---------------- invitations ---------------- */

export function InvitationsTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const isAdmin = rank(me.role) >= 5
  const roles = assignableRoles(me.role)
  const list = useAsync(() => invitations(org.id), [org.id])
  const [email, setEmail] = useState('')
  const [role, setRoleV] = useState<Role>('member')
  const [days, setDays] = useState(7)
  const [extra, setExtra] = useState<{ groups: string[]; courses: string[] }>({ groups: [], courses: [] })
  const [last, setLast] = useState<(InviteResult & { email: string }) | null>(null)
  const act = useAction()
  const send = async (fn: () => Promise<InviteResult>, to: string) => {
    let r: InviteResult | undefined
    const ok = await act.run(async () => (r = await fn()))
    if (ok && r) {
      setLast({ ...r, email: to })
      toast(r.emailed ? `Invitation emailed to ${to}.` : 'Invitation ready. Copy the link and send it.')
      list.reload()
    }
    return ok
  }
  return (
    <div className="stack">
      <form
        className="card stack"
        data-testid="invite-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send(() => sendInvite({ org: org.id, email, role, days, group_ids: extra.groups, course_ids: extra.courses }), email.trim()).then((ok) => ok && setEmail(''))
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
          <Mail size={18} aria-hidden /> Invite someone
        </h2>
        <div className="grid-2">
          <Field label="Email address" required>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role" help={ROLE_HELP[role]}>
            <select value={role} onChange={(e) => setRoleV(e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <InviteTargets org={org} me={me} value={extra} onChange={setExtra} />
        <Field label="Link works for">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </Field>
        {!isAdmin && <p className="muted small" style={{ margin: 0 }}>As a leader, you can invite people as members of a group you lead or a course you teach.</p>}
        <p className="muted small" style={{ margin: 0 }}>
          The link works once, only for this email address. They will sign in or create a free account with it, review the invitation, and accept it themselves.
        </p>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy || !roles.length}>
            Send invitation
          </button>
        </div>
      </form>
      {last && (
        <div className={`notice ${last.emailed ? 'ok' : 'info'} stack`} role="status" data-testid="invite-result">
          <span>{last.emailed ? `Emailed to ${last.email}. You can also copy the link:` : (last.email_error ?? `Email is not set up here yet. Copy the link and send it to ${last.email}:`)}</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input readOnly value={last.link} aria-label="Invitation link" style={{ flex: 1, minWidth: 200 }} data-testid="invite-link" onFocus={(e) => e.target.select()} />
            <button
              className="btn"
              type="button"
              onClick={() => navigator.clipboard?.writeText(last.link).then(() => toast('Link copied.'), () => toast('Select the link and copy it.'))}
            >
              <Copy size={15} aria-hidden /> Copy link
            </button>
          </div>
          <span className="small muted">Only the person with this email address can use it. Anyone else who opens it sees nothing about {org.name}.</span>
        </div>
      )}
      <section className="stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{isAdmin ? 'All invitations' : 'Invitations you sent'}</h2>
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : !list.data!.length ? (
          <Empty>No invitations yet.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table" data-testid="invites-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data!.map((i) => (
                  <InviteRow key={i.id} i={i} onResend={() => send(() => sendInvite({ resend: i.id, days }), i.email)} onRevoke={() => act.run(() => revokeInvite(i.id), 'Invitation withdrawn.').then(() => list.reload())} busy={act.busy} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const STATUS_LABEL = { pending: 'Waiting', accepted: 'Accepted', revoked: 'Withdrawn', expired: 'Expired' }

function InviteRow({ i, onResend, onRevoke, busy }: { i: Invitation; onResend: () => void; onRevoke: () => void; busy: boolean }) {
  const st = inviteStatus(i)
  return (
    <tr data-status={st}>
      <td>{i.email}</td>
      <td>{ROLE_LABEL[i.role]}</td>
      <td>
        {STATUS_LABEL[st]}
        {st === 'pending' && <span className="muted small"> until {new Date(i.expires_at).toLocaleDateString()}</span>}
        {i.sent_count > 1 && <span className="muted small"> (sent {i.sent_count} times)</span>}
      </td>
      <td className="row" style={{ gap: 6 }}>
        {st !== 'accepted' && (
          <button className="btn small" disabled={busy} onClick={onResend}>
            <RefreshCw size={14} aria-hidden /> {st === 'pending' ? 'Send again' : 'Send a new link'}
          </button>
        )}
        {st === 'pending' && (
          <button className="btn small" disabled={busy} onClick={onRevoke}>
            Withdraw
          </button>
        )}
      </td>
    </tr>
  )
}

/** Groups and courses an invitation can also add the person to (filled in by later stages when they exist). */
function InviteTargets({ org, me, value, onChange }: { org: Org; me: Membership; value: { groups: string[]; courses: string[] }; onChange: (v: { groups: string[]; courses: string[] }) => void }) {
  const opts = useAsync(async () => {
    const isAdmin = rank(me.role) >= 5
    const uid = (await cloud().auth.getSession()).data.session?.user.id
    const [g, gm, c, ci] = await Promise.all([
      cloud().from('org_groups').select('id, name').eq('org_id', org.id).is('archived_at', null),
      cloud().from('org_group_members').select('group_id').eq('org_id', org.id).eq('user_id', uid ?? '').eq('role', 'leader').eq('status', 'active'),
      cloud().from('org_courses').select('id, title, status').eq('org_id', org.id).neq('status', 'archived'),
      cloud().from('org_course_instructors').select('course_id').eq('org_id', org.id).eq('user_id', uid ?? ''),
    ])
    const leads = new Set((gm.data ?? []).map((r) => r.group_id as string))
    const teaches = new Set((ci.data ?? []).map((r) => r.course_id as string))
    return {
      groups: ((g.data ?? []) as { id: string; name: string }[]).filter((x) => isAdmin || leads.has(x.id)),
      courses: ((c.data ?? []) as { id: string; title: string; status: string }[]).filter((x) => x.status === 'published' && (isAdmin || teaches.has(x.id))),
    }
  }, [org.id, me.role])
  const toggle = (k: 'groups' | 'courses', id: string) => onChange({ ...value, [k]: value[k].includes(id) ? value[k].filter((x) => x !== id) : [...value[k], id] })
  if (!opts.data || (!opts.data.groups.length && !opts.data.courses.length)) return null
  return (
    <fieldset className="stack" style={{ gap: 6 }}>
      <legend>
        <strong>Also add them to (optional)</strong>
      </legend>
      {opts.data.groups.map((g) => (
        <label key={g.id} className="row small">
          <input type="checkbox" checked={value.groups.includes(g.id)} onChange={() => toggle('groups', g.id)} /> Group: {g.name}
        </label>
      ))}
      {opts.data.courses.map((c) => (
        <label key={c.id} className="row small">
          <input type="checkbox" checked={value.courses.includes(c.id)} onChange={() => toggle('courses', c.id)} /> Course: {c.title}
        </label>
      ))}
    </fieldset>
  )
}

/* ---------------- settings (owner and administrators) ---------------- */

export function SettingsTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me, myId } = ctx
  const nav = useNavigate()
  const [f, setF] = useState({ name: org.name, kind: org.kind, description: org.description, city: org.city, state: org.state, website: org.website, contact_email: org.contact_email, time_zone: org.time_zone, require_course_review: org.require_course_review })
  const [logo, setLogo] = useState(org.logo)
  const act = useAction()
  const isOwner = me.role === 'owner'
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value })
  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (f.website && !/^https:\/\//.test(f.website)) return act.setError('The website must start with https://')
          void act.run(() => updateOrg(org.id, f), 'Settings saved.').then((ok) => ok && ctx.reload())
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Workspace details</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <OrgLogo org={{ name: f.name, logo }} size={64} />
          <label className="btn">
            Choose a logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                void act.run(async () => {
                  const d = await logoFromFile(file)
                  await updateOrg(org.id, { logo: d })
                  setLogo(d)
                }, 'Logo saved.').then((ok) => ok && ctx.reload())
              }}
            />
          </label>
          {logo && (
            <button type="button" className="btn" onClick={() => void act.run(async () => (await updateOrg(org.id, { logo: '' as unknown as null }), setLogo(null)), 'Logo removed.').then(() => ctx.reload())}>
              Remove logo
            </button>
          )}
        </div>
        <Field label="Workspace name" required>
          <input required minLength={2} maxLength={120} value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Type">
          <select value={f.kind} onChange={set('kind')}>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea rows={3} maxLength={2000} value={f.description} onChange={set('description')} />
        </Field>
        <div className="grid-2">
          <Field label="City">
            <input maxLength={80} value={f.city} onChange={set('city')} />
          </Field>
          <Field label="State">
            <input maxLength={40} value={f.state} onChange={set('state')} />
          </Field>
        </div>
        <Field label="Website">
          <input type="url" maxLength={200} value={f.website} onChange={set('website')} placeholder="https://" />
        </Field>
        <Field label="Contact email" required>
          <input type="email" required value={f.contact_email} onChange={set('contact_email')} />
        </Field>
        <Field label="Time zone">
          <select value={f.time_zone} onChange={set('time_zone')}>
            {[...new Set([f.time_zone, ...ZONES])].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <label className="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={f.require_course_review} onChange={set('require_course_review')} />{' '}
          <span>Courses need an administrator's review before they are published (pastors and teachers submit them for review).</span>
        </label>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Save settings
          </button>
        </div>
      </form>
      {isOwner && <TransferOwnership org={org} myId={myId} onDone={ctx.reload} />}
      {isOwner && <DeleteWorkspace org={org} onDone={() => nav('/church')} />}
    </div>
  )
}

function TransferOwnership({ org, myId, onDone }: { org: Org; myId: string; onDone: () => void }) {
  const admins = useAsync(async () => (await members(org.id, { page: 0 })).rows.filter((m) => m.role === 'admin' && m.user_id !== myId), [org.id])
  const open = useAsync(() => openTransfer(org.id), [org.id])
  const [to, setTo] = useState('')
  const act = useAction()
  const name = (id: string) => admins.data?.find((a) => a.user_id === id)?.display_name ?? 'an administrator'
  return (
    <section className="card stack" data-testid="transfer-ownership">
      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
        <Crown size={18} aria-hidden /> Transfer ownership
      </h2>
      <p style={{ margin: 0 }}>
        Offer ownership to an administrator. Nothing changes until they accept. Then they become the owner and you become an administrator.
      </p>
      {open.data ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span>
            Offered to {name(open.data.to_user)}, open until {new Date(open.data.expires_at).toLocaleDateString()}.
          </span>
          <button className="btn" onClick={() => void act.run(() => cancelOwnership(open.data!.id), 'Offer withdrawn.').then(() => open.reload())}>
            Withdraw the offer
          </button>
        </div>
      ) : !admins.data?.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          Make someone an administrator first (Members).
        </p>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="transfer-to">
            New owner
          </label>
          <select id="transfer-to" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose an administrator</option>
            {admins.data.map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.display_name}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!to || act.busy} onClick={() => void act.run(() => offerOwnership(org.id, to), 'Offer sent. They will see it on their Church page.').then(() => (open.reload(), onDone()))}>
            Offer ownership
          </button>
        </div>
      )}
      <Alert>{act.error}</Alert>
    </section>
  )
}

function DeleteWorkspace({ org, onDone }: { org: Org; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const act = useAction()
  return (
    <section className="card stack">
      <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
        <Trash2 size={18} aria-hidden /> Delete this workspace
      </h2>
      <p style={{ margin: 0 }}>
        Everyone loses access right away. The workspace's courses, groups, and records are kept for 30 days in case this was a mistake, then removed for good. Members' personal
        notes and studies are not affected.
      </p>
      <div>
        <button className="btn" onClick={() => setOpen(true)}>
          Delete workspace
        </button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Delete workspace">
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void act.run(() => deleteOrg(org.id, name), `${org.name} was deleted. You can restore it for 30 days from the Church page.`).then((ok) => ok && onDone())
          }}
        >
          <Field label={`Type the workspace name (${org.name}) to confirm`}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Alert>{act.error}</Alert>
          <div className="row">
            <button className="btn primary" type="submit" disabled={name !== org.name || act.busy}>
              Delete
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  )
}

/* ---------------- my membership ---------------- */

export function MyMembershipTab({ ctx }: { ctx: OrgCtx }) {
  const { org, me } = ctx
  const nav = useNavigate()
  const [name, setName] = useState(me.display_name)
  const [notify, setNotify] = useState(true)
  const [leaving, setLeaving] = useState(false)
  const act = useAction()
  useEffect(() => {
    void cloud()
      .from('org_members')
      .select('notify')
      .eq('org_id', org.id)
      .eq('user_id', ctx.myId)
      .single()
      .then(({ data }) => data && setNotify((data.notify as { announcements: boolean }).announcements !== false))
  }, [org.id, ctx.myId])
  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault()
          void act.run(() => setMySettings(org.id, { display_name: name, notify: { announcements: notify } }), 'Saved.').then((ok) => ok && ctx.reload())
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Your membership</h2>
        <Field label="Your name as members see it">
          <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <label className="row">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Show a badge for new announcements from this workspace
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Announcements appear in the app only. They are not emailed.
        </p>
        <Alert>{act.error}</Alert>
        <div className="row">
          <button className="btn primary" type="submit" disabled={act.busy}>
            Save
          </button>
        </div>
      </form>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>What {org.name} can see</h2>
        <ul style={{ margin: 0 }}>
          <li>Your name (as entered above) and your role.</li>
          <li>What you submit or share here: assignments, quiz answers, reflections you submit, group responses you submit, and discussion posts.</li>
          <li>Course progress and attendance, for the instructors of your courses.</li>
        </ul>
        <p style={{ margin: 0 }}>
          It never sees your personal notes, highlights, bookmarks, sermons, studies, reading history, or AI conversations. Administrators see your email address so they can
          reach you.
        </p>
      </section>
      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Your work in {org.name}</h2>
        <p style={{ margin: 0 }}>Download everything you did here: course enrollments, progress, quiz results, written answers with feedback, attendance, group responses, discussion posts, and the copies you shared.</p>
        <div>
          <button className="btn" onClick={() => void act.run(() => downloadMyWork(org, ctx.myId), 'Downloaded.')} data-testid="download-my-work">
            Download my work (JSON)
          </button>
        </div>
      </section>
      {me.role !== 'owner' ? (
        <section className="card stack">
          <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Leave {org.name}</h2>
          <p style={{ margin: 0 }}>Your access ends right away. Your personal study data is not affected. The workspace keeps its records of your course work and attendance.</p>
          <div>
            <button className="btn" onClick={() => setLeaving(true)}>
              Leave workspace
            </button>
          </div>
          <Dialog open={leaving} onClose={() => setLeaving(false)} title="Leave workspace">
            <div className="stack">
              <p style={{ margin: 0 }}>Leave {org.name}? You would need a new invitation to come back.</p>
              <Alert>{act.error}</Alert>
              <div className="row">
                <button className="btn primary" onClick={() => void act.run(() => leaveOrg(org.id), `You left ${org.name}.`).then((ok) => ok && nav('/church'))}>
                  Leave
                </button>
                <button className="btn" onClick={() => setLeaving(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </Dialog>
        </section>
      ) : (
        <p className="muted small">As the owner, transfer ownership (Settings) before you can leave.</p>
      )}
    </div>
  )
}

/** Everything the member did in this workspace (only their own rows; the database enforces that). */
async function downloadMyWork(org: Org, myId: string) {
  const c = cloud()
  type Q = { eq: (k: string, v: string) => Q; in: (k: string, v: string[]) => Q }
  const get = async (table: string, filter: (q: Q) => Q) => {
    const { data, error } = (await (filter(c.from(table).select('*') as unknown as Q) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>))
    if (error) throw new Error(error.message)
    return data ?? []
  }
  const enrollments = (await get('org_enrollments', (q) => q.eq('org_id', org.id).eq('user_id', myId))) as { id: string }[]
  const ids = enrollments.map((e) => e.id)
  const byEnr = (t: string) => (ids.length ? get(t, (q) => q.in('enrollment_id', ids)) : Promise.resolve([]))
  const [progress, quizzes, written, attendance, responses, posts, shared, courses] = await Promise.all([
    byEnr('org_lesson_progress'),
    byEnr('org_quiz_attempts'),
    byEnr('org_written_answers'),
    byEnr('org_attendance'),
    get('org_group_responses', (q) => q.eq('org_id', org.id).eq('user_id', myId)),
    get('org_discussion_posts', (q) => q.eq('org_id', org.id).eq('author_id', myId)),
    get('org_shared_resources', (q) => q.eq('org_id', org.id).eq('owner_id', myId)),
    get('org_courses', (q) => q.eq('org_id', org.id)),
  ])
  const out = { format: 'carter-study-bible-workspace-export', version: 1, workspace: org.name, exportedAt: new Date().toISOString(), courses: (courses as { id: string; title: string }[]).filter((x) => enrollments.some((e) => (e as unknown as { course_id: string }).course_id === x.id)).map((x) => ({ id: x.id, title: x.title })), enrollments, progress, quizzes, written, attendance, groupResponses: responses, posts, shared }
  downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `${slug(org.name)}-my-work-${out.exportedAt.slice(0, 10)}.json`)
}

/* ---------------- activity log (owner and administrators) ---------------- */

const ACTION_TEXT: Record<string, string> = {
  org_created: 'created the workspace',
  org_updated: 'changed workspace settings',
  invitation_created: 'sent an invitation',
  invitation_resent: 'sent an invitation again',
  invitation_revoked: 'withdrew an invitation',
  invitation_accepted: 'accepted an invitation',
  role_changed: 'changed a role',
  member_removed: 'removed a member',
  member_left: 'left the workspace',
  ownership_offered: 'offered ownership',
  ownership_transferred: 'became the owner',
  ownership_offer_cancelled: 'withdrew an ownership offer',
  org_deleted: 'deleted the workspace',
  org_restored: 'restored the workspace',
  course_created: 'added a course',
  course_published: 'published a course',
  course_options_changed: 'changed course options',
  instructor_assigned: 'assigned an instructor',
  instructor_unassigned: 'removed an instructor',
  enrolled_self: 'enrolled in a course',
  enrolled_by_staff: 'enrolled students',
  enrollment_withdrawn: 'withdrew from a course',
  answer_graded: 'graded an answer',
  quiz_reviewed: 'reviewed a quiz',
  session_deleted: 'deleted a class session',
  group_created: 'created a group',
  group_member_changed: 'changed group membership',
  moderated: 'moderated a discussion',
  report_resolved: 'resolved a report',
  resource_shared: 'shared a resource',
  resource_revoked: 'withdrew a shared resource',
  resource_approved: 'approved a shared resource',
}

export function ActivityTab({ ctx }: { ctx: OrgCtx }) {
  const [page, setPage] = useState(0)
  const log = useAsync(() => auditLog(ctx.org.id, page), [ctx.org.id, page])
  const names = useAsync(async () => new Map((await members(ctx.org.id, { includeRemoved: true })).rows.map((m) => [m.user_id, m.display_name])), [ctx.org.id])
  const who = (id: string | null) => (id ? (names.data?.get(id) ?? 'A former member') : 'Someone')
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        A record of changes to membership, roles, invitations, courses, and groups. It never includes anyone's study content.
      </p>
      {log.loading ? (
        <Loading />
      ) : log.error ? (
        <ErrorBox error={log.error} onRetry={log.reload} />
      ) : !log.data!.rows.length ? (
        <Empty>Nothing yet.</Empty>
      ) : (
        <ul className="list" data-testid="activity-log">
          {log.data!.rows.map((r) => (
            <li key={r.id} className="small">
              <span className="muted">{new Date(r.at).toLocaleString()}</span> · {who(r.actor)} {ACTION_TEXT[r.action] ?? r.action}
              {r.action === 'role_changed' && r.detail.to ? ` (${who(r.target)}: ${ROLE_LABEL[r.detail.to as Role]})` : ''}
              {(r.action === 'member_removed' || r.action === 'ownership_transferred' || r.action === 'ownership_offered') && r.target ? ` (${who(r.target)})` : ''}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Newer
        </button>
        <button className="btn" disabled={!log.data?.more} onClick={() => setPage(page + 1)}>
          Older
        </button>
      </div>
    </div>
  )
}

/* ---------------- sections of a workspace (later stages add courses, groups, sharing, announcements, reports) ---------------- */

export const ORG_TABS: { id: string; label: string; min: number; View: (p: { ctx: OrgCtx }) => ReactNode }[] = [
  { id: 'overview', label: 'Overview', min: 1, View: OverviewTab },
  { id: 'members', label: 'Members', min: 1, View: MembersTab },
  { id: 'courses', label: 'Courses', min: 1, View: CoursesTab },
  { id: 'groups', label: 'Groups', min: 1, View: GroupsTab },
  { id: 'announcements', label: 'Announcements', min: 1, View: AnnouncementsTab },
  { id: 'shared', label: 'Shared', min: 1, View: SharedTab },
  { id: 'invitations', label: 'Invitations', min: 2, View: InvitationsTab },
  { id: 'reports', label: 'Reports', min: 2, View: ReportsTab },
  { id: 'settings', label: 'Settings', min: 5, View: SettingsTab },
  { id: 'activity', label: 'Activity', min: 5, View: ActivityTab },
  { id: 'me', label: 'My membership', min: 1, View: MyMembershipTab },
]

/** The Church entry in the top bar: shown only to signed-in people who belong to a workspace (remembered on this device, no network). */
export function useCurrentOrgLink() {
  return useMemo(() => (currentOrgId() ? `/church/${currentOrgId()}` : '/church'), [])
}
export { Church as ChurchIcon }
