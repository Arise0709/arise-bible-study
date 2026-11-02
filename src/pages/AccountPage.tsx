import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Download, KeyRound, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { db, uid, type SyncConflict } from '../db/db'
import { Dialog, Loading, downloadBlob, toast } from '../components/ui'
import { downloadBackup } from '../lib/dataSafety'
import { cloudConfigured } from '../lib/cloud/config'
import { claimDevice, cloud, cloudState, onCloudState, signOut, syncNow, type CloudState } from '../lib/cloud/manager'
import { planMigration, restoreSnapshot, runMigration, type MigrationPlan, type MigrationResult } from '../lib/cloud/migrate'
import { supabaseRemote } from '../lib/cloud/remote'
import { SYNCED } from '../lib/cloud/sync'
import { deviceId } from '../lib/cloud/config'
import { TABLE_LABELS } from '../db/backup'

export const STATUS_TEXT: Record<CloudState['status'], string> = {
  local: 'Saved on this device',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Offline: saved on this device, will sync when connected',
  error: 'Sync failed: will try again',
  conflict: 'Conflict detected: please review',
}

function useCloud(): CloudState {
  const [s, setS] = useState<CloudState>(() => cloudState())
  useEffect(() => {
    cloud()
    return onCloudState(setS)
  }, [])
  return s
}

const label = (t: string) => TABLE_LABELS[t as keyof typeof TABLE_LABELS] ?? t

export function AccountPage() {
  useEffect(() => {
    document.title = 'Account and sync · Arise Bible Study'
  }, [])
  if (!cloudConfigured()) {
    return (
      <div className="page stack" style={{ maxWidth: 720 }}>
        <h1>Account and sync</h1>
        <p>Accounts are not switched on for this site yet. Everything you do is saved on this device, and you can download a backup any time from Settings.</p>
      </div>
    )
  }
  return <AccountInner />
}

function AccountInner() {
  const s = useCloud()
  return (
    <div className="page stack" style={{ maxWidth: 760 }}>
      <h1 style={{ margin: 0 }}>Account and sync</h1>
      <p className="muted" style={{ margin: 0 }}>
        An account is optional. Reading Scripture, studying, and saving notes never need one. With an account, your notes, highlights, studies, sermons, plans, and courses
        stay in step across your devices.
      </p>
      {s.recovery ? <NewPassword /> : !s.session ? <SignedOut /> : s.needsCode ? <CodeStep /> : <SignedIn s={s} />}
    </div>
  )
}

/* ---------------- signed out ---------------- */

function SignedOut() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [age, setAge] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    setBusy(true)
    try {
      const auth = cloud().auth
      if (mode === 'in') {
        const r = await auth.signInWithPassword({ email, password })
        if (r.error) setMsg({ kind: 'error', text: /confirm/i.test(r.error.message) ? 'Please confirm your email first. Check your inbox for the link we sent.' : 'That email and password did not match. Check them and try again.' })
      } else if (mode === 'up') {
        if (!age) return setMsg({ kind: 'error', text: 'Accounts are for people 13 and older. You can keep using everything here without an account.' })
        const r = await auth.signUp({ email, password, options: { data: { age_confirmed_13: true }, emailRedirectTo: `${location.origin}/account` } })
        if (r.error) setMsg({ kind: 'error', text: r.error.message })
        else setMsg({ kind: 'ok', text: `Check ${email} for a link to confirm your account. Nothing on this device changes until you sign in.` })
      } else {
        await auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/account` })
        setMsg({ kind: 'ok', text: `If an account uses ${email}, a link to choose a new password is on its way.` })
      }
    } catch {
      setMsg({ kind: 'error', text: 'Could not reach the account service. Check your connection and try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card stack" onSubmit={go} data-testid="auth-form">
      <div className="row" role="tablist" aria-label="Account">
        {(['in', 'up'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} className={`btn ${mode === m ? 'primary' : ''}`} onClick={() => (setMode(m), setMsg(null))}>
            {m === 'in' ? 'Sign in' : 'Create an account'}
          </button>
        ))}
      </div>
      {mode === 'forgot' && <p style={{ margin: 0 }}>Enter your email and we will send a link to choose a new password.</p>}
      <label className="stack" style={{ gap: 4 }}>
        <strong>Email</strong>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode !== 'forgot' && (
        <label className="stack" style={{ gap: 4 }}>
          <strong>Password</strong>
          <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={mode === 'up' ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={mode === 'up' ? 'pw-help' : undefined} />
          {mode === 'up' && <span className="muted small" id="pw-help">At least 10 characters. A short phrase is easiest to remember.</span>}
        </label>
      )}
      {mode === 'up' && (
        <label className="row" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /> <span>I am 13 or older. (Younger readers can use everything here without an account.)</span>
        </label>
      )}
      {msg && (
        <div className={`notice ${msg.kind === 'ok' ? 'ok' : 'error'}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" type="submit" disabled={busy}>
          {mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send the link'}
        </button>
        {mode === 'in' && (
          <button type="button" className="btn" onClick={() => (setMode('forgot'), setMsg(null))}>
            Forgot password?
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" className="btn" onClick={() => setMode('in')}>
            Back to sign in
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Your study content is private to you. It is stored with Supabase (our database provider) and protected so only your signed-in account can read it.
      </p>
    </form>
  )
}

function NewPassword() {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await cloud().auth.updateUser({ password: pw })
        if (r.error) setMsg(r.error.message)
        else {
          toast('Password changed')
          location.replace('/account')
        }
      }}
    >
      <h2 style={{ margin: 0 }}>Choose a new password</h2>
      <label className="stack" style={{ gap: 4 }}>
        <strong>New password</strong>
        <input type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      {msg && (
        <div className="notice error" role="alert">
          {msg}
        </div>
      )}
      <div>
        <button className="btn primary">Save password</button>
      </div>
    </form>
  )
}

