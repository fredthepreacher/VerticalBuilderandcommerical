import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { requireSupabasePublicEnv } from './env'

/**
 * SERVICE-ROLE client. Bypasses RLS entirely.
 *
 * Only three flows are allowed to use it, and each one performs its own
 * authorisation check first:
 *   1. /api/public/leads          — inserts a validated lead from the website
 *   2. /api/uploads/coi           — accepts a vendor upload against a hashed token
 *   3. /api/cron/*                — the daily reminder job, gated by CRON_SECRET
 *   4. signed URL minting + audit package assembly, after requireUser()
 *
 * Never import this into a client component. `server-only` makes that a build
 * error rather than a runtime leak.
 */
export function createSupabaseAdminClient() {
  const { url } = requireSupabasePublicEnv()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. See docs/DEPLOYMENT.md.')
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export const PRIVATE_BUCKET = 'vertical-private-documents'
