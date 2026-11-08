import { Suspense, lazy, useState } from 'react'
import { Share2 } from 'lucide-react'
import { cloudConfigured, maybeSignedIn } from '../lib/cloud/config'
import type { ShareSource } from '../pages/ChurchShare'

const ShareDialog = lazy(() => import('../pages/ChurchShare').then((m) => ({ default: m.ShareDialog })))

const inWorkspace = () => {
  try {
    return cloudConfigured() && maybeSignedIn() && localStorage.getItem('abs-has-orgs') === '1'
  } catch {
    return false
  }
}

/**
 * "Share a copy" with a church workspace. Shown only to signed-in members of a workspace; the sharing code loads
 * only when pressed. The copy is made from the item as it is at that moment; the original stays private.
 */
export function ShareCopyButton({ make, className = 'btn' }: { make: () => ShareSource; className?: string }) {
  const [source, setSource] = useState<ShareSource | null>(null)
  if (!inWorkspace()) return null
  return (
    <>
      <button className={className} onClick={() => setSource(make())} data-testid="share-copy">
        <Share2 size={15} aria-hidden /> Share a copy
      </button>
      {source && (
        <Suspense fallback={null}>
          <ShareDialog source={source} onClose={() => setSource(null)} />
        </Suspense>
      )}
    </>
  )
}
