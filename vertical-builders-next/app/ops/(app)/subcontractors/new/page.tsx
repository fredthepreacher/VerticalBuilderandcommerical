import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import VendorForm from '@/components/ops/VendorForm'

export const dynamic = 'force-dynamic'

export default async function NewVendorPage() {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const { data: templates } = await supabase
    .from('insurance_requirement_templates').select('id, name').eq('active', true).order('name')

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/subcontractors">Subcontractors</Link> / New</div>
          <h1>New subcontractor</h1>
          <p className="ops-sub">
            Create the company record first, then upload their certificate. Compliance starts
            tracking the moment coverage lines exist.
          </p>
        </div>
      </div>
      <div style={{ maxWidth: 820 }}>
        <VendorForm templates={(templates ?? []).map(t => ({ id: t.id as string, name: t.name as string }))} />
      </div>
    </>
  )
}
