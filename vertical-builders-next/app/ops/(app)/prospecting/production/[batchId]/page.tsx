import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { EmptyState } from '@/components/ops/EmptyState'
import { Badge } from '@/components/ops/StatusBadge'
import { formatDateTime } from '@/lib/ops/utils/dates'
import BatchGenerateButton from '@/components/ops/BatchGenerateButton'
import BatchLifecycleActions from '@/components/ops/BatchLifecycleActions'
import ReprintItemButton from '@/components/ops/ReprintItemButton'
import { loadMailBatch, loadMailBatchItems } from '@/lib/ops/prospecting/mail-batch-read'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  draft: 'neutral', generating: 'info', ready: 'ok', partial: 'warn',
  exported: 'info', printed: 'info', mailed: 'ok', cancelled: 'neutral', error: 'bad',
}
const ITEM_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  generated: 'ok', pending: 'neutral', generating: 'info', blocked: 'bad', failed: 'bad',
}

export default async function BatchDetailPage({ params }: { params: { batchId: string } }) {
  const user = await requireUser()
  if (!user.can('productionView')) {
    return <EmptyState title="You do not have access to this"
      message="The mail production center is limited to staff roles."
      actionLabel="Back" actionHref="/ops/prospecting" />
  }

  const supabase = createSupabaseServerClient()
  const batch = await loadMailBatch(supabase, params.batchId)
  if (!batch) notFound()

  const items = await loadMailBatchItems(supabase, params.batchId)
  const pending = items.filter(i => i.generationStatus === 'pending' || i.generationStatus === 'failed').length
  const generatable = items.filter(i => i.generationStatus !== 'blocked').length

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">
            <Link href="/ops/prospecting">Roof Prospecting</Link> / <Link href="/ops/prospecting/production">Production</Link> / Batch
          </div>
          <h1>{batch.name}</h1>
          <p className="ops-sub">
            <Badge tone={STATUS_TONE[batch.status] ?? 'neutral'}>{batch.status}</Badge>
            {batch.campaignName ? ` · ${batch.campaignName}` : ''}{batch.county ? ` · ${batch.county}` : ''}
            {' · '}created {formatDateTime(batch.createdAt)}
          </p>
        </div>
      </div>

      <div className="ops-card" style={{ marginBottom: 18 }}>
        <div className="ops-card-head"><h2>Production</h2></div>
        <div className="ops-card-body">
          <div className="ops-batch-summary">
            <span><strong>{batch.recordCount}</strong> records</span>
            <span className="is-ok"><strong>{batch.generatedCount}</strong> generated</span>
            <span className="is-bad"><strong>{batch.blockedCount}</strong> blocked</span>
            <span className="is-bad"><strong>{batch.failedCount}</strong> failed</span>
          </div>

          {batch.status !== 'cancelled' && user.can('proposalsGenerate') && generatable > 0 && (
            <div style={{ marginTop: 12 }}>
              <BatchGenerateButton batchId={batch.id} pending={pending} total={generatable} />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <BatchLifecycleActions
              batchId={batch.id}
              version={batch.batchVersion}
              status={batch.status}
              generatedCount={batch.generatedCount}
              canExport={user.can('mailBatchExport')}
              canMarkPrinted={user.can('markPrinted')}
              canMarkMailed={user.can('markMailed')}
              canCancel={user.can('mailBatchCreate')}
            />
          </div>

          <div className="ops-batch-stamps">
            {batch.exportedAt && <span>Exported {formatDateTime(batch.exportedAt)}</span>}
            {batch.printedAt && <span>Printed {formatDateTime(batch.printedAt)}</span>}
            {batch.mailedAt && <span>Mailed {formatDateTime(batch.mailedAt)}</span>}
          </div>
        </div>
      </div>

      <div className="ops-card">
        <div className="ops-card-head"><h2>Manifest</h2><span className="ops-sub2">{items.length} records</span></div>
        <div className="ops-table-wrap">
          <table className="ops-table ops-table-cards">
            <thead>
              <tr>
                <th>Recipient / property</th><th>Mailing address</th><th className="num">Final sq</th>
                <th className="num">Estimate</th><th>Proposal</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td className="ops-cell-primary" data-label="Recipient / property">
                    {it.recipientName ?? '—'}
                    <span className="ops-sub2">{it.propertyAddress ?? '—'}</span>
                  </td>
                  <td data-label="Mailing address">
                    {it.mailingAddress ?? '—'}
                    {it.mailingFallback && <span className="ops-badge is-warn" style={{ marginLeft: 6 }}>fallback</span>}
                  </td>
                  <td className="num" data-label="Final sq">{it.finalSquares ?? '—'}</td>
                  <td className="num" data-label="Estimate">{it.estimateTotalCents != null ? `$${(it.estimateTotalCents / 100).toFixed(2)}` : '—'}</td>
                  <td data-label="Proposal">
                    {it.documentId
                      ? <a href={`/api/documents/${it.documentId}/download`}>PDF</a>
                      : it.estimateId ? <Link href={`/ops/estimates/${it.estimateId}`}>Estimate</Link> : '—'}
                  </td>
                  <td data-label="Status">
                    <Badge tone={ITEM_TONE[it.generationStatus] ?? 'neutral'}>{it.generationStatus}</Badge>
                    {(it.blockReason || it.errorMessage) && (
                      <span className="ops-sub2">{it.blockReason ?? ''}{it.errorMessage ? ` — ${it.errorMessage}` : ''}</span>
                    )}
                  </td>
                  <td className="ops-actions" data-label="">
                    {batch.status !== 'cancelled' && user.can('proposalsGenerate') && (it.generationStatus === 'generated' || it.generationStatus === 'failed') && (
                      <ReprintItemButton batchId={batch.id} itemId={it.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
