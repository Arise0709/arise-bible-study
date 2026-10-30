/**
 * Appearance options: fonts, color themes, page tones, and line spacing.
 * Fonts load from Google Fonts only when chosen, so unused fonts cost nothing.
 */

export interface FontOption {
  id: string
  label: string
  stack: string
  google?: string // Google Fonts family spec, loaded on demand
  note?: string
}

export const SCRIPTURE_FONTS: FontOption[] = [
  { id: 'literata', label: 'Literata', stack: "'Literata', Georgia, serif", google: 'Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400', note: 'Default. A book serif made for long reading.' },
  { id: 'georgia', label: 'Georgia', stack: "Georgia, 'Times New Roman', serif", note: 'Classic, already on most devices.' },
  { id: 'garamond', label: 'EB Garamond', stack: "'EB Garamond', Garamond, Georgia, serif", google: 'EB+Garamond:ital,wght@0,400;0,600;1,400', note: 'Traditional Bible-printing feel.' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather', Georgia, serif", google: 'Merriweather:ital,wght@0,400;0,700;1,400', note: 'Sturdy and clear on screens.' },
  { id: 'sourceserif', label: 'Source Serif', stack: "'Source Serif 4', Georgia, serif", google: 'Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400' },
  { id: 'inter', label: 'Inter (sans-serif)', stack: "'Inter', system-ui, sans-serif", google: 'Inter:ital,wght@0,400;0,600;1,400', note: 'Clean and modern, close to the sermon manuscript font.' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', system-ui, sans-serif", google: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400', note: 'Designed for readers with low vision.' },
]

export const UI_FONTS: FontOption[] = [
  { id: 'inter', label: 'Inter', stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif", google: 'Inter:ital,wght@0,400;0,500;0,600;0,700;1,400', note: 'Default.' },
  { id: 'system', label: 'My device font', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", note: 'San Francisco on Apple devices, Segoe on Windows.' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: "'Atkinson Hyperlegible', system-ui, sans-serif", google: 'Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400' },
  { id: 'sourcesans', label: 'Source Sans', stack: "'Source Sans 3', system-ui, sans-serif", google: 'Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400' },
]

export const ACCENTS: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'teal', label: 'Teal', light: '#1f5f7a', dark: '#7cc0dc' },
  { id: 'gold', label: 'Arise gold', light: '#7f6410', dark: '#d9b85a' },
  { id: 'burgundy', label: 'Burgundy', light: '#8b2635', dark: '#e48a97' },
  { id: 'forest', label: 'Forest', light: '#2f6b3a', dark: '#8fd19b' },
  { id: 'royal', label: 'Royal purple', light: '#5b3d8f', dark: '#b9a2e6' },
  { id: 'slate', label: 'Slate', light: '#3d4f63', dark: '#a9bbcf' },
]

export const TONES: { id: string; label: string; swatch: string }[] = [
  { id: 'warm', label: 'Warm paper', swatch: '#f7f5f0' },
  { id: 'white', label: 'Clean white', swatch: '#ffffff' },
  { id: 'sepia', label: 'Sepia', swatch: '#f4ecd8' },
]

export const LINE_SPACING: { id: string; label: string; value: number }[] = [
  { id: 'compact', label: 'Compact', value: 1.5 },
  { id: 'normal', label: 'Normal', value: 1.75 },
  { id: 'relaxed', label: 'Relaxed', value: 2.05 },
]

const loaded = new Set<string>(['Literata', 'Inter'])

/** Adds a Google Fonts stylesheet for a font the first time it is chosen. */
export function ensureFont(f: FontOption | undefined) {
  if (!f?.google) return
  const family = f.google.split(':')[0]
  if (loaded.has(family.replace(/\+/g, ' '))) return
  loaded.add(family.replace(/\+/g, ' '))
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`
  document.head.appendChild(link)
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark'
  accent: string
  tone: string
  scriptureFont: string
  uiFont: string
  lineSpacing: string
  readerSize: number
  uiSize: number
}

/** Applies appearance settings to the document root. Returns a cleanup for the system-theme listener. */
export function applyAppearance(s: AppearanceSettings): () => void {
  const root = document.documentElement
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const setMode = () => {
    const dark = s.theme === 'dark' || (s.theme === 'system' && mq.matches)
    root.setAttribute('data-mode', dark ? 'dark' : 'light')
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', dark ? '#15181c' : '#1f5f7a')
  }
  if (s.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', s.theme)
  setMode()
  root.setAttribute('data-accent', s.accent)
  root.setAttribute('data-tone', s.tone)
  const sf = SCRIPTURE_FONTS.find((f) => f.id === s.scriptureFont) ?? SCRIPTURE_FONTS[0]
  const uf = UI_FONTS.find((f) => f.id === s.uiFont) ?? UI_FONTS[0]
  ensureFont(sf)
  ensureFont(uf)
  root.style.setProperty('--scripture-font', sf.stack)
  root.style.setProperty('--ui-font', uf.stack)
  root.style.setProperty('--reader-size', `${s.readerSize}px`)
  root.style.setProperty('--ui-size', `${s.uiSize}px`)
  root.style.setProperty('--reader-line', String(LINE_SPACING.find((l) => l.id === s.lineSpacing)?.value ?? 1.75))
  mq.addEventListener('change', setMode)
  return () => mq.removeEventListener('change', setMode)
}