function CodeStep() {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault()
        setErr('')
        const f = await cloud().auth.mfa.listFactors()
        const factor = f.data?.totp.find((x) => x.status === 'verified')
        if (!factor) return setErr('No authenticator is set up for this account.')
        const r = await cloud().auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
        if (r.error) setErr('That code did not work. Codes change every 30 seconds; try the current one.')
        else location.reload()
      }}
    >
      <h2 style={{ margin: 0 }}>Enter your authenticator code</h2>
      <p style={{ margin: 0 }}>Your account uses two-step sign-in. Open your authenticator app and enter the 6-digit code for Carter Study Bible.</p>
      <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
      {err && (
        <div className="notice error" role="alert">
          {err}
        </div>
      )}
      <div className="row">
        <button className="btn primary">Continue</button>
        <button type="button" className="btn" onClick={() => signOut()}>
          Cancel and sign out
        </button>
      </div>
    </form>
  )
}

/* ---------------- signed in ---------------- */

function SignedIn({ s }: { s: CloudState }) {
  // keep the migration panel on screen after it finishes, so its confirmation stays visible
  const [showMigration, setShowMigration] = useState(false)
  useEffect(() => {
    if (s.ownership === 'unclaimed') setShowMigration(true)
  }, [s.ownership])
  return (
    <>
      <SyncCard s={s} />
      {showMigration && <MigrationPanel />}
      {s.ownership === 'other' && <OtherOwner s={s} />}
      <Conflicts />
      <Security s={s} />
      <YourData s={s} />
    </>
  )
}

function StatusIcon({ status }: { status: CloudState['status'] }) {
  if (status === 'synced') return <CheckCircle2 size={18} aria-hidden />
  if (status === 'syncing') return <RefreshCw size={18} aria-hidden className="spin" />
  if (status === 'offline' || status === 'local') return <CloudOff size={18} aria-hidden />
  return <AlertTriangle size={18} aria-hidden />
}

function SyncCard({ s }: { s: CloudState }) {
  return (
    <section className="card stack" aria-labelledby="sync-h">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <h2 id="sync-h" style={{ margin: 0 }}>
          <Cloud size={18} aria-hidden /> Signed in as {s.session?.user.email}
        </h2>
      </div>
      <div className="row" role="status" data-testid="sync-status" style={{ flexWrap: 'wrap' }}>
        <StatusIcon status={s.status} /> <strong>{STATUS_TEXT[s.status]}</strong>
        {s.pending > 0 && s.status !== 'synced' && <span className="muted small">{s.pending} change{s.pending === 1 ? '' : 's'} waiting</span>}
        {s.lastSynced && <span className="muted small">last confirmed by the server {new Date(s.lastSynced).toLocaleTimeString()}</span>}
      </div>
      {s.error && <div className="small muted">Details: {s.error}</div>}
      {s.ownership === 'mine' && (
        <div>
          <button className="btn" onClick={() => syncNow()}>
            <RefreshCw size={16} aria-hidden /> Sync now
          </button>
        </div>
      )}
    </section>
  )
}

