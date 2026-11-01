/**
 * Classroom-style pronunciation guide for Hebrew and Greek words.
 *
 * Turns a transliteration into an English respelling ("agapáō" -> "ah-gah-PAH-oh") that the device's
 * English voice reads aloud. This is the familiar teaching pronunciation, not a recording of ancient
 * speech, and the app labels it as a guide.
 * Sources: Strong's own pronunciation (Hebrew entries), STEPBible transliterations (syllables and stress
 * for Hebrew forms), and the Greek transliteration's accent mark for stress.
 */

export interface Respelling {
  /** shown to the reader, stressed syllable in capitals */
  display: string
  /** read aloud (lower case, so voices never spell it out letter by letter) */
  speak: string
}

const DIGRAPHS: [RegExp, string][] = [
  [/^ou/, 'oo'],
  [/^ai/, 'eye'],
  [/^ei/, 'ay'],
  [/^oi/, 'oy'],
  [/^au/, 'ow'],
  [/^eu/, 'yoo'],
  [/^ui/, 'wee'],
]
const VOWEL: Record<string, string> = { a: 'ah', ā: 'ah', â: 'ah', e: 'eh', ē: 'ay', ê: 'ay', i: 'ee', ī: 'ee', î: 'ee', o: 'oh', ō: 'oh', ô: 'oh', u: 'oo', ū: 'oo', û: 'oo', y: 'oo' }
const CONS: [RegExp, string][] = [
  [/^ch/, 'kh'],
  [/^ph/, 'f'],
  [/^rh/, 'r'],
  [/^x/, 'ks'],
  [/^c/, 'k'],
  [/^q/, 'k'],
]

/** Respell one syllable or word of Latin-letter transliteration. */
function respellPart(s: string, hebrew = false): string {
  let out = ''
  let rest = s
  while (rest) {
    const d = DIGRAPHS.find(([re]) => re.test(rest))
    if (d) {
      out += d[1]
      rest = rest.slice(2)
      continue
    }
    const c = CONS.find(([re]) => re.test(rest))
    if (c) {
      out += c[1]
      rest = rest.replace(c[0], '')
      continue
    }
    const ch = rest[0]
    out += (hebrew && ch === 'y' ? undefined : VOWEL[ch]) ?? (/[a-z]/.test(ch) ? ch : '')
    rest = rest.slice(1)
  }
  return out
}

const isVowel = (c: string) => /[aāâeēêiīîoōôuūûy]/.test(c)

/** Split into syllables: each vowel (or vowel pair) with the consonants before it; closing consonants stay on the last syllable. */
function syllables(word: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  while (i < word.length) {
    const ch = word[i]
    if (isVowel(ch)) {
      const pair = word.slice(i, i + 2)
      const v = DIGRAPHS.some(([re]) => re.test(pair)) ? pair : ch
      cur += v
      i += v.length
      // one following consonant before another vowel starts the next syllable; two split between syllables
      let j = i
      while (j < word.length && !isVowel(word[j])) j++
      const cons = word.slice(i, j)
      if (j >= word.length) {
        cur += cons
        i = j
      } else if (cons.length >= 2 && !/^(ch|ph|th|sh|ts|ps|rh)$/.test(cons)) {
        cur += cons[0]
        i += 1
      }
      out.push(cur)
      cur = ''
    } else {
      cur += ch
      i++
    }
  }
  if (cur) out.length ? (out[out.length - 1] += cur) : out.push(cur)
  return out
}

const ACCENT = /[\u0300\u0301\u0302\u0342]/ // acute, grave, circumflex: the stressed syllable in Greek

/** Greek transliteration such as "agapáō" or "ēgapēsen". */
export function respellGreek(xlit: string): Respelling | null {
  const words = xlit.toLowerCase().normalize('NFD').split(/[\s-]+/).filter(Boolean)
  if (!words.length) return null
  const disp: string[] = []
  const spk: string[] = []
  for (const w of words) {
    // find which vowel carries the accent, then remove accents but keep long-vowel marks
    const chars = [...w]
    let stressAt = -1
    const clean: string[] = []
    for (const c of chars) {
      if (ACCENT.test(c)) stressAt = clean.length - 1
      else if (c === '̄') clean[clean.length - 1] = (clean[clean.length - 1] + c).normalize('NFC')
      else if (/\p{M}/u.test(c)) continue
      else clean.push(c)
    }
    const word = clean.join('').replace(/[^a-zāēīōū]/g, '')
    if (!word) continue
    const syl = syllables(word)
    let pos = 0
    const parts = syl.map((s) => {
      const start = pos
      pos += [...s].length
      const r = respellPart(s)
      return stressAt >= start && stressAt < pos && syl.length > 1 ? r.toUpperCase() : r
    })
    disp.push(parts.join('-'))
    spk.push(parts.join('-').toLowerCase())
  }
  return disp.length ? { display: disp.join(' '), speak: spk.join(' ') } : null
}

/** STEPBible Hebrew transliteration: "be./re.Shit", "ba.Ra'". Dots mark syllables and a capital marks the stressed one. */
export function respellHebrew(stepXlit: string): Respelling | null {
  const syl = stepXlit
    .replace(/'/g, '')
    .split(/[./\s-]+/)
    .filter(Boolean)
  if (!syl.length) return null
  // the last syllable with a capital letter is the stressed one
  let stress = -1
  syl.forEach((s, i) => /[A-Z]/.test(s) && (stress = i))
  const parts = syl.map((s, i) => {
    const r = respellPart(s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z]/g, ''), true)
    return i === stress && syl.length > 1 ? r.toUpperCase() : r
  })
  const display = parts.filter(Boolean).join('-')
  return display ? { display, speak: display.toLowerCase() } : null
}

/** Strong's own pronunciation for Hebrew entries, e.g. "ray-sheeth'" (the mark follows the stressed syllable). */
export function fromStrongsPron(pron: string): Respelling | null {
  // some entries give alternatives ("yaw-no'-akh or (with enclitic) ..."): use the first
  const first = pron.split(/\s+or\s+|[;,(]/)[0].trim().toLowerCase().replace(/[^a-z'\s-]/g, '')
  const syl = first.split(/[-\s]+/).filter(Boolean)
  if (!syl.length) return null
  const display = syl.map((s) => (s.endsWith("'") && syl.length > 1 ? s.slice(0, -1).toUpperCase() : s.replace(/'/g, ''))).join('-')
  return { display, speak: display.toLowerCase() }
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'

/** Read a respelling aloud with an English voice, a little slower than normal. */
export function speak(r: Respelling) {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(r.speak)
  u.lang = 'en-US'
  u.rate = 0.8
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('en'))
  if (voice) u.voice = voice
  synth.speak(u)
}
