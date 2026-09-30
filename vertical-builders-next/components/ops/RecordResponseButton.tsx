'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneIncoming } from 'lucide-react'
import { recordResponseAction } from '@/app/ops/actions/prospecting'

const CHANNELS = ['phone', 'website', 'email', 'walk_in', 'referral', 'other', 'unknown'] as const

/**
 * Records the FIRST inbound response for a mailed prospect. One response per
 * prospect (repeated calls do not inflate the funnel — the DB enforces it). The
 * channel is chosen explicitly; nothing is guessed.
 */
export default function RecordResponseButton({ prospectId }: { prospectId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<string>('phone')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    if (busy) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set('prospect_id', prospectId)
    form.set('channel', channel)
    if (note.trim()) form.set('note', note.trim())
    const res = await recordResponseAction({}, form)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not record the response.'); return }
    setDone(true); setOpen(false); router.refresh()
  }

  if (done) return <span className="ops-badge is-ok">Response recorded</span>

  if (!open) {
    return (
      <button className="ops-btn ops-btn-sm" onClick={() => setOpen(true)}>
        <PhoneIncoming aria-hidden="true" /> Record response
      </button>
    )
  }

  return (
    <div className="ops-response-form">
      <label className="ops-field">
        <span>Channel</span>
        <select value={channel} onChange={e => setChannel(e.target.value)}>
          {CHANNELS.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label className="ops-field">
        <span>Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. asked for a quote" />
      </label>
      <div className="ops-response-form-actions">
        <button className="ops-btn ops-btn-primary ops-btn-sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save response'}</button>
        <button className="ops-btn ops-btn-sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}
