import 'server-only'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '../supabase/server'
import type { Profile, UserRole } from '../types'
import { assertCan, can, type Capability } from './permissions'

export interface SessionUser {
  id: string
  email: string
  profile: Profile
  role: UserRole
  can: (capability: Capability) => boolean
}

/**
 * The single entry point for "who is making this request".
 * Redirects to the login page when there is no valid session, and blocks
 * deactivated accounts. Every /ops page and every mutation calls this.
 */
export async function requireUser(): Promise<SessionUser> {
  const supabase = createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/ops/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle<Profile>()

  if (!profile) redirect('/ops/login?error=no-profile')
  if (!profile.active) redirect('/ops/login?error=deactivated')

  return {
    id: user.id,
    email: user.email ?? profile.email ?? '',
    profile,
    role: profile.role,
    can: (capability: Capability) => can(profile.role, capability),
  }
}

/** Same as requireUser but also enforces a capability. Use in server actions. */
export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser()
  assertCan(user.role, capability)
  return user
}

/** Returns null instead of redirecting — used by the login page itself. */
export async function getOptionalUser(): Promise<SessionUser | null> {
  try {
    const supabase = createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data: profile } = await supabase
      .from('profiles').select('*').eq('id', user.id).maybeSingle<Profile>()
    if (!profile || !profile.active) return null
    return {
      id: user.id,
      email: user.email ?? profile.email ?? '',
      profile,
      role: profile.role,
      can: (capability: Capability) => can(profile.role, capability),
    }
  } catch {
    return null
  }
}
