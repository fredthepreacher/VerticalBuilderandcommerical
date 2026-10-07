'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'

/**
 * Runs the FREE enrichment pass over a batch: start → chunk → chunk … until done.
 * No provider is called; this classifies permits and screens prospects from data
 * already imported. Resumable — if it stops, clicking again continues from where
 * it left off (only un-enriched prospects are processed).
 */
export default function EnrichBatchButton({ sourceBatchId, pending }: { sourceBatchId: string; pending: number }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(pending)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true); setError(null); setDone(0)
    try {
      const startRes = await fetch('/api/ops/prospecting/enrich/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceBatchId }),
      })
      const start = (await startRes.json().catch(() => ({}))) as { jobId?: string; total?: number; error?: string }
      if (!startRes.ok || !start.jobId) { setError(start.error ?? 'Could not start enrichment.'); return }
      setTotal(start.total ?? pending)

      let guard = 0
      for (;;) {
        if (guard++ > 1000) { setError('Stopped after too many chunks — reload and continue.'); break }
        const res = await fetch('/api/ops/prospecting/enrich/chunk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId: start.jobId, sourceBatchId }),
        })
        const data = (await res.json().catch(() => ({}))) as { chunk?: { processed: number }; remaining?: number; done?: boolean; error?: string }
        if (!res.ok) { setError(data.error ?? 'Enrichment stopped on an error.'); break }
        setDone(d => d + (data.chunk?.processed ?? 0))
        if (data.done || (data.remaining ?? 0) === 0) break
      }
      router.refresh()
    } catch {
      setError('The connection dropped. Click again to continue where it left off.')
    } finally {
      setRunning(false)
    }
  }

  if (pending === 0) {
    return <span className="ops-sub2">All prospects in this batch have been screened.</span>
  }

  return (
    <div>
      <button type="button" className="ops-btn ops-btn-primary" onClick={run} disabled={running}>
        <Sparkles aria-hidden="true" /> {running ? `Screening… ${done}/${total}` : `Run screening on ${pending} prospect${pending === 1 ? '' : 's'}`}
      </button>
      <p className="ops-hint" style={{ marginTop: 6 }}>
        Free — classifies permits and screens each prospect from imported data. No measurement provider is called.
      </p>
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}
