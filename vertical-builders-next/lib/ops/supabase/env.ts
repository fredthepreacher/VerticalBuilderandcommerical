/**
 * Environment access for the Supabase clients.
 *
 * These are read lazily at request time, never at module scope, so the public
 * marketing site still builds and deploys on a Vercel project where the CRM
 * environment variables have not been filled in yet.
 */

export interface SupabasePublicEnv {
  url: string
  anonKey: string
}

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const env = getSupabasePublicEnv()
  if (!env) {
    throw new Error(
      'Vertical Ops is not configured yet: set NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY. See docs/DEPLOYMENT.md.',
    )
  }
  return env
}

export function isOpsConfigured(): boolean {
  return getSupabasePublicEnv() !== null
}
