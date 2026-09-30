import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { listCampaigns } from '@/lib/ops/prospecting/campaigns'

export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Prospecting campaigns are limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const supabase = createSupabaseServerClient()
  const campaigns = await listCampaigns(supabase, { includeInactive: true })

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Campaigns</div>
          <h1>Campaigns</h1>
          <p className="ops-sub">Reusable per-county configuration: roof-type filter, permit window, waste rule, pricing and mail tag.</p>
        </div>
        <div className="ops-page-actions">
          <Link className="ops-btn ops-btn-primary" href="/ops/prospecting/campaigns/new"><Plus aria-hidden="true" /> New campaign</Link>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet"
          message="Create a campaign to define how a county's permit data is filtered, priced and mailed."
          actionLabel="New campaign" actionHref="/ops/prospecting/campaigns/new" />
      ) : (
        <div className="ops-card">
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead><tr><th>Campaign</th><th>County</th><th>Roof types</th><th>Batch</th><th>Status</th><th /></tr></thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td data-label="Campaign" className="ops-cell-primary">{c.name}{c.mail_tag && <span className="ops-sub2">{c.mail_tag}</span>}</td>
                    <td data-label="County">{c.county ?? '—'}</td>
                    <td data-label="Roof types">{c.roof_types.length ? c.roof_types.join(', ') : 'All'}</td>
                    <td data-label="Batch">{c.default_batch_size}</td>
                    <td data-label="Status"><Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="ops-actions"><Link className="ops-btn ops-btn-sm" href={`/ops/prospecting/campaigns/${c.id}`}>Edit</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
