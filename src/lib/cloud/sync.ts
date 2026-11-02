/**
 * Cloud sync engine.
 *
 * The browser database stays the working copy (so offline keeps working). For each record, recordState
 * remembers the version this device and the server last agreed on and a fingerprint of it. A record whose
 * fingerprint changed is a local edit to send; a record missing locally but known to the server is a deletion.
 *
 * Every change is sent "based on version N". The server applies it only if it is still at N. If another device
 * got there first, nothing is overwritten:
 *   - long-form records (notes, sermons, studies, dictionary entries, plans, courses, lessons): the account's
 *     version is shown on this device and this device's version is kept in `conflicts` for the person to review
 *     (keep mine, keep theirs, or keep both);
 *   - short records (highlights, bookmarks, settings, progress): this device's newer choice is sent again on top.
 * "Synced" means the server confirmed every change.
 */
import type { RecordState, StudyDB, SyncConflict } from '../../db/db'

export const SYNCED = ['notes', 'highlights', 'bookmarks', 'dict', 'studies', 'sermons', 'folders', 'settings', 'plans', 'planProgress', 'courses', 'lessons', 'courseVersions', 'enrollments', 'attempts', 'submissions', 'attendance'] as const
export type Kind = (typeof SYNCED)[number]
export const LONG_FORM = new Set<string>(['notes', 'dict', 'studies', 'sermons', 'plans', 'courses', 'lessons'])
/** Fields that must be unique per person (one highlight per verse, one enrollment per course). */
const UNIQUE: Partial<Record<Kind, string>> = { highlights: 'key', bookmarks: 'key', enrollments: 'courseId' }
/** Settings that describe one device only. */
const DEVICE_ONLY_SETTINGS = new Set(['lastBackupAt', 'backupSnoozeUntil'])

export interface Change {
  kind: string
  id: string
  base: number
  deleted?: boolean
  data?: unknown
}
export interface PushResult {
  kind: string
  id: string
  status: 'ok' | 'conflict'
  version: number
  seq: number
  server?: { deleted: boolean; data: unknown }
}
export interface PulledRow {
  kind: string
  id: string
  version: number
  seq: number
  deleted: boolean
  data: unknown
}
export interface Remote {
  push(device: string, changes: Change[]): Promise<PushResult[]>
  pull(since: number, max: number): Promise<PulledRow[]>
}

/* ---------------- fingerprints ---------------- */

/** JSON with sorted keys, so the same record always gives the same text. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  const o = v as Record<string, unknown>
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}'
}
export function fingerprint(v: unknown): string {
  const s = canonical(v)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = Math.imul(h2 ^ c, 2246822519)
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36)
}

const keyOf = (kind: string, id: string) => `${kind}/${id}`
const pk = (kind: string) => (kind === 'settings' ? 'key' : 'id')
const idOf = (kind: string, r: Record<string, unknown>) => String(r[pk(kind)])
const syncable = (kind: string, r: Record<string, unknown>) => !(kind === 'settings' && DEVICE_ONLY_SETTINGS.has(String(r.key)))

/** A short readable name for a record, for the conflict list. */
export function labelOf(kind: string, r: Record<string, unknown> | null | undefined): string {
  if (!r) return kind
  const t = (r.title ?? r.term ?? r.name ?? r.ref ?? r.key ?? r.id) as string
  const names: Record<string, string> = { notes: 'Note', dict: 'Dictionary entry', studies: 'Study', sermons: 'Sermon', plans: 'Reading plan', courses: 'Course', lessons: 'Lesson' }
  return `${names[kind] ?? kind}: ${String(t).slice(0, 80)}`
}

/* ---------------- engine ---------------- */

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error' | 'conflict'

export interface SyncReport {
  pushed: number
  pulled: number
  conflicts: number
  pending: number
}

export class SyncEngine {
  private db: StudyDB
  private remote: Remote
  private device: string
  constructor(db: StudyDB, remote: Remote, device: string) {
    this.db = db
    this.remote = remote
    this.device = device
  }

  private table(kind: string) {
    return this.db.table(kind)
  }

  async cursor(): Promise<number> {
    return Number((await this.db.syncMeta.get('cursor'))?.value ?? 0)
  }

  /** Every local change not yet confirmed by the server. */
  async pending(): Promise<Change[]> {
    const states = new Map((await this.db.recordState.toArray()).map((s) => [s.key, s]))
    const out: Change[] = []
    for (const kind of SYNCED) {
      const seen = new Set<string>()
      for (const r of (await this.table(kind).toArray()) as Record<string, unknown>[]) {
        if (!syncable(kind, r)) continue
        const id = idOf(kind, r)
        const k = keyOf(kind, id)
        seen.add(k)
        const st = states.get(k)
        if (!st || st.hash !== fingerprint(r)) out.push({ kind, id, base: st?.version ?? 0, data: r })
      }
      for (const st of states.values()) if (st.kind === kind && !seen.has(st.key) && st.hash !== 'deleted') out.push({ kind, id: st.id, base: st.version, deleted: true })
    }
    return out
  }

