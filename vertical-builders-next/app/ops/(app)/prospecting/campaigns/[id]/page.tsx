import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import CampaignForm from '@/components/ops/CampaignForm'
import { loadCampaign } from '@/lib/ops/prospecting/campaigns'

export const dynamic = 'force-dynamic'

export default async function EditCampaignPage({
  params, searchParams,
}: { params: { id: string }; searchParams: { saved?: string } }) {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Prospecting campaigns are limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const supabase = createSupabaseServerClient()
  const [campaign, { data: templates }] = await Promise.all([
    loadCampaign(supabase, params.id),
    supabase.from('estimate_proposal_templates').select('id, name').eq('active', true).is('archived_at', null).order('name'),
  ])
  if (!campaign) notFound()

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting/campaigns">Campaigns</Link> / {campaign.name}</div>
          <h1>{campaign.name}</h1>
        </div>
      </div>
      {searchParams.saved && <div className="ops-banner ok" role="status"><div>Campaign saved.</div></div>}
      <CampaignForm
        campaign={{
          id: campaign.id, name: campaign.name, county: campaign.county, data_source: campaign.data_source,
          roof_types: campaign.roof_types, permit_date_from: campaign.permit_date_from, permit_date_to: campaign.permit_date_to,
          min_roof_age_years: campaign.min_roof_age_years, waste_rule_type: campaign.waste_rule_type,
          waste_rule_value: campaign.waste_rule_value, waste_min_squares: campaign.waste_min_squares,
          pricebook_service_type: campaign.pricebook_service_type, proposal_template_id: campaign.proposal_template_id,
          default_batch_size: campaign.default_batch_size, mail_tag: campaign.mail_tag, active: campaign.active,
        }}
        templates={(templates ?? []).map(t => ({ id: t.id as string, name: t.name as string }))}
      />
    </>
  )
}