function MigrationPanel() {
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [err, setErr] = useState('')
  const [backedUp, setBackedUp] = useState(false)
  const [step, setStep] = useState('')
  const [result, setResult] = useState<MigrationResult | null>(null)
  useEffect(() => {
    if (cloudState().ownership !== 'unclaimed') return
    planMigration(db, supabaseRemote(cloud())).then(setPlan, (e) => setErr(navigator.onLine ? (e as Error).message : 'You are offline. Connect to the internet to combine this device with your account. Nothing has changed.'))
  }, [])
  const go = async () => {
    setErr('')
    try {
      const st = cloudState()
      const r = await runMigration(db, supabaseRemote(cloud()), deviceId(), `Before combining with ${st.session?.user.email} on ${new Date().toLocaleString()}`, setStep)
      setResult(r)
      if (r.ok) {
        await claimDevice()
        await cloud().rpc('log_event', { action: 'migration_complete', detail: { uploaded: r.uploaded, downloaded: r.downloaded, conflicts: r.conflicts, confirmed: r.confirmed } })
        void syncNow()
      }
    } catch (e) {
      setErr(`The transfer stopped: ${(e as Error).message} Everything on this device is still here, and a saved copy was kept. You can try again; records already sent are not sent twice.`)
    } finally {
      setStep('')
    }
  }
  return (
    <section className="card stack" aria-labelledby="mig-h" data-testid="migration">
      <h2 id="mig-h" style={{ margin: 0 }}>Bring this device's study data into your account</h2>
      <p style={{ margin: 0 }}>This device has study data that is not in your account yet. Nothing is moved until you choose to, and nothing is deleted from this device.</p>
      {err && (
        <div className="notice error" role="alert">
          {err}
        </div>
      )}
      {!plan && !err && <Loading label="Comparing this device with your account" />}
      {plan && !result && (
        <>
          <table className="small" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: 4 }}>Item</th>
                <th style={{ padding: 4 }}>On this device</th>
                <th style={{ padding: 4 }}>In your account</th>
              </tr>
            </thead>
            <tbody>
              {SYNCED.filter((k) => plan.local[k] || plan.cloud[k]).map((k) => (
                <tr key={k} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 4 }}>{label(k)}</td>
                  <td style={{ padding: 4 }}>{plan.local[k] ?? 0}</td>
                  <td style={{ padding: 4 }}>{plan.cloud[k] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="small" style={{ margin: 0 }} data-testid="migration-summary">
            <li>{plan.toUpload} item{plan.toUpload === 1 ? '' : 's'} will be added to your account.</li>
            {plan.identical > 0 && <li>{plan.identical} already in your account (same content), left as is.</li>}
            {plan.duplicates.length > 0 && (
              <li>
                {plan.duplicates.length} duplicate{plan.duplicates.length === 1 ? '' : 's'} found (the same note, verse, or sermon already in your account): the account's copy is kept, so nothing is doubled.
                {plan.duplicates.some((d) => !d.sameContent) && ' For highlights or bookmarks on the same verse, the account’s color or label is kept.'}
              </li>
            )}
            {plan.conflicts.length > 0 && <li>{plan.conflicts.length} item{plan.conflicts.length === 1 ? ' was' : 's were'} changed in both places: both versions are kept for you to compare afterwards.</li>}
            {plan.cloudOnly > 0 && <li>{plan.cloudOnly} item{plan.cloudOnly === 1 ? '' : 's'} from your account will be added to this device.</li>}
            <li>A full copy of this device's data is saved on this device first, so you can always go back.</li>
          </ul>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={async () => {
                await downloadBackup()
                setBackedUp(true)
              }}
            >
              <Download size={16} aria-hidden /> Download a backup first
            </button>
            {backedUp && <span className="small">Backup downloaded.</span>}
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={go} disabled={!!step}>
              {step || 'Combine with my account'}
            </button>
            <button className="btn" onClick={() => signOut()}>
              Not now (sign out, keep using this device as before)
            </button>
          </div>
        </>
      )}
      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'error'}`} role="status" data-testid="migration-result">
          {result.ok ? (
            <>
              Done. {result.confirmed} item{result.confirmed === 1 ? '' : 's'} on this device are confirmed in your account ({result.uploaded} sent, {result.downloaded} received
              {result.conflicts ? `, ${result.conflicts} to review below` : ''}). Sync is now on.
            </>
          ) : (
            <>
              Not finished: {result.problems.length} item{result.problems.length === 1 ? ' was' : 's were'} not confirmed by the server. Nothing was removed. <button className="btn sm" onClick={go}>Try again</button>
              <ul className="small">{result.problems.slice(0, 5).map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function OtherOwner({ s }: { s: CloudState }) {
  const [backedUp, setBackedUp] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <section className="notice warn stack" data-testid="other-owner">
      <strong>This device holds study data from another account{s.otherOwnerEmail ? ` (${s.otherOwnerEmail})` : ''}.</strong>
      <span>To keep accounts separate, it will not be combined with this one. Sign out and sign in with that account, or download a backup and then clear that data from this device to continue with this account.</span>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => signOut()}>
          <LogOut size={16} aria-hidden /> Sign out
        </button>
        <button
          className="btn"
          onClick={async () => {
            await downloadBackup()
            setBackedUp(true)
          }}
        >
          <Download size={16} aria-hidden /> Download a backup
        </button>
        <button className="btn danger" disabled={!backedUp} onClick={() => setConfirm(true)}>
          Clear that data from this device
        </button>
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Clear the other account's data from this device?">
        <p>The study data on this device belongs to {s.otherOwnerEmail || 'another account'}. It stays in that account and in the backup you downloaded. It will be removed from this device only.</p>
        <div className="row">
          <button
            className="btn danger"
            onClick={async () => {
              await db.transaction('rw', [...SYNCED.map((k) => db.table(k)), db.recordState, db.syncMeta, db.conflicts], async () => {
                for (const k of SYNCED) await db.table(k).clear()
                await db.recordState.clear()
                await db.conflicts.clear()
                await db.syncMeta.clear()
              })
              location.reload()
            }}
          >
            Clear and continue
          </button>
          <button className="btn" onClick={() => setConfirm(false)}>
            Keep it
          </button>
        </div>
      </Dialog>
    </section>
  )
}

/* ---------------- conflicts ---------------- */

function readable(kind: string, d: unknown): string {
  if (d === null || d === undefined) return '(deleted)'
  const r = d as Record<string, unknown>
  const blocks = (bs: unknown) => ((bs as { kind: string; text?: string; ref?: string; citation?: string }[]) ?? []).map((b) => b.text ?? b.ref ?? b.citation ?? '').filter(Boolean).join('\n')
  if (kind === 'sermons') return [r.title, ...((r.sections as { title: string; blocks: unknown }[]) ?? []).map((s) => `\n# ${s.title}\n${blocks(s.blocks)}`)].join('\n')
  if (kind === 'studies') return [r.title, ...Object.entries((r.sections as Record<string, unknown>) ?? {}).map(([k, v]) => `\n# ${k}\n${blocks(v)}`)].join('\n')
  if (kind === 'notes') return String(r.text ?? '')
  if (kind === 'dict') return `${r.term}\n${r.definition}`
  return JSON.stringify(d, null, 1)
}

