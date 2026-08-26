import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { loadPricebook } from '@/lib/ops/services/estimates'
import { getSettings } from '@/lib/ops/services/settings'
import EstimateBuilder from '@/components/ops/EstimateBuilder'

export const dynamic = 'force-dynamic'

/**
 * A new estimate can start from nothing, from a client, or from a lead — in
 * which case the property and service details are carried across so nobody
 * retypes what the customer already told us.
 */
export default async function NewEstimatePage({
  searchParams,
}: {
  searchParams: { client?: string; lead?: string; project?: string }
}) {
  const user = await requireUser()
  if (!user.can('estimatesCreate')) notFound()

  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const [{ data: clients }, { data: staff }, pricebook] = await Promise.all([
    supabase.from('contacts').select('id, first_name, last_name, company_name')
      .is('archived_at', null).order('last_name').limit(500),
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
    loadPricebook(supabase),
  ])

  let prefill: Record<string, unknown> = {}

  if (searchParams.lead) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, first_name, last_name, service_type, property_address, city, state, zip, project_description, converted_contact_id')
      .eq('id', searchParams.lead).maybeSingle()
    if (lead) {
      prefill = {
        lead_id: lead.id,
        contact_id: lead.converted_contact_id,
        title: `${[lead.first_name, lead.last_name].filter(Boolean).join(' ')} — ${lead.service_type ?? 'Project'}`,
        service_type: lead.service_type,
        property_address: lead.property_address,
        city: lead.city,
        state: lead.state,
        zip: lead.zip,
        scope_summary: lead.project_description,
      }
    }
  } else if (searchParams.client) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, company_name, billing_address, city, state, zip')
      .eq('id', searchParams.client).maybeSingle()
    if (contact) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
        || (contact.company_name as string) || 'Client'
      prefill = {
        contact_id: contact.id,
        title: `${name} — estimate`,
        property_address: contact.billing_address,
        city: contact.city,
        state: contact.state,
        zip: contact.zip,
      }
    }
  } else if (searchParams.project) {
    const { data: project } = await supabase
      .from('projects')
      .select('id, project_name, customer_id, jobsite_address, city, state, zip, service_category, description')
      .eq('id', searchParams.project).maybeSingle()
    if (project) {
      prefill = {
        project_id: project.id,
        contact_id: project.customer_id,
        title: `${project.project_name} — change order`,
        service_type: project.service_category,
        property_address: project.jobsite_address,
        city: project.city,
        state: project.state,
        zip: project.zip,
      }
    }
  }

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/estimates">Estimates</Link> / New</div>
          <h1>New estimate</h1>
          <p className="ops-sub">
            Save the header first. Once it exists you can attach a roof measurement, add photos, and
            generate an AI draft against the pricebook.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 1000 }}>
        <EstimateBuilder
          estimate={prefill}
          clients={(clients ?? []).map(c => ({
            id: c.id as string,
            label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
          }))}
          staff={(staff ?? []).map(s => ({
            id: s.id as string, label: (s.full_name as string) || (s.email as string),
          }))}
          pricebook={pricebook}
          taxEnabled={settings.estimate_tax_enabled}
        />
      </div>
    </>
  )
}
