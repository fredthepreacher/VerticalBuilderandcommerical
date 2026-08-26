'use client'

import { useState } from 'react'
import { Ruler, Satellite } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { orderMeasurement, saveMeasurement } from '@/app/ops/actions/estimates'
import { MEASUREMENT_PROVIDER_LABELS, type RoofMeasurement } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import { Badge } from './StatusBadge'

/**
 * Roof measurements.
 *
 * Three honest sources, in the order the office will actually use them:
 * order from a provider (if one is connected), upload a report someone else
 * produced, or type in what was measured on site. There is no fourth option
 * where the software guesses from a satellite picture.
 */
export default function MeasurementPanel({
  estimateId,
  projectId,
  address,
  measurements,
  providerState,
  canOrder,
  canCreate,
}: {
  estimateId?: string
  projectId?: string
  address: string
  measurements: RoofMeasurement[]
  providerState: { selected: string; displayName: string; configured: boolean; action: string }
  canOrder: boolean
  canCreate: boolean
}) {
  const [showManual, setShowManual] = useState(measurements.length === 0)
  const current = measurements[0]

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Ruler aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
        <h2>Roof measurement</h2>
        {current && (
          <div className="ops-card-actions">
            <Badge tone={current.status === 'complete' ? 'ok' : current.status === 'failed' ? 'bad' : 'warn'}>
              {current.status === 'complete' ? 'On file' : current.status}
            </Badge>
          </div>
        )}
      </div>

      <div className="ops-card-body">
        {current && current.status === 'complete' ? (
          <>
            <dl className="ops-deflist">
              <dt>Area</dt>
              <dd>
                <strong>{current.roof_area_squares ?? '—'} squares</strong>
                {current.roof_area_sqft ? ` (${Math.round(current.roof_area_sqft).toLocaleString()} sq ft)` : ''}
              </dd>
              <dt>Predominant pitch</dt><dd>{current.primary_pitch ?? 'Not recorded'}</dd>
              <dt>Facets</dt><dd>{current.facet_count ?? 'Not recorded'}</dd>
              <dt>Ridge / hip</dt>
              <dd>{fmt(current.ridge_lf)} / {fmt(current.hip_lf)} lf</dd>
              <dt>Valley</dt><dd>{fmt(current.valley_lf)} lf</dd>
              <dt>Eave / rake</dt><dd>{fmt(current.eave_lf)} / {fmt(current.rake_lf)} lf</dd>
              <dt>Waste factor</dt><dd>{current.waste_factor_percent ?? 'Not specified'}%</dd>
              <dt>Source</dt>
              <dd>
                {MEASUREMENT_PROVIDER_LABELS[current.provider] ?? current.provider}
                {current.completed_at ? ` · ${formatDate(current.completed_at)}` : ''}
              </dd>
            </dl>

            {current.source_document_id && (
              <a className="ops-btn ops-btn-sm" style={{ marginTop: 12 }}
                href={`/api/documents/${current.source_document_id}/download`} rel="noopener">
                Open the source report
              </a>
            )}

            <p className="ops-hint" style={{ marginTop: 12 }}>
              These figures feed the AI draft and can be typed straight into a line quantity.
              They are only as good as their source — check them against the job.
            </p>
          </>
        ) : (
          <div className="ops-banner neutral" style={{ marginBottom: 0 }}>
            <div>
              <strong>No measurement attached</strong>
              An estimate without one is still perfectly usable — the PDF and the AI draft will
              simply say the quantities came from the description rather than a measured roof.
            </div>
          </div>
        )}

        {/* ---- ordering ---------------------------------------------------- */}
        {canOrder && providerState.configured && providerState.selected !== 'manual' && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--ops-line)' }}>
            <ActionForm action={orderMeasurement}>
              {() => (
                <>
                  <input type="hidden" name="address" value={address} />
                  {estimateId && <input type="hidden" name="estimate_id" value={estimateId} />}
                  {projectId && <input type="hidden" name="project_id" value={projectId} />}
                  <SubmitButton className="ops-btn ops-btn-sm ops-btn-dark" pendingLabel="Ordering…">
                    <Satellite aria-hidden="true" /> Order from {providerState.displayName}
                  </SubmitButton>
                  <p className="ops-hint" style={{ marginTop: 6 }}>
                    Ordering a report usually costs money per property.
                  </p>
                </>
              )}
            </ActionForm>
          </div>
        )}

        {!providerState.configured && (
          <p className="ops-hint" style={{ marginTop: 14 }}>{providerState.action}</p>
        )}

        {/* ---- manual entry ------------------------------------------------ */}
        {canCreate && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--ops-line)' }}>
            <button type="button" className="ops-btn ops-btn-sm" onClick={() => setShowManual(s => !s)}>
              {showManual ? 'Hide manual entry' : current ? 'Record a new measurement' : 'Enter measurement by hand'}
            </button>

            {showManual && (
              <div style={{ marginTop: 14 }}>
                <ActionForm action={saveMeasurement} encType="multipart/form-data">
                  {state => (
                    <>
                      <input type="hidden" name="address" value={address} />
                      {estimateId && <input type="hidden" name="estimate_id" value={estimateId} />}
                      {projectId && <input type="hidden" name="project_id" value={projectId} />}

                      <div className="ops-field">
                        <label htmlFor="m-provider">Where did this come from?</label>
                        <select id="m-provider" name="provider" className="ops-select" defaultValue="manual">
                          <option value="manual">Measured on site</option>
                          <option value="uploaded_report">Third-party report (EagleView, adjuster, etc.)</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div className="ops-grid-2">
                        <Num label="Roof area (squares)" name="roof_area_squares" placeholder="24.5" />
                        <Num label="…or square feet" name="roof_area_sqft" placeholder="2450" />
                      </div>
                      {state.fieldErrors?.roof_area_squares && (
                        <p className="ops-error">{state.fieldErrors.roof_area_squares[0]}</p>
                      )}

                      <div className="ops-grid-3">
                        <Text label="Predominant pitch" name="primary_pitch" placeholder="6/12" />
                        <Num label="Facets" name="facet_count" placeholder="8" />
                        <Num label="Waste %" name="waste_factor_percent" placeholder="10" />
                      </div>

                      <div className="ops-grid-3">
                        <Num label="Ridge (lf)" name="ridge_lf" />
                        <Num label="Hip (lf)" name="hip_lf" />
                        <Num label="Valley (lf)" name="valley_lf" />
                      </div>
                      <div className="ops-grid-2">
                        <Num label="Eave (lf)" name="eave_lf" />
                        <Num label="Rake (lf)" name="rake_lf" />
                      </div>

                      <div className="ops-field">
                        <label htmlFor="m-report">Attach the report (optional)</label>
                        <input id="m-report" name="report_file" type="file" className="ops-input"
                          accept="application/pdf,image/jpeg,image/png" />
                      </div>

                      <div className="ops-field">
                        <label htmlFor="m-notes">Notes</label>
                        <textarea id="m-notes" name="notes" rows={2} className="ops-textarea"
                          placeholder="Measured from the ground with a laser; two-storey rear section estimated." />
                      </div>

                      <SubmitButton className="ops-btn ops-btn-primary" pendingLabel="Saving…">
                        Save measurement
                      </SubmitButton>
                    </>
                  )}
                </ActionForm>
              </div>
            )}
          </div>
        )}

        {measurements.length > 1 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--ops-line)' }}>
            <strong style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--ops-muted)' }}>
              Earlier measurements
            </strong>
            <ul style={{ marginTop: 8, display: 'grid', gap: 6 }}>
              {measurements.slice(1).map(m => (
                <li key={m.id} style={{ fontSize: '.79rem', color: 'var(--ops-muted)' }}>
                  {m.roof_area_squares ?? '—'} squares ·{' '}
                  {MEASUREMENT_PROVIDER_LABELS[m.provider] ?? m.provider} ·{' '}
                  {formatDate(m.created_at)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

function Num({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  return (
    <div className="ops-field">
      <label htmlFor={`m-${name}`}>{label}</label>
      <input id={`m-${name}`} name={name} className="ops-input" inputMode="decimal" placeholder={placeholder} />
    </div>
  )
}

function Text({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  return (
    <div className="ops-field">
      <label htmlFor={`m-${name}`}>{label}</label>
      <input id={`m-${name}`} name={name} className="ops-input" placeholder={placeholder} />
    </div>
  )
}

function fmt(value: number | null): string {
  return value === null || value === undefined ? '—' : String(Math.round(value))
}
