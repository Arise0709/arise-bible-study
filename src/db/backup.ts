import { db, TABLES } from './db'

export const BACKUP_FORMAT = 'arise-bible-study-backup'

export async function exportBackup(): Promise<Blob> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  const payload = { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), data }
  return new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' })
}

/** Merge a backup into the current database. Records with the same id are replaced. */
export async function importBackup(file: File): Promise<number> {
  let parsed: { format?: string; data?: Record<string, unknown[]> }
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not a valid backup (it is not JSON).')
  }
  if (parsed.format !== BACKUP_FORMAT || !parsed.data) throw new Error('That file is not an Arise Bible Study backup.')
  let count = 0
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      let rows = parsed.data?.[t]
      if (t === 'settings' && Array.isArray(rows)) rows = rows.filter((r) => !['lastBackupAt', 'backupSnoozeUntil'].includes((r as { key?: string })?.key ?? ''))
      if (Array.isArray(rows) && rows.length) {
        await db.table(t).bulkPut(rows)
        count += rows.length
      }
    }
  })
  return count
}
