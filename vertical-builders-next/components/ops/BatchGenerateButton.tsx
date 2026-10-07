'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileStack } from 'lucide-react'

/**
 * Generates a batch's proposal PDFs chunk by chunk until none remain, showing
 * progress without freezing the browser. Fully resumable and idempotent: if the
 * page is closed at 37/60, clicking again does 38..60 and never re-renders an
 * item that already produced a document.
 */
export default function BatchGenerateButton({
  batchId, pending, total,
}: { batchId: string; pending: number; total: number }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(total - pending)
  const [failed, setFailed] = useState(0)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true); setError(null); setFailed(0)
    try {
      let guard = 0
      for (;;) {
        if (guard++ > 2000) { setError('Stopped after too many chunks — reload and continue.'); break }
        const res = await fetch('/api/ops/prospecting/production/generate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          processed?: number; generated?: number; failed?: number; remaining?: number; error?: string
        }
        if (!res.ok) { setError(data.error ?? 'Generation stopped on an error.'); break }
        setDone(d => d + (data.generated ?? 0))
        setFailed(f => f + (data.failed ?? 0))
        if ((data.remaining ?? 0) === 0 || (data.processed ?? 0) === 0) break
      }
      router.refresh()
    } catch {
      setError('The connection dropped. Click again to continue — nothing already generated is duplicated.')
    } finally {
      setRunning(false)
    }
  }

  if (pending === 0 && !running) {
    return <span className="ops-sub2">All proposals generated.</span>
  }

  return (
    <div>
      <button className="ops-btn ops-btn-primary" onClick={run} disabled={running}>
        <FileStack aria-hidden="true" /> {running ? `Generating… ${done}/${total}` : `Generate ${pending} proposal${pending === 1 ? '' : 's'}`}
      </button>
      {(running || done > 0 || failed > 0) && (
        <p className="ops-hint" style={{ marginTop: 6 }}>Generated {done} of {total}{failed > 0 ? ` · ${failed} failed (retryable)` : ''}</p>
      )}
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}
