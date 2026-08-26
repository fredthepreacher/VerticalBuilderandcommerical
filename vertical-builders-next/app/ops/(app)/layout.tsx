import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Shell, { type ShellCounts, type ShellUser } from '@/components/ops/Shell'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { getSettings } from '@/lib/ops/services/settings'
import { OPEN_ESTIMATE_STATUSES, OPEN_LEAD_STAGES } from '@/lib/ops/types'
import { canViewCosts } from '@/lib/ops/auth/permissions'
import { isOpsAiConfigured } from '@/lib/ops/ai/provider'
import '../ops.css'

export const metadata: Metadata = {
  title: 'Vertical Ops — CRM + Compliance Center',
  robots: { index: false, follow: false },
}

// Never prerender the CRM: every page is per-user, per-session data.
export const dynamic = 'force-dynamic'

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  if (!isOpsConfigured()) redirect('/ops/login')

  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + settings.warning_window_days * 86_400_000)
    .toISOString().slice(0, 10)
  const past = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10)

  const [expiring, needsReview, openLeads, openEstimates, unpaidInvoices] = await Promise.all([
    supabase.from('insurance_policies')
      .select('id, insurance_certificates!inner(review_status)', { count: 'exact', head: true })
      .gte('expiration_date', past)
      .lte('expiration_date', horizon)
      .in('insurance_certificates.review_status', ['approved', 'needs_review']),
    supabase.from('insurance_certificates')
      .select('id', { count: 'exact', head: true }).eq('review_status', 'needs_review'),
    supabase.from('leads')
      .select('id', { count: 'exact', head: true })
      .in('pipeline_stage', OPEN_LEAD_STAGES).is('archived_at', null),
    supabase.from('estimates')
      .select('id', { count: 'exact', head: true })
      .in('status', OPEN_ESTIMATE_STATUSES).is('archived_at', null),
    supabase.from('invoices')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'partially_paid', 'overdue']),
  ])
  void today

  const shellUser: ShellUser = {
    name: user.profile.full_name || user.email.split('@')[0],
    email: user.email,
    role: user.role,
    initials: initials(user.profile.full_name || user.email),
  }

  const counts: ShellCounts = {
    expiring: expiring.count ?? 0,
    needsReview: needsReview.count ?? 0,
    openLeads: openLeads.count ?? 0,
    openEstimates: openEstimates.count ?? 0,
    unpaidInvoices: unpaidInvoices.count ?? 0,
  }

  // Resolved server-side. The drawer receives booleans, never a role it could
  // be tricked into re-interpreting, and never the key itself.
  const ai = {
    configured: isOpsAiConfigured(),
    enabled: settings.ai_copilot_enabled,
    canSeeFinancials: canViewCosts(user.role, settings) || user.can('invoicesView'),
    canWrite: user.can('writeRecords'),
  }

  return (
    <div className="ops">
      <Shell user={shellUser} counts={counts} ai={ai}>{children}</Shell>
    </div>
  )
}

function initials(source: string): string {
  const parts = source.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return 'VO'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
