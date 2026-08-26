'use client'
import { createBrowserClient } from '@supabase/ssr'
import { requireSupabasePublicEnv } from './env'

/** Browser client — only used by the login form and sign-out button. */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = requireSupabasePublicEnv()
  return createBrowserClient(url, anonKey)
}