function Conflicts() {
  const list = useLiveQuery(() => db.conflicts.orderBy('at').reverse().filter((c) => !c.resolved).toArray(), []) ?? []
  if (!list.length) return null
  return (
    <section className="card stack" aria-labelledby="conf-h" data-testid="conflicts">
      <h2 id="conf-h" style={{ margin: 0 }}>
        <AlertTriangle size={18} aria-hidden /> To review: {list.length} item{list.length === 1 ? '' : 's'} changed on two devices
      </h2>
      <p className="small" style={{ margin: 0 }}>Nothing was lost. Your account now shows the version saved first; this device's version is kept here until you decide.</p>
      {list.map((c) => (
        <ConflictItem key={c.id} c={c} />
      ))}
    </section>
  )
}

function ConflictItem({ c }: { c: SyncConflict }) {
  const resolve = async (how: 'local' | 'server' | 'both') => {
    const t = db.table(c.kind)
    if (how === 'local') {
      if (c.local === null) await t.delete(c.recordId)
      else await t.put(c.local)
    } else if (how === 'both' && c.local) {
      const copy = { ...(c.local as Record<string, unknown>), id: uid(), updatedAt: Date.now() }
      if ('title' in copy) copy.title = `${copy.title} (copy from this device)`
      if ('term' in copy) copy.term = `${copy.term} (copy from this device)`
      await t.put(copy)
    }
    await db.conflicts.update(c.id, { resolved: how, resolvedAt: Date.now() })
    toast('Saved. Syncing your choice.')
    void syncNow()
  }
  const canBoth = c.local !== null && c.server !== null && ['sermons', 'studies', 'notes', 'dict'].includes(c.kind)
  return (
    <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
      <strong>{c.label}</strong>
      <div className="grid-2">
        <div>
          <div className="small muted">On this device</div>
          <pre className="conflict-text">{readable(c.kind, c.local)}</pre>
        </div>
        <div>
          <div className="small muted">In your account</div>
          <pre className="conflict-text">{readable(c.kind, c.server)}</pre>
        </div>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => resolve('local')}>Keep this device's version</button>
        <button className="btn" onClick={() => resolve('server')}>Keep the account's version</button>
        {canBoth && (
          <button className="btn" onClick={() => resolve('both')}>
            Keep both
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- security and data ---------------- */

function Security({ s }: { s: CloudState }) {
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [pw, setPw] = useState('')
  const factors = useFactors(s)
  return (
    <section className="card stack" aria-labelledby="sec-h">
      <h2 id="sec-h" style={{ margin: 0 }}>
        <ShieldCheck size={18} aria-hidden /> Sign-in and security
      </h2>
      <form
        className="row"
        style={{ flexWrap: 'wrap' }}
        onSubmit={async (e) => {
          e.preventDefault()
          const r = await cloud().auth.updateUser({ password: pw })
          setMsg(r.error ? r.error.message : 'Password changed.')
          setPw('')
        }}
      >
        <label className="row">
          <KeyRound size={16} aria-hidden /> New password
          <input type="password" autoComplete="new-password" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <button className="btn" disabled={pw.length < 10}>
          Change password
        </button>
      </form>
      <div className="stack" style={{ gap: 6 }}>
        <strong>Two-step sign-in (optional)</strong>
        {factors.length ? (
          <div className="row">
            <span>On: an authenticator app is required after your password.</span>
            <button
              className="btn sm"
              onClick={async () => {
                for (const f of factors) await cloud().auth.mfa.unenroll({ factorId: f })
                setMsg('Two-step sign-in turned off.')
                location.reload()
              }}
            >
              Turn off
            </button>
          </div>
        ) : enroll ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await cloud().auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() })
              if (r.error) setMsg('That code did not work. Try the current one.')
              else {
                setEnroll(null)
                setMsg('Two-step sign-in is on.')
                location.reload()
              }
            }}
          >
            <span>Scan this with an authenticator app (such as Google Authenticator or Microsoft Authenticator), then enter the code it shows.</span>
            <img src={enroll.qr} alt="QR code for your authenticator app" width={180} height={180} style={{ background: '#fff' }} />
            <span className="small muted">Can't scan? Enter this key: {enroll.secret}</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
            <div>
              <button className="btn primary">Turn on</button>
            </div>
          </form>
        ) : (
          <div>
            <button
              className="btn"
              onClick={async () => {
                const r = await cloud().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toLocaleDateString()}` })
                if (r.error) setMsg(r.error.message)
                else setEnroll({ id: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret })
              }}
            >
              Set up an authenticator app
            </button>
          </div>
        )}
      </div>
      {msg && <div className="small" role="status">{msg}</div>}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => signOut(false)}>
          <LogOut size={16} aria-hidden /> Sign out of this device
        </button>
        <button className="btn" onClick={() => signOut(true)}>
          Sign out everywhere
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Signing out keeps everything on this device; it works as before without an account.</p>
    </section>
  )
}

function useFactors(s: CloudState): string[] {
  const [f, setF] = useState<string[]>([])
  useEffect(() => {
    if (!s.session) return
    cloud()
      .auth.mfa.listFactors()
      .then((r) => setF((r.data?.totp ?? []).filter((x) => x.status === 'verified').map((x) => x.id)))
  }, [s.session])
  return f
}

function YourData({ s }: { s: CloudState }) {
  const snaps = useLiveQuery(() => db.snapshots.orderBy('at').reverse().toArray(), []) ?? []
  const [del, setDel] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [restore, setRestore] = useState<string | null>(null)
  return (
    <section className="card stack" aria-labelledby="data-h">
      <h2 id="data-h" style={{ margin: 0 }}>Your data</h2>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => downloadBackup()}>
          <Download size={16} aria-hidden /> Download a backup of this device
        </button>
        <button
          className="btn"
          onClick={async () => {
            const rows: { kind: string; deleted: boolean; data: unknown; id: string }[] = []
            let since = 0
            for (;;) {
              const r = await supabaseRemote(cloud()).pull(since, 1000)
              rows.push(...r)
              if (r.length < 1000) break
              since = r[r.length - 1].seq
            }
            const latest = new Map(rows.map((r) => [`${r.kind}/${r.id}`, r]))
            const data: Record<string, unknown[]> = {}
            for (const r of latest.values()) if (!r.deleted) (data[r.kind] ??= []).push(r.data)
            const file = { format: 'arise-bible-study-backup', version: 1, exportedAt: new Date().toISOString(), source: 'account', data }
            downloadBlob(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }), `carter-study-bible-account-${new Date().toISOString().slice(0, 10)}.json`)
          }}
          disabled={s.ownership !== 'mine'}
        >
          <Download size={16} aria-hidden /> Download everything in your account
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Both downloads are ordinary backup files: you can restore them in Settings, with or without an account.</p>
      {snaps.length > 0 && (
        <details>
          <summary>Copies saved on this device before combining with an account ({snaps.length})</summary>
          <ul className="list small">
            {snaps.map((x) => (
              <li key={x.id} className="row" style={{ flexWrap: 'wrap' }}>
                <span>{x.reason}</span>
                <span className="muted">{Object.entries(x.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${label(k).toLowerCase()}`).join(', ')}</span>
                <button className="btn sm" onClick={() => setRestore(x.id)}>
                  Restore this device to this copy
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Dialog open={!!restore} onClose={() => setRestore(null)} title="Restore this device to the saved copy?">
        <p>This device's study data goes back to exactly how it was before combining. Your account is not changed. Sync stops on this device until you combine again.</p>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              await restoreSnapshot(db, restore!)
              await signOut()
              location.reload()
            }}
          >
            Restore and sign out
          </button>
          <button className="btn" onClick={() => setRestore(null)}>
            Cancel
          </button>
        </div>
      </Dialog>
      <div>
        <button className="btn danger" onClick={() => setDel(true)}>
          <Trash2 size={16} aria-hidden /> Delete my account
        </button>
      </div>
      <Dialog open={del} onClose={() => setDel(false)} title="Delete your account?">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault()
            setErr('')
            const token = (await cloud().auth.getSession()).data.session?.access_token
            const r = await fetch('/api/account', { method: 'DELETE', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: confirmText, password: pw }) })
            const j = await r.json().catch(() => ({}))
            if (!r.ok) return setErr(j.error ?? 'The account could not be deleted.')
            await db.syncMeta.clear()
            await db.recordState.clear()
            await signOut().catch(() => {})
            toast('Your account was deleted. Everything on this device is still here.')
            location.replace('/settings')
          }}
        >
          <p style={{ margin: 0 }}>
            This permanently deletes your account and the copy of your study data stored with it. The copy on this device stays, and keeps working without an account. Download
            everything in your account first if you want a file.
          </p>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Your password</strong>
            <input type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <strong>Type DELETE to confirm</strong>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </label>
          {err && (
            <div className="notice error" role="alert">
              {err}
            </div>
          )}
          <div className="row">
            <button className="btn danger" disabled={confirmText !== 'DELETE'}>
              Delete my account
            </button>
            <button type="button" className="btn" onClick={() => setDel(false)}>
              Keep it
            </button>
          </div>
        </form>
      </Dialog>
      <p className="muted small" style={{ margin: 0 }}>
        Want to use only this device? <Link to="/settings">Settings</Link> has backups and restore, as always.
      </p>
    </section>
  )
}

