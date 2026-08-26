import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import NewLeadWithAi from '@/components/ops/NewLeadWithAi'
import type { LeadFormValues } from '@/components/ops/LeadForm'
import { SERVICE_TYPES } from '@/lib/ops/constants'
import { isOpsAiConfigured } from '@/lib/ops/ai/provider'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const { data: staff } = await supabase
    .from('profiles').select('id, full_name, email').eq('active', true).order('full_name')

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/leads">Leads</Link> / New</div>
          <h1>New lead</h1>
          <p className="ops-sub">Use this for phone calls and walk-ins. Website enquiries create themselves.</p>
        </div>
      </div>
      <div style={{ maxWidth: 780 }}>
        <NewLeadWithAi
          staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
          serviceTypes={[...SERVICE_TYPES]}
          aiConfigured={isOpsAiConfigured()}
          initial={prefillFromQuery(searchParams)}
        />
      </div>
    </>
  )
}

/**
 * A Copilot lead proposal links here with the fields in the query string.
 * Read defensively: this is a URL, so treat every value as untrusted text and
 * only accept keys the form actually has.
 */
const PREFILL_KEYS = [
  'first_name', 'last_name', 'company_name', 'email', 'phone', 'customer_type',
  'service_type', 'property_address', 'city', 'state', 'zip',
  'project_description', 'timeline',
] as const

function prefillFromQuery(
  params: Record<string, string | string[] | undefined>,
): LeadFormValues | undefined {
  const values: Record<string, string> = {}
  for (const key of PREFILL_KEYS) {
    const raw = params[key]
    const value = Array.isArray(raw) ? raw[0] : raw
    if (typeof value === 'string' && value.trim()) values[key] = value.slice(0, 500)
  }
  return Object.keys(values).length ? (values as LeadFormValues) : undefined
}