  /** Put a server version into the local table (handling the one-per-verse / one-per-course rules). */
  private async applyLocal(kind: string, id: string, deleted: boolean, data: unknown) {
    const t = this.table(kind)
    if (deleted) {
      await t.delete(id)
      return
    }
    const u = UNIQUE[kind as Kind]
    if (u) {
      const value = (data as Record<string, unknown>)[u]
      const clash = (await t.where(u).equals(value as string).toArray()) as Record<string, unknown>[]
      // another device made the same verse's highlight (or course enrollment) under a different id: the account's copy is kept
      for (const c of clash) if (idOf(kind, c) !== id) await t.delete(idOf(kind, c))
    }
    await t.put(data)
  }

  private async setState(kind: string, id: string, version: number, data: unknown, deleted: boolean) {
    const s: RecordState = { key: keyOf(kind, id), kind, id, version, hash: deleted ? 'deleted' : fingerprint(data) }
    await this.db.recordState.put(s)
  }

  /** Another device changed this record first. Never discard: keep this device's version for review (long form) or re-send it (short). */
  private async conflict(kind: string, id: string, localData: unknown, localDeleted: boolean, server: { deleted: boolean; data: unknown }, serverVersion: number): Promise<boolean> {
    const same = localDeleted ? server.deleted : !server.deleted && fingerprint(localData) === fingerprint(server.data)
    if (same) {
      await this.setState(kind, id, serverVersion, server.data, server.deleted)
      return false
    }
    if (LONG_FORM.has(kind)) {
      const c: SyncConflict = {
        id: `${kind}/${id}/${serverVersion}/${Date.now()}`,
        kind,
        recordId: id,
        label: labelOf(kind, ((localDeleted ? server.data : localData) ?? server.data) as Record<string, unknown>),
        local: localDeleted ? null : localData,
        server: server.deleted ? null : server.data,
        serverVersion,
        at: Date.now(),
      }
      await this.db.transaction('rw', [this.db.conflicts, this.db.recordState, this.table(kind)], async () => {
        await this.db.conflicts.put(c)
        await this.applyLocal(kind, id, server.deleted, server.data)
        await this.setState(kind, id, serverVersion, server.data, server.deleted)
      })
      return true
    }
    // short records: keep this device's change, now based on the server's version, to send again
    await this.db.recordState.put({ key: keyOf(kind, id), kind, id, version: serverVersion, hash: server.deleted ? 'deleted' : fingerprint(server.data) })
    return false
  }

  /** Bring down changes from other devices. */
  async pullAll(): Promise<{ pulled: number; conflicts: number }> {
    let since = await this.cursor()
    let pulled = 0
    let conflicts = 0
    for (;;) {
      const rows = await this.remote.pull(since, 500)
      for (const row of rows) {
        const k = keyOf(row.kind, row.id)
        const st = await this.db.recordState.get(k)
        if (st && st.version >= row.version) continue // already have it
        const local = (await this.table(row.kind).get(row.id)) as Record<string, unknown> | undefined
        const dirty = st ? (local ? fingerprint(local) !== st.hash : st.hash !== 'deleted') : !!local && fingerprint(local) !== fingerprint(row.data)
        if (dirty) {
          if (await this.conflict(row.kind, row.id, local ?? null, !local, { deleted: row.deleted, data: row.data }, row.version)) conflicts++
        } else {
          await this.db.transaction('rw', [this.db.recordState, this.table(row.kind)], async () => {
            await this.applyLocal(row.kind, row.id, row.deleted, row.data)
            await this.setState(row.kind, row.id, row.version, row.data, row.deleted)
          })
        }
        pulled++
      }
      if (rows.length) {
        since = rows[rows.length - 1].seq
        await this.db.syncMeta.put({ key: 'cursor', value: since })
      }
      if (rows.length < 500) break
    }
    return { pulled, conflicts }
  }

  /** Send local changes, 100 at a time. Returns how many were confirmed. */
  async pushAll(): Promise<{ pushed: number; conflicts: number }> {
    const changes = await this.pending()
    let pushed = 0
    let conflicts = 0
    for (let i = 0; i < changes.length; i += 100) {
      const batch = changes.slice(i, i + 100)
      const results = await this.remote.push(
        this.device,
        batch.map((c) => ({ kind: c.kind, id: c.id, base: c.base, deleted: !!c.deleted, data: c.deleted ? undefined : c.data })),
      )
      for (const r of results) {
        const c = batch.find((x) => x.kind === r.kind && x.id === r.id)!
        if (r.status === 'ok') {
          await this.setState(r.kind, r.id, r.version, c.data, !!c.deleted)
          pushed++
        } else if (await this.conflict(r.kind, r.id, c.data ?? null, !!c.deleted, r.server!, r.version)) conflicts++
      }
    }
    return { pushed, conflicts }
  }

  /** One full round: changes from other devices first, then this device's changes, then a final check. */
  async syncOnce(): Promise<SyncReport> {
    const a = await this.pullAll()
    const b = await this.pushAll()
    // short records re-based on a newer server version go out again now
    const again = (await this.pending()).length ? await this.pushAll() : { pushed: 0, conflicts: 0 }
    return { pulled: a.pulled, pushed: b.pushed + again.pushed, conflicts: a.conflicts + b.conflicts + again.conflicts, pending: (await this.pending()).length }
  }
}
