'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Home, Upload, Users } from 'lucide-react'
import {
  CHUNK_SIZE, IMPORT_FIELDS, IMPORT_FIELD_LABELS, IMPORT_MODES, IMPORT_MODE_HINTS,
  IMPORT_MODE_LABELS, buildErrorCsv, chunk, mapRow, parseCsv, summarize, suggestImportMode,
  suggestMapping, validateRows,
  type ColumnMapping, type ImportMode, type ValidatedRow,
} from '@/lib/ops/imports/leads'
import { formatAddressLine } from '@/lib/ops/imports/address'
import {
  DUPLICATE_STRATEGIES, DUPLICATE_STRATEGY_LABELS, LEAD_SOURCES, type DuplicateStrategy,
} from '@/lib/ops/types'

/**
 * ============================================================================
 * BULK LEAD IMPORT WIZARD
 * ----------------------------------------------------------------------------
 * Upload → map columns → preview → import in chunks → results.
 *
 * The file is parsed and validated entirely in the browser, which is what makes
 * a 10,000-row preview instant and honest. Only normalised email/phone/address
 * keys go to the server to check for existing duplicates; the rows themselves
 * are sent in slices of 400 so no single request can time out halfway through
 * and leave nobody knowing how many landed.
 *
 * TWO MODES, chosen on the mapping step rather than as a sixth wizard step:
 *
 *   Standard leads     — the original rules. Needs a name and a way to reach
 *                        the person.
 *   Property prospects — for storm lists and canvassing routes. An address is
 *                        enough; name, phone and email are optional.
 *
 * The mode is suggested from the file's own shape and always confirmed by the
 * operator. A file with addresses and no contact details no longer produces a
 * blocking "every row will be rejected" error — it produces an offer.
 * ============================================================================
 */

type Step = 'upload' | 'map' | 'preview' | 'importing' | 'done'

interface Totals {
  imported: number
  updated: number
  skipped: number
  failed: number
  needsReview: number
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
  const [mode, setMode] = useState<ImportMode>('standard')
  const [modeSuggested, setModeSuggested] = useState<ImportMode>('standard')
  const [importTag, setImportTag] = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [progress, setProgress] = useState(0)
  const [totals, setTotals] = useState<Totals>({ imported: 0, updated: 0, skipped: 0, failed: 0, needsReview: 0, processed: 0 })
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The job that exists on the server but has not been imported yet.
   *
   * A job row is created the moment a preview is requested, so backing out —
   * or closing the tab — would otherwise leave it sitting in Recent Imports
   * looking like work in progress forever. A ref rather than state because the
   * unload handler has to read the current value without being re-bound on
   * every render.
   */
  const pendingJobRef = useRef<string | null>(null)

  /** Tells the server the operator walked away. Safe to call more than once. */
  const cancelPendingJob = useCallback((jobId: string | null) => {
    if (!jobId) return
    pendingJobRef.current = null
    fetch(`/api/leads/import/${jobId}`, { method: 'DELETE', keepalive: true })
      .catch(() => undefined)  // best effort; the daily sweep is the backstop
  }, [])

