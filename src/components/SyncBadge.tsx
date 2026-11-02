import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, RefreshCw } from 'lucide-react'
import { cloudConfigured, maybeSignedIn } from '../lib/cloud/config'
import type { CloudState } from '../lib/cloud/manager'

const TEXT: Record<CloudState['status'], string> = {
  local: 'Saved on this device',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Offline: saved on this device',
  error: 'Sync failed',
  conflict: 'Conflict detected',
}

/** Account and sync status in the top bar. Guests load none of the account code. */
export function SyncBadge() {
  const [s, setS] = useState<CloudState | null>(null)
  useEffect(() => {
    if (!cloudConfigured() || !maybeSignedIn()) return
    let off: (() => void) | undefined
    void import('../lib/cloud/manager').then((m) => {
      m.cloud()
      off = m.onCloudState(setS)
    })
    return () => off?.()
  }, [])
  if (!cloudConfigured()) return null
  const signedIn = !!s?.session
  const text = !signedIn ? 'Account and sync: not signed in' : `Account and sync: ${TEXT[s!.status]}`
  const Icon = !signedIn ? Cloud : s!.status === 'synced' ? CheckCircle2 : s!.status === 'syncing' ? RefreshCw : s!.status === 'offline' || s!.status === 'local' ? CloudOff : AlertTriangle
  return (
    <NavLink to="/account" className="iconbtn" aria-label={text} title={text} data-testid="sync-badge" data-status={signedIn ? s!.status : 'signed-out'}>
      <Icon size={20} aria-hidden className={signedIn && s!.status === 'syncing' ? 'spin' : undefined} />
    </NavLink>
  )
}
