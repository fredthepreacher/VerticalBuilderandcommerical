'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileSpreadsheet, Radar, Upload } from 'lucide-react'
import { parseCsv, chunk, CHUNK_SIZE } from '@/lib/ops/imports/leads'
import {
  PROSPECT_FIELDS, PROSPECT_FIELD_LABELS, suggestProspectMapping, mapProspectRow,
  validateProspectRows, summarizeProspects,
  type ProspectMapping, type ValidatedProspectRow,
} from '@/lib/ops/prospecting/import'

/**
 * Upload → map → preview → import (chunked) → results, mirroring the lead
 * importer. The file is parsed and validated in the browser; only normalised
 * address keys go to the server for duplicate checks, and rows are sent in
 * slices of 400 so a large county file is resumable and the progress honest.
 * Rows land in roof_prospects — never leads.
 */
type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'
type Strategy = 'skip' | 'import_anyway'
interface Totals { imported: number; skipped: number; failed: number; needsReview: number; processed: number }

export default function ProspectImportWizard({
  campaigns,
}: {
  campaigns: { id: string; label: string; county: string | null; roofTypes: string[] }[]
}) {
  const [step, setStep] = useState<Step>('upload')
  const [filename, setFilename] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ProspectMapping>({})
  const [validated, setValidated] = useState<ValidatedProspectRow[]>([])
  const [strategy, setStrategy] = useState<Strategy>('skip')
  const [campaignId, setCampaignId] = useState('')
  const [county, setCounty] = useState('')
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<Totals>({ imported: 0, skipped: 0, failed: 0, needsReview: 0, processed: 0 })
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingJobRef = useRef<string | null>(null)

  const cancelPending = useCallback((jobId: string) => {
    fetch(`/api/ops/prospecting/import/${jobId}`, { method: 'DELETE', keepalive: true }).catch(() => {})
  }, [])

  useEffect(() => {
    const onLeave = () => {
      const jobId = pendingJobRef.current
      if (jobId) navigator.sendBeacon?.(`/api/ops/prospecting/import/${jobId}`)
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

  async function onFile(file: File) {
    setError(null); setBusy(true)
    try {
      if (file.size > 25 * 1024 * 1024) {
        setError('That file is over 25 MB. Split it into smaller files and import them one at a time.')
        return
      }
      const parsed = parseCsv(await file.text())
      if (parsed.length < 2) {
        setError('That file has no data rows. It needs a header row plus at least one property.')
        return
      }
      const [headerRow, ...dataRows] = parsed
      setFilename(file.name)
      setHeaders(headerRow)
      setRows(dataRows)
      setMapping(suggestProspectMapping(headerRow))
      setStep('map')
    } catch {
      setError('That file could not be read. Save it as CSV from Excel or Sheets and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function runPreview() {
    setError(null); setBusy(true)
    try {
      const parsed = rows.map((row, i) => mapProspectRow(row, mapping, i + 2))
      const response = await fetch('/api/ops/prospecting/import/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename, totalRows: rows.length, mapping,
          campaignId: campaignId || null, county: county || null,
          duplicateStrategy: strategy,
          addresses: parsed.map(r => r.normalizedAddress).filter(Boolean),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        importJobId?: string
        duplicateProspects?: Record<string, string>
        duplicateLeads?: Record<string, string>
        error?: string
      }
      if (!response.ok || !data.importJobId) {
        setError(data.error ?? 'The import could not be started.')
        return
      }
      setImportJobId(data.importJobId)
      pendingJobRef.current = data.importJobId
      const campaignRoofTypes = campaigns.find(c => c.id === campaignId)?.roofTypes
      setValidated(validateProspectRows(parsed, {
        campaignRoofTypes,
        existingProspectsByAddress: new Map(Object.entries(data.duplicateProspects ?? {})),
        existingLeadsByAddress: new Map(Object.entries(data.duplicateLeads ?? {})),
      }))
      setStep('preview')
    } catch {
      setError('Could not reach the server to check for duplicates. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!importJobId) return
    setError(null); setStep('importing'); setProgress(0)
    setTotals({ imported: 0, skipped: 0, failed: 0, needsReview: 0, processed: 0 })
    const batches = chunk(rows, CHUNK_SIZE)
    try {
      for (let i = 0; i < batches.length; i += 1) {
        const response = await fetch('/api/ops/prospecting/import/chunk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importJobId, mapping, rows: batches[i], offset: i * CHUNK_SIZE, duplicateStrategy: strategy,
          }),
        })
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          setError(`Stopped at row ${i * CHUNK_SIZE + 1}: ${data.error ?? 'the server rejected that block'}.`)
          setStep('done'); return
        }
        const data = (await response.json()) as { chunk: Totals }
        setTotals(t => ({
          imported: t.imported + data.chunk.imported,
          skipped: t.skipped + data.chunk.skipped,
          failed: t.failed + data.chunk.failed,
          needsReview: t.needsReview + data.chunk.needsReview,
          processed: t.processed + data.chunk.processed,
        }))
        setProgress(Math.round(((i + 1) / batches.length) * 100))
      }
      await fetch('/api/ops/prospecting/import/chunk', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importJobId }),
      })
      pendingJobRef.current = null
      setStep('done')
    } catch {
      setError('The connection dropped during import. Reload the batch to see what landed before continuing.')
      setStep('done')
    }
  }

  const summary = validated.length ? summarizeProspects(validated) : null
  const mappedProperty = mapping.property_address !== undefined

  return (
    <div className="ops-card">
      <div className="ops-steps-bar">
        <StepChip n={1} label="Upload" state={step === 'upload' ? 'current' : 'done'} />
        <StepChip n={2} label="Map columns" state={step === 'map' ? 'current' : step === 'upload' ? 'todo' : 'done'} />
        <StepChip n={3} label="Preview" state={step === 'preview' ? 'current' : ['importing', 'done'].includes(step) ? 'done' : 'todo'} />
        <StepChip n={4} label="Import" state={step === 'importing' ? 'current' : step === 'done' ? 'done' : 'todo'} />
        <StepChip n={5} label="Results" state={step === 'done' ? 'current' : 'todo'} />
      </div>

      {error && <div className="ops-banner bad" role="alert"><AlertCircle aria-hidden="true" /><div>{error}</div></div>}

      {step === 'upload' && (
        <div className="ops-card-body">
          <label className="ops-dropzone">
            <input type="file" accept=".csv,text/csv" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} disabled={busy} />
            <Upload aria-hidden="true" />
            <strong>Choose a county permit CSV</strong>
            <span>A header row plus one row per property. Addresses, permits, parcels and mailing addresses all import.</span>
          </label>
          <p className="ops-hint" style={{ marginTop: 12 }}>
            <strong>Working from an .xlsx?</strong> Save it as CSV from Excel or Google Sheets first, then upload here.
          </p>
        </div>
      )}

      {step === 'map' && (
        <div className="ops-card-body">
          <div className="ops-grid-2">
            <div className="ops-field">
              <label htmlFor="p-campaign">Campaign</label>
              <select id="p-campaign" className="ops-select" value={campaignId}
                onChange={e => {
                  setCampaignId(e.target.value)
                  const c = campaigns.find(x => x.id === e.target.value)
                  if (c?.county && !county) setCounty(c.county)
                }}>
                <option value="">— No campaign —</option>
                {campaigns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <p className="ops-hint">Attaches every row to this campaign for pricing, screening and reporting.</p>
            </div>
            <div className="ops-field">
              <label htmlFor="p-county">County</label>
              <input id="p-county" className="ops-input" value={county}
                onChange={e => setCounty(e.target.value)} placeholder="Sarasota" />
            </div>
          </div>

          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>Prospect field</th><th>Spreadsheet column</th></tr></thead>
              <tbody>
                {PROSPECT_FIELDS.map(field => (
                  <tr key={field}>
                    <td className="ops-cell-primary">
                      {PROSPECT_FIELD_LABELS[field]}
                      {field === 'property_address' && <span className="ops-sub2">Required</span>}
                    </td>
                    <td>
                      <select className="ops-select" value={mapping[field] ?? ''}
                        onChange={e => setMapping(m => {
                          const next = { ...m }
                          if (e.target.value === '') delete next[field]
                          else next[field] = Number(e.target.value)
                          return next
                        })}>
                        <option value="">— Not imported —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-field" style={{ marginTop: 12 }}>
            <label htmlFor="p-strategy">Duplicate properties</label>
            <select id="p-strategy" className="ops-select" value={strategy} onChange={e => setStrategy(e.target.value as Strategy)}>
              <option value="skip">Skip — do not re-import a property already here</option>
              <option value="import_anyway">Import anyway — keep duplicates, flagged</option>
            </select>
            <p className="ops-hint">Matched by normalised property address against existing prospects and CRM leads. Nothing is ever deleted.</p>
          </div>

          <div className="ops-form-actions">
            <button type="button" className="ops-btn" onClick={() => setStep('upload')}>Back</button>
            <button type="button" className="ops-btn ops-btn-primary" onClick={runPreview}
              disabled={busy || !mappedProperty}>
              {busy ? 'Checking…' : 'Preview import'}
            </button>
          </div>
          {!mappedProperty && <p className="ops-error">Map a property address column to continue.</p>}
        </div>
      )}

      {step === 'preview' && summary && (
        <div className="ops-card-body">
          <div className="ops-kpi-row">
            <Kpi label="Rows" value={summary.total} />
            <Kpi label="Ready" value={summary.valid} tone="ok" />
            <Kpi label="Needs review" value={summary.needsReview} tone="warn" />
            <Kpi label="Duplicates" value={summary.duplicates} tone="warn" />
            <Kpi label="Rejected" value={summary.invalid} tone={summary.invalid ? 'alert' : undefined} />
          </div>
          <p className="ops-hint" style={{ marginTop: 10 }}>
            {strategy === 'skip'
              ? 'Duplicates will be skipped. '
              : 'Duplicates will be imported and flagged. '}
            Rejected rows have no usable property address and will not import. Needs-review rows import and are flagged for the screening step.
          </p>
          <div className="ops-form-actions">
            <button type="button" className="ops-btn" onClick={() => setStep('map')}>Back to mapping</button>
            <button type="button" className="ops-btn ops-btn-primary" onClick={runImport}
              disabled={summary.total - summary.invalid - (strategy === 'skip' ? summary.duplicates : 0) <= 0}>
              Import {Math.max(0, summary.total - summary.invalid - (strategy === 'skip' ? summary.duplicates : 0))} properties
            </button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="ops-card-body">
          <div className="ops-progress"><div className="ops-progress-fill" style={{ width: `${progress}%` }} /></div>
          <p className="ops-hint" style={{ marginTop: 10 }}>
            {progress}% — sent {CHUNK_SIZE} rows at a time. Leave this tab open; if it closes, reopen the batch to continue.
          </p>
          <div className="ops-kpi-row" style={{ marginTop: 10 }}>
            <Kpi label="Imported" value={totals.imported} tone="ok" />
            <Kpi label="Needs review" value={totals.needsReview} tone="warn" />
            <Kpi label="Skipped" value={totals.skipped} />
            <Kpi label="Failed" value={totals.failed} tone={totals.failed ? 'alert' : undefined} />
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="ops-card-body">
          <div className="ops-banner ok" role="status">
            <CheckCircle2 aria-hidden="true" />
            <div><strong>Import complete.</strong> {totals.imported} properties imported{totals.needsReview ? `, ${totals.needsReview} flagged for review` : ''}.</div>
          </div>
          <div className="ops-kpi-row" style={{ marginTop: 10 }}>
            <Kpi label="Imported" value={totals.imported} tone="ok" />
            <Kpi label="Needs review" value={totals.needsReview} tone="warn" />
            <Kpi label="Skipped" value={totals.skipped} />
            <Kpi label="Failed" value={totals.failed} tone={totals.failed ? 'alert' : undefined} />
          </div>
          <div className="ops-form-actions">
            {importJobId && <a className="ops-btn ops-btn-primary" href={`/ops/prospecting/batches/${importJobId}`}><Radar aria-hidden="true" /> Open batch</a>}
            <a className="ops-btn" href="/ops/prospecting">Back to Roof Prospecting</a>
          </div>
        </div>
      )}
    </div>
  )
}

function StepChip({ n, label, state }: { n: number; label: string; state: 'todo' | 'current' | 'done' }) {
  return (
    <div className={`ops-step-chip${state === 'current' ? ' is-current' : state === 'done' ? ' is-done' : ''}`}>
      <span className="ops-step-n">{n}</span>{label}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'alert' }) {
  return (
    <div className={`ops-kpi${tone ? ` is-${tone}` : ''}`}>
      <div className="ops-kpi-value">{value.toLocaleString()}</div>
      <div className="ops-kpi-label">{label}</div>
    </div>
  )
}
