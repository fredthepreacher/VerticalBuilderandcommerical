'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

/**
 * Bulk-converts APPROVED prospects → CRM leads + estimates, chunk by chunk until
 * done. Idempotent server-side (keyed on converted_lead_id / estimate_id), so a
 * retry after a partial failure never duplicates a lead or estimate.
 */
export default function ConvertApprovedButton({
  campaignId, batchId, pending,
}: { campaignId?: string | null; batchId?: string | null; pending: number }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [t, setT] = useState({ leads: 0, existing: 0, estimates: 0, blocked: 0, failed: 0, processed: 0 })
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true); setError(null); setT({ leads: 0, existing: 0, estimates: 0, blocked: 0, failed: 0, processed: 0 })
    try {
      let guard = 0
      for (;;) {
        if (guard++ > 1000) { setError('Stopped after too many chunks — reload and continue.'); break }
        const res = await fetch('/api/ops/prospecting/convert/chunk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaignId: campaignId ?? null, batchId: batchId ?? null, withEstimate: true }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          processed?: number; remaining?: number
          totals?: { leadsCreated: number; leadsExisting: number; estimatesCreated: number; blocked: number; failed: number }
          error?: string
        }
        if (!res.ok) { setError(data.error ?? 'Conversion stopped on an error.'); break }
        setT(prev => ({
          leads: prev.leads + (data.totals?.leadsCreated ?? 0),
          existing: prev.existing + (data.totals?.leadsExisting ?? 0),
          estimates: prev.estimates + (data.totals?.estimatesCreated ?? 0),
          blocked: prev.blocked + (data.totals?.blocked ?? 0),
          failed: prev.failed + (data.totals?.failed ?? 0),
          processed: prev.processed + (data.processed ?? 0),
        }))
        if ((data.remaining ?? 0) === 0 || (data.processed ?? 0) === 0) break
      }
      router.refresh()
    } catch {
      setError('The connection dropped. Click again to continue — nothing already created is duplicated.')
    } finally {
      setRunning(false)
    }
  }

  if (pending === 0) return <span className="ops-sub2">No approved prospects awaiting conversion.</span>

  return (
    <div>
      <button className="ops-btn ops-btn-primary" onClick={run} disabled={running}>
        <Sparkles aria-hidden="true" /> {running ? `Converting… ${t.processed}` : `Convert ${pending} approved → leads + estimates`}
      </button>
      {(t.processed > 0 || running) && (
        <p className="ops-hint" style={{ marginTop: 6 }}>
          Leads created {t.leads} · existing {t.existing} · estimates {t.estimates} · blocked {t.blocked} · failed {t.failed}
        </p>
      )}
      {t.blocked > 0 && <p className="ops-hint">Blocked = missing measurement or price book not configured. Those prospects show the reason and are safe to retry after fixing.</p>}
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}
