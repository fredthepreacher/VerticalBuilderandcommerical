import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { requireSupabasePublicEnv } from './env'

/**
 * Supabase client for React Server Components, server actions and route
 * handlers. Runs as the signed-in user, so every query is filtered by RLS.
 * This is the client the app should use by default.
 */
export function createSupabaseServerClient() {
  const { url, anonKey } = requireSupabasePublicEnv()
  const cookieStore = cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component — the session is refreshed by
          // middleware instead, so this is safe to ignore.
        }
      },
    },
  })
}
