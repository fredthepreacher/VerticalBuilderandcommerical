import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadPricebook } from '@/lib/ops/services/estimates'
import ProposalTemplateEditor from '@/components/ops/ProposalTemplateEditor'

export const dynamic = 'force-dynamic'

export default async function NewProposalTemplatePage() {
  const user = await requireUser()
  if (!user.can('pricebookManage')) notFound()

  const supabase = createSupabaseServerClient()
  const pricebook = await loadPricebook(supabase)

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/estimates/templates">Proposal templates</Link> / New
          </div>
          <h1>New proposal template</h1>
          <p className="ops-sub">
            Write the proposal once. Leave quantities and rates blank on anything you measure and
            price per job — you fill those in on the estimate itself.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 940 }}>
        <ProposalTemplateEditor pricebook={pricebook} />
      </div>
    </>
  )
}
