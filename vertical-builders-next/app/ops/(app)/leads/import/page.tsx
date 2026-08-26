import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { formatDateTime } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import LeadImportWizard from '@/components/ops/LeadImportWizard'

export const dynamic = 'force-dynamic'

export default async function LeadImportPage() {
  const user = await requireUser()
  if (!user.can('leadsImport')) {
    return (
      <EmptyState
        title="You do not have access to this"
        message="Bulk importing leads is limited to owner/admin and office roles."
        actionLabel="Back to leads"
        actionHref="/ops/leads"
      />
    )
  }

  const supabase = createSupabaseServerClient()
  const [{ data: staff }, { data: history }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
    supabase.from('lead_import_jobs')
      .select('id, original_filename, total_rows, imported_rows, updated_rows, skipped_rows, failed_rows, status, created_at')
      .order('created_at', { ascending: false }).limit(8),
  ])

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/leads">Leads</Link> / Import</div>
          <h1>Import leads</h1>
          <p className="ops-sub">
            Bring in a list from a spreadsheet or another CRM. The file is checked before anything
            is saved, and duplicates are matched on email and phone — never on name alone.
          </p>
        </div>
      </div>

      <LeadImportWizard
        staff={(staff ?? []).map(s => ({
          id: s.id as string, label: (s.full_name as string) || (s.email as string),
        }))}
      />

      {(history ?? []).length > 0 && (
        <div className="ops-card" style={{ marginTop: 20 }}>
          <div className="ops-card-head"><h2>Recent imports</h2></div>
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>File</th><th>When</th><th className="num">Rows</th><th className="num">Imported</th>
                  <th className="num">Skipped</th><th className="num">Rejected</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {(history ?? []).map(job => (
                  <tr key={job.id}>
                    <td data-label="File" className="ops-cell-primary">{job.original_filename}</td>
                    <td data-label="When" className="nowrap">{formatDateTime(job.created_at)}</td>
                    <td data-label="Rows" className="num">{(job.total_rows as number).toLocaleString()}</td>
                    <td data-label="Imported" className="num">{(job.imported_rows as number).toLocaleString()}</td>
                    <td data-label="Skipped" className="num">{(job.skipped_rows as number).toLocaleString()}</td>
                    <td data-label="Rejected" className="num">{(job.failed_rows as number).toLocaleString()}</td>
                    <td data-label="Status">
                      <Badge tone={
                        job.status === 'completed' ? 'ok'
                        : job.status === 'completed_with_errors' ? 'warn'
                        : job.status === 'failed' ? 'bad' : 'neutral'
                      }>
                        {String(job.status).replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="ops-actions">
                      {(job.failed_rows as number) > 0 || (job.skipped_rows as number) > 0 ? (
                        <a className="ops-btn ops-btn-sm" href={`/api/leads/import/${job.id}?format=csv`}>
                          Errors
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
