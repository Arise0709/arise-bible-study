/**
 * Decode Robinson's Greek morphological codes (as used in the CrossWire KJV tagging).
 * Codes follow Maurice Robinson's published scheme; unknown parts are left out rather than guessed.
 */
const TENSE: Record<string, string> = { P: 'present', I: 'imperfect', F: 'future', A: 'aorist', R: 'perfect', L: 'pluperfect', X: 'no tense' }
const VOICE: Record<string, string> = {
  A: 'active', M: 'middle', P: 'passive', E: 'middle or passive', D: 'middle deponent', O: 'passive deponent',
  N: 'middle or passive deponent', Q: 'impersonal active', X: 'no voice',
}
const MOOD: Record<string, string> = { I: 'indicative', S: 'subjunctive', O: 'optative', M: 'imperative', N: 'infinitive', P: 'participle', R: 'imperative participle' }
const CASE: Record<string, string> = { N: 'nominative', G: 'genitive', D: 'dative', A: 'accusative', V: 'vocative' }
const NUM: Record<string, string> = { S: 'singular', P: 'plural' }
const GEN: Record<string, string> = { M: 'masculine', F: 'feminine', N: 'neuter' }
const PERSON: Record<string, string> = { '1': '1st person', '2': '2nd person', '3': '3rd person' }
const KIND: Record<string, string> = {
  N: 'noun', A: 'adjective', T: 'article', P: 'personal pronoun', R: 'relative pronoun', C: 'reciprocal pronoun',
  D: 'demonstrative pronoun', K: 'correlative pronoun', I: 'interrogative pronoun', X: 'indefinite pronoun',
  Q: 'correlative or interrogative pronoun', F: 'reflexive pronoun', S: 'possessive pronoun',
}
const SIMPLE: Record<string, string> = {
  ADV: 'adverb', CONJ: 'conjunction', PREP: 'preposition', PRT: 'particle', INJ: 'interjection', COND: 'conditional',
  HEB: 'Hebrew word', ARAM: 'Aramaic word', 'N-PRI': 'indeclinable proper noun', 'A-NUI': 'indeclinable numeral',
  'N-LI': 'indeclinable letter', 'N-OI': 'indeclinable noun', 'PRT-N': 'particle, negative', 'PRT-I': 'particle, interrogative',
  'ADV-I': 'adverb, interrogative', 'ADV-N': 'adverb, negative', 'ADV-C': 'adverb, comparative', 'ADV-S': 'adverb, superlative',
}

function cng(s: string): string[] {
  const out: string[] = []
  if (CASE[s[0]]) out.push(CASE[s[0]])
  if (NUM[s[1]]) out.push(NUM[s[1]])
  if (GEN[s[2]]) out.push(GEN[s[2]])
  return out
}

export function decodeRobinson(code: string): string | null {
  if (!code) return null
  if (SIMPLE[code]) return SIMPLE[code]
  const parts = code.split('-')
  const head = parts[0]
  if (head === 'V') {
    const tvm = parts[1] ?? ''
    let i = 0
    let second = false
    if (tvm[0] === '2') {
      second = true
      i = 1
    }
    const tense = TENSE[tvm[i]]
    const voice = VOICE[tvm[i + 1]]
    const mood = MOOD[tvm[i + 2]]
    const bits = ['verb', [second ? 'second' : '', tense].filter(Boolean).join(' '), voice, mood].filter(Boolean) as string[]
    const rest = parts[2]
    if (rest) {
      if (/^[123]/.test(rest)) {
        if (PERSON[rest[0]]) bits.push(PERSON[rest[0]])
        if (NUM[rest[1]]) bits.push(NUM[rest[1]])
      } else bits.push(...cng(rest))
    }
    return bits.join(', ')
  }
  if (KIND[head]) {
    const bits = [KIND[head]]
    const rest = parts[1] ?? ''
    if (/^[123]/.test(rest)) {
      bits.push(PERSON[rest[0]])
      bits.push(...cng(rest.slice(1)))
    } else bits.push(...cng(rest))
    if (parts[2] === 'C') bits.push('comparative')
    if (parts[2] === 'S') bits.push('superlative')
    return bits.join(', ')
  }
  return null
}

export function describeMorph(code: string): { label: string; decoded: string | null } {
  if (/^TH?\d+$/.test(code)) return { label: `Strong's Hebrew verb code ${code}`, decoded: null }
  return { label: `Robinson code ${code}`, decoded: decodeRobinson(code) }
}
