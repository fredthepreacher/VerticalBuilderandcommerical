import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import CampaignForm from '@/components/ops/CampaignForm'

export const dynamic = 'force-dynamic'

export default async function NewCampaignPage() {
  const user = await requireUser()
  if (!user.can('prospectingManage')) {
    return <EmptyState title="You do not have access to this"
      message="Prospecting campaigns are limited to owner/admin and office roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }
  const supabase = createSupabaseServerClient()
  const { data: templates } = await supabase
    .from('estimate_proposal_templates').select('id, name').eq('active', true).is('archived_at', null).order('name')

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/prospecting/campaigns">Campaigns</Link> / New</div>
          <h1>New campaign</h1>
        </div>
      </div>
      <CampaignForm templates={(templates ?? []).map(t => ({ id: t.id as string, name: t.name as string }))} />
    </>
  )
}
