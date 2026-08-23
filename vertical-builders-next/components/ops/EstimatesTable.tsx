'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Download, FileDown } from 'lucide-react'
import { Badge } from './StatusBadge'
import { ESTIMATE_STATUS_LABELS, type EstimateStatus } from '@/lib/ops/types'

export interface EstimateRow {
  id: string
  estimateNumber: string
  title: string
  status: EstimateStatus
  serviceType: string | null
  property: string
  totalCents: number
  totalLabel: string
  validUntil: string
  createdAt: string
  customerName: string
  contactId: string | null
  assignedName: string
  projectId: string | null
}

const TONE: Record<EstimateStatus, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  draft: 'neutral',
  ai_draft: 'warn',
  measuring: 'info',
  ready_for_review: 'info',
  sent: 'info',
  viewed: 'info',
  approved: 'ok',
  declined: 'neutral',
  expired: 'neutral',
  converted: 'ok',
}

/**
 * Multi-select batch export. The ZIP is streamed straight back from the API, so
 * the browser downloads it without the file ever being stored server-side.
 */
export default function EstimatesTable({
  rows,
  canBatchExport,
}: {
  rows: EstimateRow[]
  canBatchExport: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includePhotos, setIncludePhotos] = useState(false)

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))
  }

  async function exportSelected() {
    setError(null)
    setBusy(true)
    try {
      const response = await fetch('/api/estimates/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), includePhotos }),
      })

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'The export failed.')
        return
      }

      const failed = Number(response.headers.get('X-Export-Failed') ?? 0)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Vertical_Estimates_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)

      if (failed > 0) {
        setError(`${failed} estimate${failed === 1 ? '' : 's'} could not be exported — see EXPORT_ERRORS.txt inside the ZIP.`)
      } else {
        setSelected(new Set())
      }
    } catch {
      setError('The export could not be downloaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const selectedTotal = rows
    .filter(r => selected.has(r.id))
    .reduce((sum, r) => sum + r.totalCents, 0)

  return (
    <>
      {canBatchExport && selected.size > 0 && (
        <div className="ops-selection-bar">
          <strong>{selected.size} selected</strong>
          <span style={{ color: '#9fb0bf' }}>
            {(selectedTotal / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} total
          </span>
          <span className="spacer" />
          <label className="ops-check" style={{ color: '#cbd5df', fontSize: '.79rem' }}>
            <input type="checkbox" checked={includePhotos} onChange={e => setIncludePhotos(e.target.checked)} />
            <span>Include photos</span>
          </label>
          <button type="button" className="ops-btn ops-btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button type="button" className="ops-btn ops-btn-sm ops-btn-primary" onClick={exportSelected} disabled={busy}>
            <FileDown aria-hidden="true" />
            {busy ? 'Building ZIP…' : `Export ${selected.size} PDF${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {error && (
        <div className="ops-banner warn" role="alert" style={{ margin: '12px 14px 0' }}>
          <div>{error}</div>
        </div>
      )}

      <div className="ops-table-wrap">
        <table className="ops-table ops-table-cards">
          <thead>
            <tr>
              {canBatchExport && (
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox" checked={allSelected} onChange={toggleAll}
                    aria-label="Select all estimates on this page"
                    style={{ width: 15, height: 15, accentColor: 'var(--ops-accent)' }}
                  />
                </th>
              )}
              <th>Estimate</th><th>Client</th><th>Property</th><th>Service</th>
              <th>Status</th><th className="num">Total</th><th>Assigned</th>
              <th>Created</th><th>Valid until</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.id} className={selected.has(row.id) ? 'is-selected' : undefined}>
                {canBatchExport && (
                  <td data-label="Select">
                    <input
                      type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)}
                      aria-label={`Select estimate ${row.estimateNumber}`}
                      style={{ width: 15, height: 15, accentColor: 'var(--ops-accent)' }}
                    />
                  </td>
                )}
                <td data-label="Estimate" className="ops-cell-primary">
                  <Link className="ops-row-link" href={`/ops/estimates/${row.id}`}>{row.estimateNumber}</Link>
                  <span className="ops-sub2">{row.title}</span>
                </td>
                <td data-label="Client">
                  {row.contactId
                    ? <Link href={`/ops/contacts/${row.contactId}`} style={{ color: 'var(--ops-accent)' }}>{row.customerName}</Link>
                    : row.customerName}
                </td>
                <td data-label="Property">{row.property || '—'}</td>
                <td data-label="Service">{row.serviceType ?? '—'}</td>
                <td data-label="Status">
                  <Badge tone={TONE[row.status]}>{ESTIMATE_STATUS_LABELS[row.status]}</Badge>
                </td>
                <td data-label="Total" className="num">{row.totalLabel}</td>
                <td data-label="Assigned">{row.assignedName}</td>
                <td data-label="Created" className="nowrap">{row.createdAt}</td>
                <td data-label="Valid until" className="nowrap">{row.validUntil}</td>
                <td className="ops-actions">
                  <a className="ops-btn ops-btn-sm" href={`/api/estimates/${row.id}/pdf`} rel="noopener">
                    <Download aria-hidden="true" />
                  </a>
                  {row.projectId && (
                    <Link className="ops-btn ops-btn-sm" href={`/ops/projects/${row.projectId}`}>Job</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
