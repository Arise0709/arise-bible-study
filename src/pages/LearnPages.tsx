import { useEffect } from 'react'
import { PlansSection } from './PlanPages'

/** The Learn area: reading plans now, courses alongside them. Loads only when opened. */
export function LearnHome() {
  useEffect(() => {
    document.title = 'Learn · Arise Bible Study'
  }, [])
  return (
    <div className="page stack" style={{ maxWidth: 960 }}>
      <h1 style={{ margin: 0 }}>Learn</h1>
      <p className="muted" style={{ margin: 0 }}>
        Read the Word, study it, and grow in it. Your plans and progress are saved in this browser and included in your backups.
      </p>
      <PlansSection />
    </div>
  )
}
