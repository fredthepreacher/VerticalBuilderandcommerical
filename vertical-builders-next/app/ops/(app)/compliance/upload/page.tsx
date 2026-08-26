import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import CertificateForm from '@/components/ops/CertificateForm'
import { EmptyState } from '@/components/ops/EmptyState'

export const dynamic = 'force-dynamic'

export default async function UploadCoiPage({
  searchParams,
}: {
  searchParams: { vendor?: string; replaces?: string }
}) {
  const user = await requireUser()
  if (!user.can('uploadDocuments')) {
    return (
      <EmptyState
        title="You do not have access to this"
        message="Uploading certificates requires an office, project manager, or admin role."
        actionLabel="Back to compliance"
        actionHref="/ops/compliance"
      />
    )
  }

  const supabase = createSupabaseServerClient()
  const [{ data: vendors }, { data: projects }] = await Promise.all([
    supabase.from('vendors').select('id, legal_name, dba').is('archived_at', null).order('legal_name'),
    supabase.from('projects').select('id, project_number, project_name')
      .is('archived_at', null).not('status', 'in', '("complete","cancelled")').order('project_number', { ascending: false }).limit(60),
  ])

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/compliance">Compliance</Link> / Upload COI</div>
          <h1>Add a certificate of insurance</h1>
          <p className="ops-sub">
            Enter the certificate once, line by line. Each coverage keeps its own carrier, policy
            number and expiration date, which is what makes renewal reminders and audit exports
            accurate.
          </p>
        </div>
      </div>

      {(vendors ?? []).length === 0 ? (
        <EmptyState
          title="No subcontractors yet"
          message="Create the subcontractor first, then come back and attach their certificate."
          actionLabel="Add a subcontractor"
          actionHref="/ops/subcontractors/new"
        />
      ) : (
        <div style={{ maxWidth: 1000 }}>
          <CertificateForm
            defaultVendorId={searchParams.vendor}
            replacesCertificateId={searchParams.replaces}
            vendors={(vendors ?? []).map(v => ({
              id: v.id as string,
              label: v.dba ? `${v.legal_name} (${v.dba})` : (v.legal_name as string),
            }))}
            projects={(projects ?? []).map(p => ({
              id: p.id as string,
              label: `${p.project_number} ${p.project_name}`,
            }))}
          />
        </div>
      )}
    </>
  )
}
