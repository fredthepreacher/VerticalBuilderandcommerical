'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { addCampaignCostAction } from '@/app/ops/actions/prospecting'

const CATEGORIES = ['printing', 'postage', 'list_acquisition', 'measurement', 'geocoder', 'other'] as const

/**
 * Adds a manual campaign cost (printing, postage, list, …). Kept separate from
 * future provider-generated costs. Costs unlock cost-per-X and ROI; until a cost
 * exists those metrics read "Not configured", never $0.
 */
export default function AddCampaignCostForm({ campaignId }: { campaignId: string }) {
  const router = useRouter()
  const [category, setCategory] = useState<string>('postage')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy) return
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars < 0) { setError('Enter a valid amount.'); return }
    setBusy(true); setError(null)
    const form = new FormData()
    form.set('campaign_id', campaignId)
    form.set('category', category)
    form.set('amount', amount)
    if (note.trim()) form.set('note', note.trim())
    const res = await addCampaignCostAction({}, form)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not save the cost.'); return }
    setAmount(''); setNote(''); router.refresh()
  }

  return (
    <div className="ops-cost-form">
      <label className="ops-field ops-field-sm">
        <span>Category</span>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
      </label>
      <label className="ops-field ops-field-sm">
        <span>Amount ($)</span>
        <input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
      </label>
      <label className="ops-field">
        <span>Note (optional)</span>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} />
      </label>
      <button className="ops-btn ops-btn-sm" onClick={submit} disabled={busy}>
        <Plus aria-hidden="true" /> {busy ? 'Adding…' : 'Add cost'}
      </button>
      {error && <p className="ops-error" style={{ flexBasis: '100%' }}>{error}</p>}
    </div>
  )
}
