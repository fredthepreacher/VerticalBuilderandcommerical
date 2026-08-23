import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import LeadForm from '@/components/ops/LeadForm'
import { SERVICE_TYPES } from '@/lib/ops/constants'

export const dynamic = 'force-dynamic'

export default async function NewLeadPage() {
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
        <LeadForm
          staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
          serviceTypes={[...SERVICE_TYPES]}
        />
      </div>
    </>
  )
}
