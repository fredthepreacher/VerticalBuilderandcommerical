'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react'
import {
  CHUNK_SIZE, IMPORT_FIELDS, IMPORT_FIELD_LABELS, buildErrorCsv, chunk, mapRow,
  normalizeEmail, normalizePhone, parseCsv, summarize, suggestMapping, validateRows,
  type ColumnMapping, type ValidatedRow,
} from '@/lib/ops/imports/leads'
import { DUPLICATE_STRATEGIES, DUPLICATE_STRATEGY_LABELS, type DuplicateStrategy } from '@/lib/ops/types'

/**
 * ============================================================================
 * BULK LEAD IMPORT WIZARD
 * ----------------------------------------------------------------------------
 * Upload → map columns → preview → import in chunks → results.
 *
 * The file is parsed and validated entirely in the browser, which is what makes
 * a 10,000-row preview instant and honest. Only normalised email/phone strings
 * go to the server to check for existing duplicates; the rows themselves are
 * sent in slices of 400 so no single request can time out halfway through and
 * leave nobody knowing how many landed.
 * ============================================================================
 */

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'

interface Totals {
  imported: number
  updated: number
  skipped: number
  failed: number
  processed: number
}

export default function LeadImportWizard({ staff }: { staff: { id: string; label: string }[] }) {
  const [step, setStep] = useState<Step>('upload')
  const [filename, setFilename] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [validated, setValidated] = useState<ValidatedRow[]>([])
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [importTag, setImportTag] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<Totals>({ imported: 0, updated: 0, skipped: 0, failed: 0, processed: 0 })
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // ---- step 1: upload ----------------------------------------------------
  async function onFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      if (file.size > 25 * 1024 * 1024) {
        setError('That file is over 25 MB. Split it into smaller files and import them one at a time.')
        return
      }

      const text = await file.text()
      const parsed = parseCsv(text)

      if (parsed.length < 2) {
        setError('That file has no data rows. It needs a header row plus at least one lead.')
        return
      }

      const [headerRow, ...dataRows] = parsed
      setFilename(file.name)
      setHeaders(headerRow)
      setRows(dataRows)
      setMapping(suggestMapping(headerRow))
      setStep('map')
    } catch {
      setError('That file could not be read. Save it as CSV from Excel or Sheets and try again.')
    } finally {
      setBusy(false)
    }
  }

  // ---- step 2 → 3: validate ----------------------------------------------
  async function runPreview() {
    setError(null)
    setBusy(true)
    try {
      const parsed = rows.map((row, index) => mapRow(row, mapping, index + 2))

      const response = await fetch('/api/leads/import/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          totalRows: rows.length,
          mapping,
          duplicateStrategy: strategy,
          importTag: importTag || null,
          emails: parsed.map(r => r.normalizedEmail).filter(Boolean),
          phones: parsed.map(r => r.normalizedPhone).filter(Boolean),
        }),
      })

      const data = (await response.json().catch(() => ({}))) as {
        importJobId?: string
        duplicateEmails?: Record<string, string>
        duplicatePhones?: Record<string, string>
        error?: string
      }

      if (!response.ok || !data.importJobId) {
        setError(data.error ?? 'The import could not be started.')
        return
      }

      setImportJobId(data.importJobId)
      setValidated(validateRows(parsed, {
        existingByEmail: new Map(Object.entries(data.duplicateEmails ?? {})),
        existingByPhone: new Map(Object.entries(data.duplicatePhones ?? {})),
      }))
      setStep('preview')
    } catch {
      setError('Could not reach the server to check for duplicates. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  // ---- step 4: import ----------------------------------------------------
  async function runImport() {
    if (!importJobId) return
    setError(null)
    setStep('importing')

    const batches = chunk(rows, CHUNK_SIZE)
    const running: Totals = { imported: 0, updated: 0, skipped: 0, failed: 0, processed: 0 }

    for (let i = 0; i < batches.length; i += 1) {
      try {
        const response = await fetch('/api/leads/import/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            importJobId,
            mapping,
            rows: batches[i],
            offset: i * CHUNK_SIZE,
            duplicateStrategy: strategy,
            importTag: importTag || undefined,
            assignedTo: assignedTo || null,
          }),
        })

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string }
          setError(
            `Stopped at row ${i * CHUNK_SIZE + 1}: ${data.error ?? 'the server rejected that block'}. ` +
            `${running.imported} lead${running.imported === 1 ? '' : 's'} were imported before this point — they are saved.`,
          )
          setStep('done')
          return
        }

        const data = (await response.json()) as { chunk: Totals }
        running.imported += data.chunk.imported
        running.updated += data.chunk.updated
        running.skipped += data.chunk.skipped
        running.failed += data.chunk.failed
        running.processed += data.chunk.processed

        setTotals({ ...running })
        setProgress(Math.round(((i + 1) / batches.length) * 100))
      } catch {
        setError(
          `The connection dropped at row ${i * CHUNK_SIZE + 1}. ` +
          `${running.imported} lead${running.imported === 1 ? '' : 's'} were imported and are saved.`,
        )
        setStep('done')
        return
      }
    }

    await fetch('/api/leads/import/chunk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importJobId }),
    }).catch(() => {})

    setStep('done')
  }

  const summary = validated.length > 0 ? summarize(validated) : null
  const unmappedRequired = !IMPORT_FIELDS.some(f => f === 'first_name' && mapping[f] !== undefined)
  const noContactColumn = mapping.email === undefined && mapping.phone === undefined

  return (
    <>
      <div className="ops-steps-bar">
        <StepChip n={1} label="Upload" state={step === 'upload' ? 'current' : 'done'} />
        <StepChip n={2} label="Map columns"
          state={step === 'map' ? 'current' : step === 'upload' ? 'todo' : 'done'} />
        <StepChip n={3} label="Preview"
          state={step === 'preview' ? 'current' : ['importing', 'done'].includes(step) ? 'done' : 'todo'} />
        <StepChip n={4} label="Import"
          state={step === 'importing' ? 'current' : step === 'done' ? 'done' : 'todo'} />
        <StepChip n={5} label="Results" state={step === 'done' ? 'current' : 'todo'} />
      </div>

      {error && (
        <div className="ops-banner bad" role="alert">
          <AlertCircle aria-hidden="true" />
          <div>{error}</div>
        </div>
      )}

      {/* ---------------- upload ---------------- */}
      {step === 'upload' && (
        <div className="ops-card">
          <div className="ops-card-body">
            <label className="ops-dropzone" htmlFor="import-file">
              <Upload aria-hidden="true" />
              <strong>{busy ? 'Reading the file…' : 'Choose a CSV file'}</strong>
              <span>Up to 50,000 rows · exported from Excel, Sheets, or another CRM</span>
              <input
                id="import-file" type="file" accept=".csv,text/csv" disabled={busy}
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
              />
            </label>

            <div className="ops-banner info" style={{ marginTop: 18, marginBottom: 0 }}>
              <FileSpreadsheet aria-hidden="true" />
              <div>
                <strong>Working from an .xlsx?</strong>
                Save it as CSV first (File → Save As → CSV). Excel&apos;s own format carries
                formatting and formulas that would come through as noise; CSV imports cleanly.
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              <h3 style={{ marginBottom: 8 }}>What the file needs</h3>
              <ul style={{ display: 'grid', gap: 5, fontSize: '.84rem' }}>
                <li>• A header row naming the columns — the mapping step guesses from these.</li>
                <li>• A name for each lead (first, last, or a company).</li>
                <li>• An email or a phone. A lead with neither cannot be contacted and is rejected.</li>
                <li>• Anything else is optional: address, city, ZIP, service type, source, notes.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- map ---------------- */}
      {step === 'map' && (
        <div className="ops-card">
          <div className="ops-card-head">
            <h2>Match your columns</h2>
            <div className="ops-card-actions">
              <span className="ops-hint">{rows.length.toLocaleString()} rows in {filename}</span>
            </div>
          </div>
          <div className="ops-card-body">
            <p className="ops-hint" style={{ marginBottom: 14 }}>
              We have guessed from your headers. Correct anything that is wrong, and set unwanted
              columns to “Do not import”.
            </p>

            <div className="ops-table-wrap">
              <table className="ops-map-table">
                <thead>
                  <tr><th>Your column</th><th>First row</th><th>Imports as</th></tr>
                </thead>
                <tbody>
                  {headers.map((header, index) => {
                    const assigned = IMPORT_FIELDS.find(f => mapping[f] === index)
                    return (
                      <tr key={`${header}-${index}`}>
                        <td><strong>{header || <em>(unnamed column {index + 1})</em>}</strong></td>
                        <td className="ops-map-sample">{rows[0]?.[index]?.slice(0, 50) || '—'}</td>
                        <td>
                          <select
                            value={assigned ?? ''}
                            aria-label={`Map column ${header || index + 1}`}
                            onChange={e => {
                              const field = e.target.value as (typeof IMPORT_FIELDS)[number] | ''
                              setMapping(prev => {
                                const next = { ...prev }
                                for (const f of IMPORT_FIELDS) if (next[f] === index) delete next[f]
                                if (field) next[field] = index
                                return next
                              })
                            }}
                          >
                            <option value="">Do not import</option>
                            {IMPORT_FIELDS.map(field => (
                              <option key={field} value={field}>{IMPORT_FIELD_LABELS[field]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {(unmappedRequired || noContactColumn) && (
              <div className="ops-banner warn" style={{ marginTop: 16 }}>
                <div>
                  {unmappedRequired && <>No column is mapped to <strong>First name</strong>. </>}
                  {noContactColumn && <>Neither <strong>Email</strong> nor <strong>Phone</strong> is mapped — every row will be rejected as uncontactable. </>}
                  Fix the mapping above before continuing.
                </div>
              </div>
            )}

            <div className="ops-grid-3" style={{ marginTop: 20 }}>
              <div className="ops-field">
                <label htmlFor="dup-strategy">If a lead already exists</label>
                <select id="dup-strategy" className="ops-select" value={strategy}
                  onChange={e => setStrategy(e.target.value as DuplicateStrategy)}>
                  {DUPLICATE_STRATEGIES.map(s => (
                    <option key={s} value={s}>{DUPLICATE_STRATEGY_LABELS[s]}</option>
                  ))}
                </select>
                <p className="ops-hint">Matched on email first, then phone. Never on name alone.</p>
              </div>
              <div className="ops-field">
                <label htmlFor="import-tag">Tag this batch</label>
                <input id="import-tag" className="ops-input" value={importTag}
                  onChange={e => setImportTag(e.target.value)}
                  placeholder="Storm list Aug 2026" />
                <p className="ops-hint">Stored on each lead so you can find this batch later.</p>
              </div>
              <div className="ops-field">
                <label htmlFor="import-assign">Assign all to</label>
                <select id="import-assign" className="ops-select" value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}>
                  <option value="">Leave unassigned</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="ops-btn ops-btn-primary" onClick={runPreview}
                disabled={busy || unmappedRequired || noContactColumn}>
                {busy ? 'Checking for duplicates…' : 'Preview the import'}
              </button>
              <button type="button" className="ops-btn" onClick={() => setStep('upload')}>Back</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- preview ---------------- */}
      {step === 'preview' && summary && (
        <>
          <div className="ops-kpis">
            <Kpi label="Rows in file" value={summary.total} />
            <Kpi label="Will import" value={summary.valid} tone="ok" />
            <Kpi label="Duplicates" value={summary.duplicates} tone="warn" />
            <Kpi label="Will be rejected" value={summary.invalid} tone={summary.invalid > 0 ? 'alert' : undefined} />
          </div>

          <div className="ops-card">
            <div className="ops-card-head">
              <h2>Preview</h2>
              <div className="ops-card-actions">
                <span className="ops-hint">First 100 rows shown</span>
              </div>
            </div>

            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr><th>Row</th><th>Name</th><th>Email</th><th>Phone</th><th>City</th><th>Outcome</th></tr>
                </thead>
                <tbody>
                  {validated.slice(0, 100).map(row => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>
                        {[row.values.first_name, row.values.last_name].filter(Boolean).join(' ')
                          || row.values.company_name || <em style={{ color: 'var(--ops-bad)' }}>missing</em>}
                      </td>
                      <td>{row.values.email ?? '—'}</td>
                      <td>{row.values.phone ?? '—'}</td>
                      <td>{row.values.city ?? '—'}</td>
                      <td style={{ fontSize: '.78rem' }}>
                        {row.status === 'valid' && <span style={{ color: 'var(--ops-ok)' }}>Import</span>}
                        {row.status === 'duplicate' && (
                          <span style={{ color: 'var(--ops-warn)' }}>
                            {strategy === 'skip' ? 'Skip — ' : strategy === 'update' ? 'Update — ' : 'Import anyway — '}
                            {row.duplicateOf
                              ? `already in the CRM (${row.duplicateOf.matchedOn})`
                              : `duplicate of row ${row.duplicateOfRow}`}
                          </span>
                        )}
                        {row.status === 'invalid' && (
                          <span style={{ color: 'var(--ops-bad)' }}>{row.errors[0]?.message}</span>
                        )}
                        {row.warnings.length > 0 && row.status === 'valid' && (
                          <span style={{ color: 'var(--ops-warn)', display: 'block' }}>{row.warnings[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ops-card-body">
              {summary.invalid > 0 && (
                <div className="ops-banner warn">
                  <div>
                    {summary.invalid} row{summary.invalid === 1 ? '' : 's'} will be rejected. They are
                    not lost — a downloadable error report is produced at the end so you can fix and
                    re-import just those.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="ops-btn ops-btn-primary" onClick={runImport}
                  disabled={summary.valid === 0 && summary.duplicates === 0}>
                  Import {summary.valid + (strategy === 'skip' ? 0 : summary.duplicates)} lead
                  {summary.valid + (strategy === 'skip' ? 0 : summary.duplicates) === 1 ? '' : 's'}
                </button>
                <button type="button" className="ops-btn" onClick={() => setStep('map')}>Back to mapping</button>
                <button type="button" className="ops-btn"
                  onClick={() => downloadCsv(buildErrorCsv(validated, headers), `preview_${filename}`)}>
                  <Download aria-hidden="true" /> Download the problem rows
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---------------- importing ---------------- */}
      {step === 'importing' && (
        <div className="ops-card">
          <div className="ops-card-head"><h2>Importing…</h2></div>
          <div className="ops-card-body">
            <div className="ops-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${progress}%` }} />
            </div>
            <p className="ops-hint" style={{ marginTop: 10 }}>
              {totals.processed.toLocaleString()} of {rows.length.toLocaleString()} rows processed ·{' '}
              {totals.imported.toLocaleString()} imported
              {totals.updated > 0 && ` · ${totals.updated} updated`}
              {totals.skipped > 0 && ` · ${totals.skipped} skipped`}
              {totals.failed > 0 && ` · ${totals.failed} failed`}
            </p>
            <p className="ops-hint" style={{ marginTop: 8 }}>
              Sent {CHUNK_SIZE} rows at a time. Leave this tab open — if it is closed, everything
              already imported is saved and the job is recorded.
            </p>
          </div>
        </div>
      )}

      {/* ---------------- done ---------------- */}
      {step === 'done' && (
        <>
          <div className="ops-banner ok">
            <CheckCircle2 aria-hidden="true" />
            <div>
              <strong>Import finished</strong>
              {totals.imported.toLocaleString()} lead{totals.imported === 1 ? '' : 's'} added
              {totals.updated > 0 && `, ${totals.updated} existing updated`}
              {totals.skipped > 0 && `, ${totals.skipped} skipped as duplicates`}
              {totals.failed > 0 && `, ${totals.failed} rejected`}.
            </div>
          </div>

          <div className="ops-kpis">
            <Kpi label="Imported" value={totals.imported} tone="ok" />
            <Kpi label="Updated" value={totals.updated} />
            <Kpi label="Skipped" value={totals.skipped} />
            <Kpi label="Rejected" value={totals.failed} tone={totals.failed > 0 ? 'alert' : undefined} />
          </div>

          <div className="ops-card">
            <div className="ops-card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a className="ops-btn ops-btn-primary" href="/ops/leads">Open the leads list</a>
              {(totals.failed > 0 || totals.skipped > 0) && importJobId && (
                <a className="ops-btn" href={`/api/leads/import/${importJobId}?format=csv`}>
                  <Download aria-hidden="true" /> Download the error report
                </a>
              )}
              <button type="button" className="ops-btn" onClick={() => window.location.reload()}>
                Import another file
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

function StepChip({ n, label, state }: { n: number; label: string; state: 'todo' | 'current' | 'done' }) {
  return (
    <div className={`ops-step-chip${state === 'current' ? ' is-current' : state === 'done' ? ' is-done' : ''}`}>
      <b>{n}</b> {label}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'warn' | 'alert' }) {
  return (
    <div className={`ops-kpi${tone === 'alert' ? ' is-alert' : tone === 'warn' ? ' is-warn' : ''}`}>
      <div className="ops-kpi-label">{label}</div>
      <div className="ops-kpi-value" style={tone === 'ok' ? { color: 'var(--ops-ok)' } : undefined}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `problems_${filename.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
