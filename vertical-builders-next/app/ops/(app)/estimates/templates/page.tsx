import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { listProposalTemplates } from '@/lib/ops/services/proposal-templates'
import { formatDate } from '@/lib/ops/utils/dates'
import { EmptyState } from '@/components/ops/EmptyState'
import TemplateRowActions from '@/components/ops/TemplateRowActions'

export const dynamic = 'force-dynamic'

/**
 * Proposal templates.
 *
 * Reusable proposal wording — what a tile roof proposal SAYS — kept separate
 * from the pricebook, which is what a square of tile costs.
 */
export default async function ProposalTemplatesPage({
  searchParams,
}: {
  searchParams: { show?: string }
}) {
  const user = await requireUser()
  if (!user.can('estimatesView')) notFound()

  const canManage = user.can('pricebookManage')
  const showArchived = searchParams.show === 'archived'

  const supabase = createSupabaseServerClient()
  const templates = await listProposalTemplates(supabase, { includeArchived: showArchived })
  const visible = showArchived ? templates.filter(t => t.archived_at) : templates

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/estimates">Estimates</Link> / Templates</div>
          <h1>Proposal templates</h1>
          <p className="ops-sub">
            The proposals you write again and again — tile roof, shingle roof, cleaning, repair.
            Save the wording once, then measure and price each job as you go.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link className="ops-btn" href={showArchived ? '/ops/estimates/templates' : '/ops/estimates/templates?show=archived'}>
            {showArchived ? 'Active templates' : 'Archived'}
          </Link>
          {canManage && (
            <Link href="/ops/estimates/templates/new" className="ops-btn ops-btn-primary">
              <Plus aria-hidden="true" /> New proposal template
            </Link>
          )}
        </div>
      </div>

      <div className="ops-card">
        {visible.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden="true" />}
            title={showArchived ? 'No archived templates' : 'No proposal templates yet'}
            message={
              showArchived
                ? 'Templates you archive are kept here. Estimates already built from them are unaffected.'
                : 'Build one from scratch, or open an estimate you are happy with and use “Save as proposal template”.'
            }
            actionLabel={canManage && !showArchived ? 'New proposal template' : undefined}
            actionHref={canManage && !showArchived ? '/ops/estimates/templates/new' : undefined}
          />
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Template</th><th>Service</th><th className="num">Lines</th>
                  <th>Updated</th><th />
                </tr>
              </thead>
              <tbody>
                {visible.map(template => (
                  <tr key={template.id}>
                    <td data-label="Template" className="ops-cell-primary">
                      {canManage ? (
                        <Link className="ops-row-link" href={`/ops/estimates/templates/${template.id}`}>
                          {template.name}
                        </Link>
                      ) : (
                        <span>{template.name}</span>
                      )}
                      {template.description && <span className="ops-sub2">{template.description}</span>}
                    </td>
                    <td data-label="Service">{template.service_type ?? 'Any'}</td>
                    <td data-label="Lines" className="num">{template.line_count}</td>
                    <td data-label="Updated" className="nowrap">{formatDate(template.updated_at)}</td>
                    <td className="ops-actions">
                      {canManage && (
                        <TemplateRowActions
                          templateId={template.id}
                          archived={Boolean(template.archived_at)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="ops-hint" style={{ marginTop: 14 }}>
        Applying a template copies its lines into that one estimate. Editing a template later never
        changes an estimate you have already built or sent.
      </p>
    </>
  )
}
