/**
 * Moving a guest's local study data into an account (first sign-in on a device that already has data).
 *
 * Nothing local is deleted except exact duplicates of records the account already has, and a full copy of the
 * local data is saved on this device first (snapshots table), so everything stays recoverable. The migration is
 * marked complete only after every local record has been read back from the server and matches.
 */
import { uid, type StudyDB } from '../../db/db'
import { SYNCED, SyncEngine, canonical, fingerprint, type PulledRow, type Remote } from './sync'

/** What makes two records "the same thing" even with different ids. */
function naturalKey(kind: string, r: Record<string, unknown>): string | null {
  const strip = (o: Record<string, unknown>) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = o
    void _id
    void _c
    void _u
    return rest
  }
  switch (kind) {
    case 'highlights':
    case 'bookmarks':
      return `${kind}:${r.key}`
    case 'enrollments':
      return `enroll:${r.courseId}`
    case 'notes':
      return `note:${r.ref}:${r.text}`
    case 'dict':
      return `dict:${r.term}:${r.definition}`
    case 'folders':
      return `folder:${r.kind}:${r.name}`
    case 'studies':
    case 'sermons':
      return `${kind}:${fingerprint(strip(r))}`
    case 'planProgress':
      return `pp:${r.planId}:${r.sessionId}:${r.run}`
    default:
      return null
  }
}

export interface MigrationPlan {
  local: Record<string, number>
  cloud: Record<string, number>
  toUpload: number
  identical: number
  duplicates: { kind: string; localId: string; cloudId: string; sameContent: boolean }[]
  conflicts: { kind: string; id: string }[]
  cloudOnly: number
}

async function pullEverything(remote: Remote): Promise<PulledRow[]> {
  const out: PulledRow[] = []
  let since = 0
  for (;;) {
    const rows = await remote.pull(since, 1000)
    out.push(...rows)
    if (rows.length < 1000) break
    since = rows[rows.length - 1].seq
  }
  const latest = new Map<string, PulledRow>()
  for (const r of out) latest.set(`${r.kind}/${r.id}`, r)
  return [...latest.values()].filter((r) => !r.deleted)
}

async function localRecords(db: StudyDB) {
  const out: { kind: string; id: string; data: Record<string, unknown> }[] = []
  for (const kind of SYNCED) for (const r of (await db.table(kind).toArray()) as Record<string, unknown>[]) {
    if (kind === 'settings' && ['lastBackupAt', 'backupSnoozeUntil'].includes(String(r.key))) continue
    out.push({ kind, id: String(kind === 'settings' ? r.key : r.id), data: r })
  }
  return out
}

/** Compare this device with the account without changing anything. */
export async function planMigration(db: StudyDB, remote: Remote): Promise<MigrationPlan> {
  const [local, cloud] = await Promise.all([localRecords(db), pullEverything(remote)])
  const byId = new Map(cloud.map((r) => [`${r.kind}/${r.id}`, r]))
  const byNatural = new Map<string, PulledRow>()
  for (const r of cloud) {
    const k = naturalKey(r.kind, r.data as Record<string, unknown>)
    if (k && !byNatural.has(k)) byNatural.set(k, r)
  }
  const plan: MigrationPlan = { local: {}, cloud: {}, toUpload: 0, identical: 0, duplicates: [], conflicts: [], cloudOnly: 0 }
  const matched = new Set<string>()
  for (const r of cloud) plan.cloud[r.kind] = (plan.cloud[r.kind] ?? 0) + 1
  for (const l of local) {
    plan.local[l.kind] = (plan.local[l.kind] ?? 0) + 1
    const same = byId.get(`${l.kind}/${l.id}`)
    if (same) {
      matched.add(`${same.kind}/${same.id}`)
      if (fingerprint(same.data) === fingerprint(l.data)) plan.identical++
      else if (l.kind === 'settings') plan.identical++ // the account's settings are kept
      else plan.conflicts.push({ kind: l.kind, id: l.id })
      continue
    }
    const nk = naturalKey(l.kind, l.data)
    const dup = nk ? byNatural.get(nk) : undefined
    if (dup && !matched.has(`${dup.kind}/${dup.id}`)) {
      matched.add(`${dup.kind}/${dup.id}`)
      const a = { ...(dup.data as Record<string, unknown>), id: undefined, createdAt: undefined, updatedAt: undefined }
      const b = { ...l.data, id: undefined, createdAt: undefined, updatedAt: undefined }
      plan.duplicates.push({ kind: l.kind, localId: l.id, cloudId: dup.id, sameContent: canonical(a) === canonical(b) })
      continue
    }
    plan.toUpload++
  }
  plan.cloudOnly = cloud.filter((r) => !matched.has(`${r.kind}/${r.id}`)).length
  return plan
}

export interface MigrationResult {
  ok: boolean
  uploaded: number
  downloaded: number
  conflicts: number
  confirmed: number
  problems: string[]
  snapshotId: string
}

/**
 * Combine this device's data with the account. Steps: snapshot, replace exact duplicates with the account's
 * copy, bring down the account's records, send this device's new records, then read everything back and check.
 */
export async function runMigration(db: StudyDB, remote: Remote, device: string, reason: string, onStep?: (s: string) => void): Promise<MigrationResult> {
  const step = (s: string) => onStep?.(s)
  const plan = await planMigration(db, remote)
  step('Saving a copy of this device’s data')
  const snapshotId = uid()
  const data: Record<string, unknown[]> = {}
  for (const kind of SYNCED) data[kind] = await db.table(kind).toArray()
  await db.snapshots.put({ id: snapshotId, reason, at: Date.now(), counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), data })

  step('Matching records already in your account')
  // exact duplicates (or the same verse / course) are replaced by the account's copy, which comes down next
  for (const d of plan.duplicates) await db.table(d.kind).delete(d.localId)

  const engine = new SyncEngine(db, remote, device)
  step('Bringing down your account’s records')
  const pulled = await engine.pullAll()
  step('Sending this device’s records')
  const pushed = await engine.pushAll()
  const again = (await engine.pending()).length ? await engine.pushAll() : { pushed: 0, conflicts: 0 }

  step('Checking every record on the server')
  const problems: string[] = []
  const cloud = new Map((await pullEverything(remote)).map((r) => [`${r.kind}/${r.id}`, r]))
  let confirmed = 0
  for (const l of await localRecords(db)) {
    const c = cloud.get(`${l.kind}/${l.id}`)
    if (c && fingerprint(c.data) === fingerprint(l.data)) confirmed++
    else problems.push(`${l.kind} ${l.id} is not confirmed on the server`)
  }
  const pending = (await engine.pending()).length
  if (pending) problems.push(`${pending} change(s) still waiting to be sent`)
  return { ok: problems.length === 0, uploaded: pushed.pushed + again.pushed, downloaded: pulled.pulled, conflicts: pulled.conflicts + pushed.conflicts + again.conflicts, confirmed, problems, snapshotId }
}

/** Put back the local data exactly as it was before a migration (account data is not touched). */
export async function restoreSnapshot(db: StudyDB, id: string) {
  const s = await db.snapshots.get(id)
  if (!s) throw new Error('That saved copy is no longer on this device.')
  await db.transaction('rw', [...SYNCED.map((k) => db.table(k)), db.recordState, db.syncMeta], async () => {
    for (const kind of SYNCED) {
      await db.table(kind).clear()
      if (s.data[kind]?.length) await db.table(kind).bulkPut(s.data[kind])
    }
    await db.recordState.clear()
    await db.syncMeta.delete('cursor')
    await db.syncMeta.delete('owner')
  })
}
