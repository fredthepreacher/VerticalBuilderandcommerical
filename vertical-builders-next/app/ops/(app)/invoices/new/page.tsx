import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { getSettings } from '@/lib/ops/services/settings'
import type { EstimateLineItem } from '@/lib/ops/types'
import InvoiceBuilder, { type InvoiceLine } from '@/components/ops/InvoiceBuilder'

export const dynamic = 'force-dynamic'

/**
 * A new invoice, optionally seeded from an approved estimate so the lines the
 * customer already agreed to carry straight across.
 */
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: { project?: string; estimate?: string }
}) {
  const user = await requireUser()
  if (!user.can('invoicesCreate')) notFound()

  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const [{ data: projects }, { data: clients }] = await Promise.all([
    supabase.from('projects').select('id, project_number, project_name, customer_id')
      .is('archived_at', null).order('created_at', { ascending: false }).limit(300),
    supabase.from('contacts').select('id, first_name, last_name, company_name')
      .is('archived_at', null).order('last_name').limit(500),
  ])

  let seed: Parameters<typeof InvoiceBuilder>[0]['invoice'] = {
    project_id: searchParams.project,
    issue_date: new Date().toISOString().slice(0, 10),
  }

  if (searchParams.estimate) {
    const { data: estimate } = await supabase
      .from('estimates')
      .select('*, estimate_line_items(*)')
      .eq('id', searchParams.estimate)
      .maybeSingle()

    if (estimate) {
      const lines = ((estimate.estimate_line_items ?? []) as EstimateLineItem[])
        .sort((a, b) => a.sort_order - b.sort_order)

      const items: InvoiceLine[] = lines.map((line, index) => ({
        key: index + 1,
        description: line.description,
        quantity: String(line.quantity),
        unit: line.unit,
        unitPrice: line.unit_price_cents ? String(line.unit_price_cents / 100) : '',
        estimateLineItemId: line.id,
      }))

      seed = {
        project_id: (estimate.converted_project_id as string) ?? (estimate.project_id as string) ?? searchParams.project,
        contact_id: estimate.contact_id as string | null,
        estimate_id: estimate.id as string,
        issue_date: new Date().toISOString().slice(0, 10),
        discount_cents: estimate.discount_cents as number,
        tax_percent: estimate.tax_percent as number,
        customer_message: estimate.customer_notes as string | null,
        items: items.length > 0 ? items : undefined,
      }
    }
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/invoices">Invoices</Link> / New</div>
          <h1>New invoice</h1>
          <p className="ops-sub">
            {searchParams.estimate
              ? 'Lines carried across from the estimate. Edit anything that changed on site before sending.'
              : 'An invoice belongs to a job — that is what ties the money to the work.'}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1000 }}>
        <InvoiceBuilder
          invoice={seed}
          projects={(projects ?? []).map(p => ({
            id: p.id as string,
            label: `${p.project_number} · ${p.project_name}`,
            contactId: p.customer_id as string | null,
          }))}
          clients={(clients ?? []).map(c => ({
            id: c.id as string,
            label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
          }))}
          taxEnabled={settings.estimate_tax_enabled}
        />
      </div>
    </>
  )
}
