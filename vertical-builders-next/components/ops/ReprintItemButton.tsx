'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { regenerateItemAction } from '@/app/ops/actions/prospecting'

/**
 * Reprint / regenerate one proposal: queues a fresh PDF version WITHOUT creating
 * a new lead, estimate, or sales opportunity (spec §18). Run the generator again
 * to produce it. Reprinting a generated item bumps the document version; the
 * prior PDF is retained.
 */
export default function ReprintItemButton({ batchId, itemId }: { batchId: string; itemId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy) return
    if (!window.confirm('Queue a fresh proposal PDF for this record? No new lead or estimate is created.')) return
    setBusy(true)
    const form = new FormData()
    form.set('batch_id', batchId)
    form.set('item_id', itemId)
    await regenerateItemAction({}, form)
    setBusy(false)
    router.refresh()
  }

  return (
    <button className="ops-btn ops-btn-sm" onClick={run} disabled={busy} title="Reprint (new PDF version, no new opportunity)">
      <RefreshCw aria-hidden="true" /> {busy ? '…' : 'Reprint'}
    </button>
  )
}
