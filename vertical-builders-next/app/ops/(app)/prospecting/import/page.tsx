import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import ProspectImportWizard from '@/components/ops/ProspectImportWizard'
import { listCampaigns } from '@/lib/ops/prospecting/campaigns'

export const dynamic = 'force-dynamic'

export default async function ProspectImportPage() {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Importing prospects is limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const supabase = createSupabaseServerClient()
  const campaigns = await listCampaigns(supabase)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting">Roof Prospecting</Link> / Import</div>
          <h1>Import county list</h1>
          <p className="ops-sub">
            Upload a county roofing-permit CSV. Addresses are cleaned and de-duplicated against existing
            prospects and CRM leads; nothing is deleted, and rows become prospects to screen — not leads.
          </p>
        </div>
      </div>
      <ProspectImportWizard
        campaigns={campaigns.map(c => ({ id: c.id, label: c.name, county: c.county, roofTypes: c.roof_types }))}
      />
    </>
  )
}
