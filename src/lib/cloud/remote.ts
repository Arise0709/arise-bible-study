import type { SupabaseClient } from '@supabase/supabase-js'
import type { Change, PulledRow, PushResult, Remote } from './sync'

/** The sync engine's server side: the sync_push and sync_pull database functions (see supabase/migrations). */
export function supabaseRemote(client: SupabaseClient): Remote {
  return {
    async push(device: string, changes: Change[]): Promise<PushResult[]> {
      const { data, error } = await client.rpc('sync_push', { device, changes })
      if (error) throw new Error(`The server did not accept the changes (${error.message}).`)
      return data as PushResult[]
    },
    async pull(since: number, max: number): Promise<PulledRow[]> {
      const { data, error } = await client.rpc('sync_pull', { since, max_rows: max })
      if (error) throw new Error(`Could not get changes from the server (${error.message}).`)
      return (data ?? []) as PulledRow[]
    },
  }
}
