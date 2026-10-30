/**
 * Keeping the user's data safe on this device: persistent storage, installing the app to the Home
 * Screen (which also exempts it from Safari's 7-day storage removal), and backup reminders.
 */
import { db, getSetting, setSetting } from '../db/db'
import { exportBackup } from '../db/backup'

export const BACKUP_REMIND_DAYS = 7
export const BACKUP_SNOOZE_DAYS = 3
const DAY = 86_400_000

/** Builds the backup file, starts the download, and records the time of this successful backup. */
export async function downloadBackup(): Promise<number> {
  const blob = await exportBackup()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `arise-bible-study-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  const at = Date.now()
  await setSetting('lastBackupAt', at)
  await setSetting('backupSnoozeUntil', 0)
  return at
}

export const getLastBackupAt = () => getSetting<number>('lastBackupAt', 0)

/** Number of things the user has created (notes, studies, sermons, highlights, bookmarks, dictionary entries). */
export async function userItemCount(): Promise<number> {
  const counts = await Promise.all([db.notes.count(), db.studies.count(), db.sermons.count(), db.highlights.count(), db.bookmarks.count(), db.dict.count()])
  return counts.reduce((a, b) => a + b, 0)
}

export function formatBackupAge(at: number, now = Date.now()): string {
  if (!at) return 'No backup downloaded yet'
  const days = Math.floor((now - at) / DAY)
  const date = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `Last backup: ${date} (${days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`})`
}

/** Whether the reminder should show: there is data, and no backup within the reminder window, and not snoozed. */
export function needsBackupReminder(items: number, lastAt: number, snoozeUntil: number, now = Date.now()): boolean {
  if (items === 0) return false
  if (snoozeUntil > now) return false
  return !lastAt || now - lastAt > BACKUP_REMIND_DAYS * DAY
}

export async function snoozeBackupReminder() {
  await setSetting('backupSnoozeUntil', Date.now() + BACKUP_SNOOZE_DAYS * DAY)
}

/* ---------------- persistent storage ---------------- */

export type PersistState = 'protected' | 'not-protected' | 'unsupported'

export async function persistenceState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported'
  return (await navigator.storage.persisted()) ? 'protected' : 'not-protected'
}

/** Asks the browser not to clear this site's storage. Some browsers decide silently; Firefox may ask. */
export async function requestPersistence(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported'
  try {
    localStorage.setItem('abs-persist-asked', String(Date.now()))
  } catch {
    /* ignore */
  }
  return (await navigator.storage.persist()) ? 'protected' : 'not-protected'
}

/** Once the user has data, ask for protection automatically (at most once every 30 days). */
export async function autoRequestPersistence(): Promise<void> {
  try {
    if ((await persistenceState()) !== 'not-protected') return
    if ((await userItemCount()) === 0) return
    const asked = Number(localStorage.getItem('abs-persist-asked') ?? 0)
    if (Date.now() - asked < 30 * DAY) return
    await requestPersistence()
  } catch {
    /* never block the app over this */
  }
}

/* ---------------- install to Home Screen ---------------- */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
let deferredInstall: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredInstall = e as InstallPromptEvent
    installListeners.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    deferredInstall = null
    installListeners.forEach((f) => f())
  })
}

export function onInstallChange(f: () => void): () => void {
  installListeners.add(f)
  return () => {
    installListeners.delete(f)
  }
}

export const canPromptInstall = () => !!deferredInstall

export async function promptInstall(): Promise<boolean> {
  if (!deferredInstall) return false
  await deferredInstall.prompt()
  const { outcome } = await deferredInstall.userChoice
  deferredInstall = null
  return outcome === 'accepted'
}

export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
