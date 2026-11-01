import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { canSpeak, speak, type Respelling } from '../lib/pronounce'

/** The respelling with a speaker button that reads it aloud (classroom-style guide, not a recording). */
export function SayIt({ r, word }: { r: Respelling | null; word: string }) {
  const [able, setAble] = useState(false)
  useEffect(() => setAble(canSpeak()), [])
  if (!r) return <span className="muted">not available for this word</span>
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex', flexWrap: 'wrap' }} data-testid="say-it">
      <span>{r.display}</span>
      {able && (
        <button type="button" className="iconbtn tap-24" onClick={() => speak(r)} aria-label={`Hear ${word} pronounced: ${r.display}`} title="Hear it (pronunciation guide)">
          <Volume2 size={16} aria-hidden />
        </button>
      )}
      <span className="muted small">classroom pronunciation guide</span>
    </span>
  )
}
