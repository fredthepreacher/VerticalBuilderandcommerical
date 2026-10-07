'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, Printer, Mail, XCircle } from 'lucide-react'
import { markBatchPrintedAction, markBatchMailedAction, cancelBatchAction } from '@/app/ops/actions/prospecting'

/**
 * Batch lifecycle controls. Downloads (package/manifest) are plain links.
 * Printed / Mailed are explicit, confirmed human acts — never inferred from PDFs
 * existing (spec §16) — and carry the batch_version the operator saw so a
 * concurrent change is reported, not silently overwritten (spec §20).
 */
export default function BatchLifecycleActions({
  batchId, version, status, generatedCount, canExport, canMarkPrinted, canMarkMailed, canCancel,
}: {
  batchId: string
  version: number
  status: string
  generatedCount: number
  canExport: boolean
  canMarkPrinted: boolean
  canMarkMailed: boolean
  canCancel: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const hasDocs = generatedCount > 0
  const terminal = status === 'cancelled'

  async function run(kind: 'print' | 'mail' | 'cancel') {
    if (busy) return
    const confirmMsg = kind === 'print'
      ? 'Mark this batch as printed? This records who printed it and when.'
      : kind === 'mail'
        ? 'Mark this batch as mailed? Do this only after the pieces are actually in the mail.'
        : 'Cancel this batch? Generated proposals are kept, but the batch is closed and its prospects can be batched again.'
    if (!window.confirm(confirmMsg)) return

    setBusy(kind); setError(null)
    const form = new FormData()
    form.set('batch_id', batchId)
    form.set('expected_version', String(version))
    const fn = kind === 'print' ? markBatchPrintedAction : kind === 'mail' ? markBatchMailedAction : cancelBatchAction
    const res = await fn({}, form)
    setBusy(null)
    if (!res.ok) {
      setError(res.error ?? 'The action could not be completed.')
      if ((res.data as { conflict?: boolean } | undefined)?.conflict) router.refresh()
      return
    }
    router.refresh()
  }

  return (
    <div className="ops-batch-actions">
      {canExport && hasDocs && (
        <>
          <a className="ops-btn" href={`/api/ops/prospecting/production/${batchId}/package`}>
            <Download aria-hidden="true" /> Download package (PDFs + combined + manifest)
          </a>
          <a className="ops-btn" href={`/api/ops/prospecting/production/${batchId}/manifest`}>
            <FileText aria-hidden="true" /> Manifest (CSV)
          </a>
        </>
      )}
      {canMarkPrinted && hasDocs && !terminal && (
        <button className="ops-btn" onClick={() => run('print')} disabled={busy !== null}>
          <Printer aria-hidden="true" /> {busy === 'print' ? 'Marking…' : 'Mark printed'}
        </button>
      )}
      {canMarkMailed && hasDocs && !terminal && (
        <button className="ops-btn" onClick={() => run('mail')} disabled={busy !== null}>
          <Mail aria-hidden="true" /> {busy === 'mail' ? 'Marking…' : 'Mark mailed'}
        </button>
      )}
      {canCancel && !terminal && status !== 'mailed' && (
        <button className="ops-btn ops-btn-danger" onClick={() => run('cancel')} disabled={busy !== null}>
          <XCircle aria-hidden="true" /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel batch'}
        </button>
      )}
      {error && <p className="ops-error" style={{ flexBasis: '100%', margin: 0 }}>{error}</p>}
    </div>
  )
}
