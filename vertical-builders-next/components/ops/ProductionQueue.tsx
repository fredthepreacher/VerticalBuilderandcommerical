'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PackagePlus, AlertTriangle } from 'lucide-react'
import { createMailBatchAction } from '@/app/ops/actions/prospecting'

/**
 * Production queue: pick reviewed, priced, estimate-ready prospects and turn a
 * selection (or the ready pool up to a configurable size) into a mail batch.
 * Only READY rows are selectable; blocked rows show their reason and cannot be
 * added — the operator sees exactly why (spec §3/§7). Creating is idempotent
 * server-side (unique per batch+prospect).
 */

export interface QueueRow {
  prospectId: string
  recipientName: string
  propertyAddress: string | null
  cityStateZip: string
  mailingAddress: string | null
  mailingFallback: boolean
  finalSquares: number | null
  estimateTotal: string
  code: string
  reason: string
  ready: boolean
}

const money = (v: string) => (v ? `$${v}` : '—')

export default function ProductionQueue({
  rows, campaignId, defaultBatchSize, canCreate,
}: {
  rows: QueueRow[]
  campaignId: string | null
  defaultBatchSize: number
  canCreate: boolean
}) {
  const router = useRouter()
  const readyRows = useMemo(() => rows.filter(r => r.ready), [rows])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName] = useState(defaultBatchName())
  const [limit, setLimit] = useState(String(defaultBatchSize || 60))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allReadySelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.prospectId))

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allReadySelected ? new Set() : new Set(readyRows.map(r => r.prospectId)))
  }

  async function create() {
    if (busy) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set('name', name.trim() || defaultBatchName())
    if (campaignId) form.set('campaign_id', campaignId)
    if (selected.size > 0) for (const id of selected) form.append('prospect_ids', id)
    if (limit) form.set('limit', limit)
    const res = await createMailBatchAction({}, form)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not create the batch.'); return }
    const batchId = (res.data as { batchId?: string } | undefined)?.batchId
    if (batchId) router.push(`/ops/prospecting/production/${batchId}`)
    else router.refresh()
  }

  const selectionLabel = selected.size > 0
    ? `${selected.size} selected`
    : `ready pool (up to ${limit || defaultBatchSize})`

  return (
    <div className="ops-card">
      <div className="ops-card-head">
        <h2>Ready for production</h2>
        <span className="ops-sub2">{readyRows.length} ready · {rows.length - readyRows.length} blocked</span>
      </div>
      <div className="ops-card-body">
        {canCreate && (
          <div className="ops-batch-create">
            <label className="ops-field">
              <span>Batch name</span>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={140} />
            </label>
            <label className="ops-field ops-field-sm">
              <span>Max size</span>
              <input type="number" min={1} max={1000} value={limit} onChange={e => setLimit(e.target.value)} />
            </label>
            <button className="ops-btn ops-btn-primary" onClick={create} disabled={busy || readyRows.length === 0}>
              <PackagePlus aria-hidden="true" /> {busy ? 'Creating…' : `Create batch — ${selectionLabel}`}
            </button>
          </div>
        )}
        {error && <p className="ops-error" style={{ marginTop: 8 }}>{error}</p>}
        <p className="ops-hint" style={{ marginTop: 8 }}>
          Leave rows unselected to batch the ready pool up to the max size, or tick specific rows.
          Blocked rows can’t be added and show the reason. A $0-priced estimate is never mailed.
        </p>

        <div className="ops-table-wrap" style={{ marginTop: 12 }}>
          <table className="ops-table ops-table-cards">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" aria-label="Select all ready" checked={allReadySelected}
                    onChange={toggleAll} disabled={readyRows.length === 0} />
                </th>
                <th>Recipient / property</th>
                <th>Mailing address</th>
                <th className="num">Final sq</th>
                <th className="num">Estimate</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.prospectId} className={r.ready ? '' : 'is-muted'}>
                  <td data-label="Select">
                    <input type="checkbox" aria-label={`Select ${r.recipientName}`}
                      checked={selected.has(r.prospectId)} disabled={!r.ready}
                      onChange={() => toggle(r.prospectId)} />
                  </td>
                  <td className="ops-cell-primary" data-label="Recipient / property">
                    {r.recipientName}
                    <span className="ops-sub2">{r.propertyAddress ?? '—'}{r.cityStateZip ? ` · ${r.cityStateZip}` : ''}</span>
                  </td>
                  <td data-label="Mailing address">
                    {r.mailingAddress ?? '—'}
                    {r.mailingFallback && <span className="ops-badge is-warn" style={{ marginLeft: 6 }}>fallback</span>}
                  </td>
                  <td className="num" data-label="Final sq">{r.finalSquares ?? '—'}</td>
                  <td className="num" data-label="Estimate">{money(r.estimateTotal)}</td>
                  <td data-label="Status">
                    {r.ready
                      ? <span className="ops-badge is-ok">Ready</span>
                      : <span className="ops-badge is-bad" title={r.reason}><AlertTriangle aria-hidden="true" style={{ width: 12, height: 12 }} /> {r.code}</span>}
                    {!r.ready && <span className="ops-sub2">{r.reason}</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6}><p className="ops-hint" style={{ margin: 8 }}>No candidates. Approve and convert prospects first — they appear here once an estimate is ready.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function defaultBatchName(): string {
  return `Mail batch ${new Date().toISOString().slice(0, 10)}`
}
