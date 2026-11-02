/**
 * Accounts and automatic sync in the running app. Loaded only when the site has a Supabase project and the
 * person opens the account page or already has a saved sign-in, so guests download none of this.
 *
 * - Sync runs only for the account this device's data belongs to (syncMeta "owner"). The first sign-in on a
 *   device with data goes through the guided migration instead; data belonging to a different account is never
 *   merged without the person choosing to.
 * - Sync runs after local changes (2 s later), every minute while the app is open, when the connection
 *   returns, and on request. Only one browser tab syncs at a time.
 * - Status "synced" is shown only after the server confirmed every change and nothing is waiting.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import Dexie from 'dexie'
import { db } from '../../db/db'
import { CLOUD_KEY, CLOUD_URL, deviceId } from './config'
import { supabaseRemote } from './remote'
import { SyncEngine, type SyncStatus } from './sync'

export interface CloudState {
  session: Session | null
  status: SyncStatus
  /** set when this device's data belongs to no account yet (guided migration needed) or to another account */
  ownership: 'unknown' | 'mine' | 'unclaimed' | 'other'
  otherOwnerEmail?: string
  lastSynced?: number
  pending: number
  conflicts: number
  error?: string
  /** the session still needs the authenticator code (two-step sign-in) */
  needsCode: boolean
  recovery: boolean
}

let client: SupabaseClient | null = null
let state: CloudState = { session: null, status: 'local', ownership: 'unknown', pending: 0, conflicts: 0, needsCode: false, recovery: false }
const listeners = new Set<(s: CloudState) => void>()
const set = (p: Partial<CloudState>) => {
  state = { ...state, ...p }
  listeners.forEach((f) => f(state))
}
export const cloudState = () => state
export function onCloudState(f: (s: CloudState) => void) {
  listeners.add(f)
  f(state)
  return () => void listeners.delete(f)
}

export function cloud(): SupabaseClient {
  if (!client) {
    client = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') set({ recovery: true })
      void onSession(session)
    })
    void client.auth.getSession().then(({ data }) => onSession(data.session))
  }
  return client
}

async function onSession(session: Session | null) {
  set({ session })
  if (!session) {
    stopLoop()
    set({ status: 'local', ownership: 'unknown', needsCode: false })
    return
  }
  const aal = await cloud().auth.mfa.getAuthenticatorAssuranceLevel()
  const needsCode = aal.data?.nextLevel === 'aal2' && aal.data.currentLevel !== 'aal2'
  set({ needsCode })
  if (needsCode) return
  const owner = (await db.syncMeta.get('owner'))?.value as { id: string; email: string } | undefined
  const hasLocal = (await Promise.all(['notes', 'highlights', 'bookmarks', 'dict', 'studies', 'sermons', 'plans', 'courses'].map((t) => db.table(t).count()))).some((n) => n > 0)
  if (owner?.id === session.user.id) {
    set({ ownership: 'mine' })
    startLoop()
  } else if (owner) {
    set({ ownership: 'other', otherOwnerEmail: owner.email, status: 'local' })
  } else if (hasLocal) {
    set({ ownership: 'unclaimed', status: 'local' })
  } else {
    // nothing on this device yet: it simply starts syncing with the account
    await claimDevice(session)
    startLoop()
  }
  void refreshCounts()
}

/** Mark this device's data as belonging to the signed-in account (after migration, or when the device was empty). */
export async function claimDevice(session = state.session) {
  if (!session) throw new Error('Not signed in.')
  await db.syncMeta.put({ key: 'owner', value: { id: session.user.id, email: session.user.email ?? '' } })
  set({ ownership: 'mine' })
  startLoop() // automatic sync from now on (after a guided migration too)
  try {
    await cloud().rpc('log_event', { action: 'device_linked', detail: { device: deviceId() } })
  } catch {
    /* the audit note is best effort */
  }
}

export const engine = () => new SyncEngine(db, supabaseRemote(cloud()), deviceId())

async function refreshCounts() {
  const conflicts = await db.conflicts.filter((c) => !c.resolved).count()
  const pending = state.ownership === 'mine' ? (await engine().pending()).length : 0
  set({ conflicts, pending })
}

/* ---------------- the sync loop ---------------- */

let timer: ReturnType<typeof setInterval> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let running = false
let backoff = 0
let unsubscribe: (() => void) | null = null

function startLoop() {
  if (timer) return
  void syncNow()
  timer = setInterval(() => document.visibilityState === 'visible' && void syncNow(), 60_000)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  // local edits (in this tab or another) trigger a sync shortly after
  const onChange = () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => void syncNow(), 2000)
  }
  Dexie.on('storagemutated', onChange)
  unsubscribe = () => Dexie.on('storagemutated').unsubscribe(onChange)
}
function stopLoop() {
  if (timer) clearInterval(timer)
  timer = null
  unsubscribe?.()
  unsubscribe = null
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  document.removeEventListener('visibilitychange', onVisible)
}
const onOnline = () => void syncNow()
const onOffline = () => set({ status: 'offline' })
const onVisible = () => document.visibilityState === 'visible' && void syncNow()

/** Run one sync round now (one tab at a time). */
export async function syncNow(): Promise<void> {
  if (running || state.ownership !== 'mine' || !state.session) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await refreshCounts()
    set({ status: 'offline' })
    return
  }
  running = true
  set({ status: 'syncing', error: undefined })
  const work = async () => {
    const r = await engine().syncOnce()
    const conflicts = await db.conflicts.filter((c) => !c.resolved).count()
    backoff = 0
    set({ status: conflicts ? 'conflict' : r.pending ? 'syncing' : 'synced', lastSynced: Date.now(), pending: r.pending, conflicts })
  }
  try {
    if (navigator.locks) await navigator.locks.request('csb-sync', work)
    else await work()
  } catch (e) {
    backoff = Math.min(backoff ? backoff * 2 : 5_000, 300_000)
    set({ status: navigator.onLine ? 'error' : 'offline', error: (e as Error).message })
    setTimeout(() => void syncNow(), backoff)
  } finally {
    running = false
  }
}

/** Sign out of this device. The local copy stays and the app keeps working as a guest. */
export async function signOut(everywhere = false) {
  stopLoop()
  await cloud().auth.signOut({ scope: everywhere ? 'global' : 'local' })
  set({ session: null, status: 'local', ownership: 'unknown' })
}
