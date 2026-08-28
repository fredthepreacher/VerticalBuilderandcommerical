import 'server-only'
import { formatAddressLine } from '../imports/address'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Global search (Cmd/Ctrl+K).
 *
 * Categorised, deliberately shallow: it looks in the fields the office actually
 * types into a search box — a name, a phone number, a policy number, a project
 * number — and returns a handful of each rather than a ranked mega-list.
 */

export interface SearchHit {
  id: string
  category: 'Leads' | 'Contacts' | 'Projects' | 'Subcontractors' | 'Policies' | 'Documents'
  title: string
  subtitle: string
  href: string
}

const PER_CATEGORY = 6

function like(term: string): string {
  // Escape PostgREST wildcard characters so a stray % does not match everything.
  return `%${term.replace(/[%_,()]/g, ' ').trim()}%`
}

export async function globalSearch(supabase: SupabaseClient, rawTerm: string): Promise<SearchHit[]> {
  const term = rawTerm.trim()
  if (term.length < 2) return []
  const pattern = like(term)
  const hits: SearchHit[] = []

  const [leads, contacts, projects, vendors, policies, documents] = await Promise.all([
    supabase.from('leads')
      .select('id, first_name, last_name, company_name, email, phone, property_address, city, state, zip, stop_number, import_batch_tag, service_type, record_type')
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},company_name.ilike.${pattern},` +
        `email.ilike.${pattern},phone.ilike.${pattern},property_address.ilike.${pattern},` +
        `city.ilike.${pattern},zip.ilike.${pattern},stop_number.ilike.${pattern},` +
        `import_batch_tag.ilike.${pattern}`,
      )
      .is('archived_at', null).limit(PER_CATEGORY),
    supabase.from('contacts')
      .select('id, first_name, last_name, company_name, email, phone, city')
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},company_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},billing_address.ilike.${pattern}`)
      .is('archived_at', null).limit(PER_CATEGORY),
    supabase.from('projects')
      .select('id, project_number, project_name, jobsite_address, city, status')
      .or(`project_number.ilike.${pattern},project_name.ilike.${pattern},jobsite_address.ilike.${pattern},permit_number.ilike.${pattern}`)
      .is('archived_at', null).limit(PER_CATEGORY),
    supabase.from('vendors')
      .select('id, legal_name, dba, primary_trade, license_number, compliance_status')
      .or(`legal_name.ilike.${pattern},dba.ilike.${pattern},primary_trade.ilike.${pattern},license_number.ilike.${pattern},email.ilike.${pattern}`)
      .is('archived_at', null).limit(PER_CATEGORY),
    supabase.from('insurance_policies')
      .select('id, policy_number, carrier, coverage_type, expiration_date, insurance_certificates!inner(vendor_id, vendors!inner(legal_name))')
      .or(`policy_number.ilike.${pattern},carrier.ilike.${pattern}`)
      .limit(PER_CATEGORY),
    supabase.from('documents')
      .select('id, original_filename, document_type, entity_type, entity_id')
      .ilike('original_filename', pattern)
      .is('archived_at', null).limit(PER_CATEGORY),
  ])

  for (const r of leads.data ?? []) {
    // A property prospect has no name, so the address is the title. A blank
    // search result is indistinguishable from a broken one.
    const address = formatAddressLine(r as {
      property_address?: string | null; city?: string | null; state?: string | null; zip?: string | null
    })
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.company_name as string | null)
    hits.push({
      id: r.id, category: 'Leads',
      title: name || address || 'Unnamed lead',
      subtitle: [
        r.record_type === 'property_prospect' ? 'Property prospect' : null,
        name ? address : null,
        r.service_type, r.phone,
        r.stop_number ? `Stop ${r.stop_number}` : null,
        r.import_batch_tag,
      ].filter(Boolean).join(' · '),
      href: `/ops/leads/${r.id}`,
    })
  }
  for (const r of contacts.data ?? []) {
    hits.push({
      id: r.id, category: 'Contacts',
      title: [r.first_name, r.last_name].filter(Boolean).join(' ') || (r.company_name as string) || 'Contact',
      subtitle: [r.company_name, r.city, r.phone].filter(Boolean).join(' · '),
      href: `/ops/contacts/${r.id}`,
    })
  }
  for (const r of projects.data ?? []) {
    hits.push({
      id: r.id, category: 'Projects',
      title: `${r.project_number} — ${r.project_name}`,
      subtitle: [r.jobsite_address, r.city, r.status].filter(Boolean).join(' · '),
      href: `/ops/projects/${r.id}`,
    })
  }
  for (const r of vendors.data ?? []) {
    hits.push({
      id: r.id, category: 'Subcontractors',
      title: (r.dba as string) ? `${r.legal_name} (${r.dba})` : (r.legal_name as string),
      subtitle: [r.primary_trade, r.license_number, r.compliance_status].filter(Boolean).join(' · '),
      href: `/ops/subcontractors/${r.id}`,
    })
  }
  for (const r of (policies.data ?? []) as unknown as RawPolicyHit[]) {
    const vendor = r.insurance_certificates?.vendors
    hits.push({
      id: r.id, category: 'Policies',
      title: `${r.policy_number ?? 'Policy'} — ${r.carrier ?? 'Carrier not recorded'}`,
      subtitle: [vendor?.legal_name, r.coverage_type, r.expiration_date && `expires ${r.expiration_date}`]
        .filter(Boolean).join(' · '),
      href: r.insurance_certificates?.vendor_id
        ? `/ops/subcontractors/${r.insurance_certificates.vendor_id}?tab=insurance`
        : '/ops/compliance',
    })
  }
  for (const r of documents.data ?? []) {
    hits.push({
      id: r.id, category: 'Documents',
      title: r.original_filename as string,
      subtitle: [r.document_type, r.entity_type].filter(Boolean).join(' · '),
      href: `/ops/documents?q=${encodeURIComponent(term)}`,
    })
  }

  return hits
}

interface RawPolicyHit {
  id: string
  policy_number: string | null
  carrier: string | null
  coverage_type: string
  expiration_date: string | null
  insurance_certificates: { vendor_id: string; vendors: { legal_name: string } | null } | null
}
