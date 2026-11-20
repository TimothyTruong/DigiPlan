import type { SupabaseClient } from '@supabase/supabase-js'
import type { Remote } from './engine'
import type { Rec } from './records'

/**
 * Supabase connection. URL + anon key are public by design (row-level security protects the data); they come
 * from build-time env vars. The service-role key must never appear in this app.
 */
/** Accept the base project URL even if pasted with /rest/v1/ or a trailing slash (a common copy-paste slip). */
export const normalizeSupabaseUrl = (u?: string) => u?.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '') || undefined
const SUPABASE_URL = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined)
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const cloudConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

let client: Promise<SupabaseClient> | undefined
/** Lazy: supabase-js is only downloaded when accounts are configured. */
export function getClient(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('Accounts are not configured'))
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'petal-auth' },
  })))
}

const PAGE = 1000

export function supabaseRemote(sb: SupabaseClient): Remote {
  return {
    async pull(since) {
      const out: Rec[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('records').select('kind,id,data,deleted,updated_at,rev').gt('rev', since).order('rev').range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        out.push(...(data as Rec[]))
        if (!data || data.length < PAGE) return out
      }
    },
    async push(recs) {
      const { data, error } = await sb.rpc('push_records', { rows: recs })
      if (error) throw new Error(error.message)
      return (data ?? []) as { kind: string; id: string; rev: number }[]
    },
  }
}
