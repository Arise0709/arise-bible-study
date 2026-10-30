import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useLocation } from 'react-router-dom'
import { Download, HardDrive, ShieldCheck, ShieldAlert, Smartphone } from 'lucide-react'
import { db } from '../db/db'
import {
  canPromptInstall, downloadBackup, formatBackupAge, isIOS, isInstalled, needsBackupReminder, onInstallChange, persistenceState, promptInstall,
  requestPersistence, snoozeBackupReminder, userItemCount, type PersistState,
} from '../lib/dataSafety'
import { toast } from './ui'

function useBackupInfo() {
  const lastAt = useLiveQuery(() => db.settings.get('lastBackupAt').then((s) => (s?.value as number) ?? 0), []) ?? 0
  const snoozeUntil = useLiveQuery(() => db.settings.get('backupSnoozeUntil').then((s) => (s?.value as number) ?? 0), []) ?? 0
  const items = useLiveQuery(() => userItemCount(), []) ?? 0
  return { lastAt, snoozeUntil, items }
}

/** App-wide reminder when there is unbacked-up work. Hidden in the teaching view and print. */
export function BackupReminder() {
  const { lastAt, snoozeUntil, items } = useBackupInfo()
  const loc = useLocation()
  if (/\/teach/.test(loc.pathname) || loc.pathname === '/settings') return null
  if (!needsBackupReminder(items, lastAt, snoozeUntil)) return null
  return (
    <div className="notice warn no-print backup-reminder" role="status" style={{ borderRadius: 0, margin: 0, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <HardDrive size={16} aria-hidden />
      <span>
        <strong>{formatBackupAge(lastAt)}.</strong> Your notes and sermons are stored only in this browser. Download a backup to keep them safe.
      </span>
      <span className="spacer" />
      <button
        className="btn sm primary"
        onClick={async () => {
          await downloadBackup()
          toast('Backup downloaded')
        }}
      >
        <Download size={14} /> Download backup
      </button>
      <button className="btn sm" onClick={() => snoozeBackupReminder()}>
        Remind me later
      </button>
    </div>
  )
}

/** Settings card: storage protection, installing the app, and the last backup date. */
export function DataProtectionStatus() {
  const { lastAt } = useBackupInfo()
  const [persist, setPersist] = useState<PersistState | null>(null)
  const [installable, setInstallable] = useState(canPromptInstall())
  const installed = isInstalled()
  useEffect(() => {
    persistenceState().then(setPersist)
    return onInstallChange(() => setInstallable(canPromptInstall()))
  }, [])
  return (
    <div className="stack">
      <div className="row" data-testid="last-backup">
        <HardDrive size={16} aria-hidden /> <strong>{formatBackupAge(lastAt)}</strong>
      </div>
      <div className="row" data-testid="storage-protection">
        {persist === 'protected' ? <ShieldCheck size={16} color="var(--ok)" aria-hidden /> : <ShieldAlert size={16} color="var(--warn)" aria-hidden />}
        <span>
          {persist === 'protected' && 'Storage protection is on. This browser will not clear your data to save space.'}
          {persist === 'not-protected' && 'Storage protection is off. The browser may clear this data when space runs low.'}
          {persist === 'unsupported' && 'This browser does not offer storage protection. Keep regular backups.'}
          {persist === null && 'Checking storage protection…'}
        </span>
        {persist === 'not-protected' && (
          <button
            className="btn sm"
            onClick={async () => {
              const r = await requestPersistence()
              setPersist(r)
              toast(r === 'protected' ? 'Storage protection turned on' : 'The browser did not allow protection yet. Installing the app usually helps.')
            }}
          >
            Turn on protection
          </button>
        )}
      </div>
      <div className="row" data-testid="install-status">
        <Smartphone size={16} aria-hidden />
        {installed ? (
          <span>Installed as an app on this device.</span>
        ) : installable ? (
          <>
            <span>Install the app for one-tap access and safer storage.</span>
            <button
              className="btn sm"
              onClick={async () => {
                if (await promptInstall()) toast('Installed')
              }}
            >
              Install app
            </button>
          </>
        ) : isIOS() ? (
          <span>
            On iPhone or iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Safari can erase website data after 7 days without a
            visit, but apps added to the Home Screen are exempt.
          </span>
        ) : (
          <span>To install, use your browser menu and choose “Install app” or “Add to Home Screen”.</span>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Backups contain your notes, highlights, bookmarks, studies, sermons, folders, dictionary entries, and settings. They do not include the AI access
        code. <Link to="/sources">Bible data</Link> is part of the app and is not in backups.
      </p>
    </div>
  )
}