  // A closed tab gets no chance to await a fetch, so the beacon goes out on
  // pagehide. If it does not make it, the supersede check on the next import
  // and the daily sweep both still catch the row.
  useEffect(() => {
    const onLeave = () => {
      const jobId = pendingJobRef.current
      if (!jobId) return
      pendingJobRef.current = null
      navigator.sendBeacon?.(`/api/leads/import/${jobId}`)
    }
    window.addEventListener('pagehide', onLeave)
    return () => window.removeEventListener('pagehide', onLeave)
  }, [])

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
      const guessed = suggestMapping(headerRow)
      // Suggested from the file's actual contents, not just its headers — a
      // list with an empty Phone column is still an address list.
      const guessedMode = suggestImportMode(guessed, dataRows)
      setFilename(file.name)
      setHeaders(headerRow)
      setRows(dataRows)
      setMapping(guessed)
      setMode(guessedMode)
      setModeSuggested(guessedMode)
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
          importMode: mode,
          importTag: importTag || null,
          leadSource: leadSource || null,
          emails: parsed.map(r => r.normalizedEmail).filter(Boolean),
          phones: parsed.map(r => r.normalizedPhone).filter(Boolean),
          addresses: mode === 'property_prospect'
            ? parsed.map(r => r.normalizedAddress).filter(Boolean)
            : [],
        }),
      })

      const data = (await response.json().catch(() => ({}))) as {
        importJobId?: string
        duplicateEmails?: Record<string, string>
        duplicatePhones?: Record<string, string>
        duplicateAddresses?: Record<string, string>
        error?: string
      }

      if (!response.ok || !data.importJobId) {
        setError(data.error ?? 'The import could not be started.')
        return
      }

      setImportJobId(data.importJobId)
      pendingJobRef.current = data.importJobId
      setValidated(validateRows(parsed, {
        mode,
        existingByEmail: new Map(Object.entries(data.duplicateEmails ?? {})),
        existingByPhone: new Map(Object.entries(data.duplicatePhones ?? {})),
        existingByAddress: new Map(Object.entries(data.duplicateAddresses ?? {})),
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
    // From here the job owns real rows. Nothing in this component may cancel it.
    pendingJobRef.current = null
    setStep('importing')

    const batches = chunk(rows, CHUNK_SIZE)
    const running: Totals = { imported: 0, updated: 0, skipped: 0, failed: 0, needsReview: 0, processed: 0 }

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
            importMode: mode,
            importTag: importTag || undefined,
            leadSource: leadSource || undefined,
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
        running.needsReview += data.chunk.needsReview ?? 0
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
  const isProspectMode = mode === 'property_prospect'

  const hasNameColumn = ['first_name', 'last_name', 'full_name', 'owner_name', 'company_name']
    .some(f => mapping[f as keyof ColumnMapping] !== undefined)
  const hasContactColumn = mapping.email !== undefined || mapping.phone !== undefined
  const hasAddressColumn = mapping.property_address !== undefined

  // What actually stops the operator continuing, per mode. This is the change
  // the client asked for: an address list is no longer a blocking error.
  const blocker = isProspectMode
    ? (hasAddressColumn ? null : 'Map a column to Property address — that is what a property prospect is.')
    : (!hasNameColumn
        ? 'Map a column to a name (first, last, full name, owner or company).'
        : !hasContactColumn
          ? 'Map a column to Email or Phone. Without one, every row is rejected as uncontactable.'
          : null)

  // The offer, not the error.
  const showProspectOffer = !isProspectMode && hasAddressColumn && !hasContactColumn

  // needs_review rows import — flagged, not discarded — so they are counted in.
  const willImportCount = summary
    ? summary.valid + summary.needsReview + (strategy === 'skip' ? 0 : summary.duplicates)
    : 0

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
              <p className="ops-hint" style={{ marginBottom: 10 }}>
                A header row naming the columns — the mapping step guesses from those. After that it
                depends on what kind of list this is, and you choose that on the next screen.
              </p>
              <div className="ops-grid-2">
                <div className="ops-mode-explainer">
                  <strong><Users aria-hidden="true" /> Standard leads</strong>
                  <ul>
                    <li>A name — first, last, full name, or a company.</li>
                    <li>An email or a phone number.</li>
                    <li>Everything else optional: address, city, ZIP, service, source, notes.</li>
                  </ul>
                </div>
                <div className="ops-mode-explainer">
                  <strong><Home aria-hidden="true" /> Property prospects</strong>
                  <ul>
                    <li>A property address. That is the only requirement.</li>
                    <li>No name, phone or email needed — add those later.</li>
                    <li>Stop / route numbers are kept for canvassing order.</li>
                  </ul>
                </div>
              </div>
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

            {/* ---- the offer, replacing the old blocking error ---- */}
            {showProspectOffer && (
              <div className="ops-banner info" style={{ marginTop: 16 }}>
                <div>
                  <strong>No contact information was detected</strong>
                  This file contains property addresses but no phone numbers, emails or contact
                  names. You can import these as Property Prospects and add contact information
                  later.
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button" className="ops-btn ops-btn-sm ops-btn-primary"
                      onClick={() => setMode('property_prospect')}
                    >
                      <Home aria-hidden="true" /> Import as Property Prospects
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ---- import mode ---- */}
            <fieldset className="ops-mode-picker" style={{ marginTop: 20 }}>
              <legend>Import mode</legend>
              {IMPORT_MODES.map(m => (
                <label key={m} className={`ops-mode-option${mode === m ? ' is-selected' : ''}`}>
                  <input
                    type="radio" name="import-mode" value={m} checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span className="ops-mode-option-body">
                    <strong>
                      {m === 'property_prospect' ? <Home aria-hidden="true" /> : <Users aria-hidden="true" />}
                      {IMPORT_MODE_LABELS[m]}
                      {modeSuggested === m && <em className="ops-mode-suggested">suggested for this file</em>}
                    </strong>
                    <span>{IMPORT_MODE_HINTS[m]}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {blocker && (
              <div className="ops-banner warn" style={{ marginTop: 16 }}>
                <div>{blocker}</div>
              </div>
            )}

            {isProspectMode && (
              <p className="ops-hint" style={{ marginTop: 12 }}>
                Prospects import with the stage <strong>Needs Contact Info</strong>. Rows with a name,
                phone or email keep them — the mode changes what is <em>required</em>, not what is kept.
              </p>
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
                <p className="ops-hint">
                  Matched on email first, then phone
                  {isProspectMode ? ', then normalised property address' : ''}. Never on name alone.
                </p>
              </div>
              <div className="ops-field">
                <label htmlFor="import-tag">Tag this batch</label>
                <input id="import-tag" className="ops-input" value={importTag}
                  onChange={e => setImportTag(e.target.value)}
                  placeholder="Storm list Aug 2026" />
                <p className="ops-hint">Stored on each lead so you can find this batch later.</p>
              </div>
              <div className="ops-field">
                <label htmlFor="import-source">Lead source for this batch</label>
                <select id="import-source" className="ops-select" value={leadSource}
                  onChange={e => setLeadSource(e.target.value)}>
                  <option value="">{isProspectMode ? 'Storm List (default)' : 'Import (default)'}</option>
                  {LEAD_SOURCES.map(src => <option key={src} value={src}>{src}</option>)}
                </select>
                <p className="ops-hint">A mapped Source column overrides this per row.</p>
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
                disabled={busy || Boolean(blocker)}>
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
            <Kpi label="Ready to import" value={summary.valid} tone="ok" />
            <Kpi label="Duplicates" value={summary.duplicates} tone="warn" />
            <Kpi label="Needs review" value={summary.needsReview} tone={summary.needsReview > 0 ? 'warn' : undefined} />
            <Kpi label="Rejected" value={summary.invalid} tone={summary.invalid > 0 ? 'alert' : undefined} />
          </div>

          <div className="ops-card">
            <div className="ops-card-head">
              <h2>Preview</h2>
              <div className="ops-card-actions">
                <span className="ops-hint">First 100 rows shown</span>
              </div>
            </div>

            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    {isProspectMode && <th>Stop</th>}
                    <th>Row</th>
                    <th>{isProspectMode ? 'Parsed address' : 'Name'}</th>
                    <th>{isProspectMode ? 'Owner / contact' : 'Email'}</th>
                    <th>{isProspectMode ? 'Phone / email' : 'Phone'}</th>
                    {!isProspectMode && <th>City</th>}
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {validated.slice(0, 100).map(row => {
                    const name = [row.values.first_name, row.values.last_name].filter(Boolean).join(' ')
                      || row.values.full_name || row.values.owner_name || row.values.company_name || ''
                    return (
                      <tr key={row.rowNumber}>
                        {isProspectMode && (
                          <td data-label="Stop" className="nowrap">{row.values.stop_number ?? '—'}</td>
                        )}
                        <td data-label="Row">{row.rowNumber}</td>
                        <td data-label={isProspectMode ? 'Address' : 'Name'} className="ops-cell-primary">
                          {isProspectMode
                            ? (formatAddressLine({
                                property_address: row.address.street,
                                city: row.address.city, state: row.address.state, zip: row.address.zip,
                              }) || <em style={{ color: 'var(--ops-bad)' }}>no address</em>)
                            : (name || <em style={{ color: 'var(--ops-bad)' }}>missing</em>)}
                        </td>
                        <td data-label={isProspectMode ? 'Owner' : 'Email'}>
                          {isProspectMode ? (name || '—') : (row.values.email ?? '—')}
                        </td>
                        <td data-label="Phone">
                          {isProspectMode
                            ? ([row.values.phone, row.values.email].filter(Boolean).join(' · ') || '—')
                            : (row.values.phone ?? '—')}
                        </td>
                        {!isProspectMode && <td data-label="City">{row.values.city ?? '—'}</td>}
                        <td data-label="Outcome" style={{ fontSize: '.78rem' }}>
                          {row.status === 'valid' && <span style={{ color: 'var(--ops-ok)' }}>Import</span>}
                          {row.status === 'needs_review' && (
                            <span style={{ color: 'var(--ops-warn)' }}>
                              Import &amp; flag — {row.reviewReason}
                            </span>
                          )}
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
                          {row.warnings.length > 0 && row.status !== 'invalid' && (
                            <span style={{ color: 'var(--ops-warn)', display: 'block' }}>{row.warnings[0]}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="ops-card-body">
              {summary.needsReview > 0 && (
                <div className="ops-banner info">
                  <div>
                    {summary.needsReview} row{summary.needsReview === 1 ? '' : 's'} will be
                    <strong> imported and flagged</strong>. The address could not be fully split, so
                    it is kept exactly as it appeared in your file for someone to tidy up. Nothing is
                    discarded.
                  </div>
                </div>
              )}

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
                  disabled={willImportCount === 0}>
                  Import {willImportCount.toLocaleString()}{' '}
                  {isProspectMode
                    ? `property prospect${willImportCount === 1 ? '' : 's'}`
                    : `lead${willImportCount === 1 ? '' : 's'}`}
                </button>
                <button
                  type="button" className="ops-btn"
                  onClick={() => {
                    cancelPendingJob(importJobId)
                    setImportJobId(null)
                    setStep('map')
                  }}
                >
                  Back to mapping
                </button>
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
              {totals.processed.toLocaleString()} row{totals.processed === 1 ? '' : 's'} processed ·{' '}
              {totals.imported.toLocaleString()}{' '}
              {isProspectMode
                ? `property prospect${totals.imported === 1 ? '' : 's'} created`
                : `lead${totals.imported === 1 ? '' : 's'} added`}
              {totals.updated > 0 && `, ${totals.updated} existing updated`}
              {totals.skipped > 0 && `, ${totals.skipped} duplicate${totals.skipped === 1 ? '' : 's'} skipped`}
              {totals.needsReview > 0 && `, ${totals.needsReview} need${totals.needsReview === 1 ? 's' : ''} review`}
              {`, ${totals.failed} failed`}.
            </div>
          </div>

          <div className="ops-kpis">
            <Kpi label={isProspectMode ? 'Prospects created' : 'Imported'} value={totals.imported} tone="ok" />
            <Kpi label="Updated" value={totals.updated} />
            <Kpi label="Skipped" value={totals.skipped} />
            <Kpi label="Needs review" value={totals.needsReview} tone={totals.needsReview > 0 ? 'warn' : undefined} />
            <Kpi label="Failed" value={totals.failed} tone={totals.failed > 0 ? 'alert' : undefined} />
          </div>

          <div className="ops-card">
            <div className="ops-card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <a
                className="ops-btn ops-btn-primary"
                href={isProspectMode ? '/ops/leads?type=property_prospect' : '/ops/leads'}
              >
                {isProspectMode ? 'View the imported prospects' : 'Open the leads list'}
              </a>
              {importTag && (
                <a className="ops-btn" href={`/ops/leads?batch=${encodeURIComponent(importTag)}`}>
                  Filter by “{importTag}”
                </a>
              )}
              {totals.needsReview > 0 && (
                <a className="ops-btn" href="/ops/leads?stage=needs_contact_info">
                  Review flagged rows
                </a>
              )}
              {(totals.failed > 0 || totals.skipped > 0) && importJobId && (
                <a className="ops-btn" href={`/api/leads/import/${importJobId}?format=csv`}>
                  <Download aria-hidden="true" /> Download the error report
                </a>
              )}
              <button type="button" className="ops-btn" onClick={() => window.location.reload()}>
                Start another import
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
