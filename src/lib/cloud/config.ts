/**
 * Cloud accounts are optional and switched on only when the site is given a Supabase project
 * (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time). Without them the app works exactly as before.
 * The anon key is public by design; the database's row-level security protects every record.
 */
export const CLOUD_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || ''
export const CLOUD_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || ''
export const cloudConfigured = () => !!(CLOUD_URL && CLOUD_KEY)

/** True when this browser holds a saved sign-in, so the cloud code is worth loading at startup. */
export function maybeSignedIn(): boolean {
  try {
    return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
  } catch {
    return false
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('abs-device-id')
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) as string
      localStorage.setItem('abs-device-id', id)
    }
    return id
  } catch {
    return 'unknown-device'
  }
}
