import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadPricebook } from '@/lib/ops/services/estimates'
import { loadProposalTemplate } from '@/lib/ops/services/proposal-templates'
import ProposalTemplateEditor, { type TemplateLineValues } from '@/components/ops/ProposalTemplateEditor'

export const dynamic = 'force-dynamic'

export default async function EditProposalTemplatePage({ params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user.can('pricebookManage')) notFound()

  const supabase = createSupabaseServerClient()
  const [template, pricebook] = await Promise.all([
    loadProposalTemplate(supabase, params.id),
    loadPricebook(supabase),
  ])
  if (!template) notFound()

  const lines: TemplateLineValues[] = template.lines.map((line, index) => ({
    key: index + 1,
    id: line.id,
    category: line.category ?? '',
    description: line.description,
    unit: line.unit,
    // Null renders as an empty box, not as "0" — a blank rate on a template
    // means "price it when you measure the job".
    defaultQuantity: line.default_quantity === null ? '' : String(line.default_quantity),
    defaultRate: line.default_unit_price_cents === null ? '' : String(line.default_unit_price_cents / 100),
    pricebookItemId: line.pricebook_item_id ?? '',
    notes: line.notes ?? '',
  }))

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/estimates/templates">Proposal templates</Link> / {template.name}
          </div>
          <h1>{template.name}</h1>
          <p className="ops-sub">
            {template.archived_at
              ? 'This template is archived and does not appear in the picker. Estimates built from it are unaffected.'
              : 'Changes here affect future estimates only. Anything already built keeps its own copy of these lines.'}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 940 }}>
        <ProposalTemplateEditor
          template={{
            id: template.id,
            name: template.name,
            description: template.description,
            service_type: template.service_type,
            scope_summary: template.scope_summary,
            customer_notes: template.customer_notes,
            lines,
          }}
          pricebook={pricebook}
        />
      </div>
    </>
  )
}
