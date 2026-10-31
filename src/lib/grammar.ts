/** Readable grammar from STEPBible's code expansions (TEHMC/TEGMC). */

/** Split "a; b (c; d); e" on semicolons outside brackets. */
function splitTop(s: string) {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ';' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  return [...out, cur].map((x) => x.trim()).filter(Boolean)
}

/**
 * STEPBible's expansion ("Function=Verb ; Stem=Qal (hence Action=Simple; Voice=Active); Form=Perfect ...") as readable text.
 * Beginner: "Verb, Qal (simple, active), Perfect (past/present, indicative), Third, Masculine, Singular". Advanced: every field.
 */
export function grammarText(expansion: string, level: 'beginner' | 'advanced') {
  const fields = splitTop(expansion)
    .map((f) => {
      const i = f.indexOf('=')
      return i < 0 ? null : [f.slice(0, i).trim(), f.slice(i + 1).trim()]
    })
    .filter((f): f is string[] => !!f)
  if (level === 'advanced') return fields.map(([k, v]) => `${k}: ${v}`).join('; ')
  return fields
    .filter(([k]) => /Function|Stem|Form|Tense|Voice|Mood|Case|Person|Gender|Number|State/.test(k))
    .map(([, v]) => v.replace(/\(hence ([^)]*)\)/, (_, inner: string) => `(${inner.split(';').map((x) => x.split('=')[1]?.trim().toLowerCase()).filter(Boolean).join(', ')})`))
    .join(', ')
}
