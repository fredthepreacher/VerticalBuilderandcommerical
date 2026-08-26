'use client'

import { useState, useTransition } from 'react'
import { Sparkles, AlertTriangle, ShieldCheck, X } from 'lucide-react'
import { analyzeCoiAction, applyCoiExtractionAction, rejectCoiExtractionAction } from '@/app/ops/actions/ai'
import { ActionForm, SubmitButton } from './Form'
import type { CoiExtraction, CoiCoverage } from '@/lib/ops/ai/schemas'
import { COVERAGE_LABELS, type CoverageType } from '@/lib/ops/types'

/**
 * COI extraction and review.
 *
 * The screen is built around one message: **AI extracted — not yet verified.**
 * Everything is an editable input, nothing is applied until the reviewer presses
 * Apply, and fields the model was unsure about (or left blank) are highlighted
 * rather than quietly presented as fact.
 *
 * Applying runs the existing certificate path and then the existing
 * deterministic evaluator. The AI never sets a compliance status.
 */

export interface CoiDraftRow {
  id: string
  documentId: string
  filename: string
  status: 'pending' | 'applied' | 'rejected'
  extracted: CoiExtraction
  lowConfidenceFields: string[]
  createdAt: string
}

const COVERAGE_OPTIONS: CoverageType[] = [
  'general_liability', 'workers_compensation', 'commercial_auto', 'umbrella',
  'professional_liability', 'pollution_liability', 'other',
]

export function AnalyzeCoiButton({
  documentId,
  configured,
  enabled,
}: {
  documentId: string
  configured: boolean
  enabled: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const why = !configured
    ? 'AI is not configured'
    : !enabled ? 'COI extraction is switched off in Settings → AI' : null

  return (
    <>
      <button
        type="button" className="ops-btn ops-btn-sm"
        disabled={pending || Boolean(why)}
        title={why ?? 'Read this certificate with AI and produce a draft for review'}
        onClick={() => {
          setError(null)
          start(async () => {
            const result = await analyzeCoiAction(documentId)
            if (result.ok === false) setError(result.error ?? 'The analysis failed.')
          })
        }}
      >
        <Sparkles aria-hidden="true" /> {pending ? 'Reading…' : 'Analyze COI with AI'}
      </button>
      {error && <p className="ops-error" style={{ marginTop: 6 }}>{error}</p>}
    </>
  )
}

export default function CoiExtractionReview({ draft }: { draft: CoiDraftRow }) {
  const [data, setData] = useState<CoiExtraction>(draft.extracted)
  const [rejecting, startReject] = useTransition()
  const [rejected, setRejected] = useState(false)

  if (rejected || draft.status !== 'pending') return null

  const lowFor = (index: number) =>
    draft.lowConfidenceFields.some(f => f.startsWith(`coverages.${index}`))

  function updateCoverage(index: number, patch: Partial<CoiCoverage>) {
    setData(d => ({
      ...d,
      coverages: d.coverages.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }))
  }

  return (
    <section className="ops-card" style={{ borderColor: '#d9c8f0' }}>
      <div className="ops-card-head">
        <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
        <h2>AI extracted — not yet verified</h2>
        <div className="ops-card-actions">
          <button
            type="button" className="ops-btn ops-btn-sm" disabled={rejecting}
            onClick={() => startReject(async () => {
              await rejectCoiExtractionAction(draft.id)
              setRejected(true)
            })}
          >
            <X aria-hidden="true" /> Discard
          </button>
        </div>
      </div>

      <div className="ops-card-body">
        <div className="ops-banner warn" style={{ marginBottom: 14 }}>
          <AlertTriangle aria-hidden="true" />
          <div>
            These values were read off <strong>{draft.filename}</strong> by AI and have{' '}
            <strong>not been checked</strong>. Nothing has been saved to this subcontractor.
            Correct anything that is wrong, then apply — the compliance result is calculated
            from what you approve, not from what the AI produced.
          </div>
        </div>

        {draft.lowConfidenceFields.length > 0 && (
          <div className="ops-ai-flag" style={{ marginBottom: 14 }}>
            <strong>Look at these first:</strong>
            <ul>
              {draft.lowConfidenceFields.slice(0, 12).map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}

        {data.warnings.length > 0 && (
          <div className="ops-ai-flag" style={{ marginBottom: 14 }}>
            <strong>The AI flagged:</strong>
            <ul>{data.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        <div className="ops-grid-3">
          <div className="ops-field">
            <label htmlFor="coi-insured">Named insured</label>
            <input id="coi-insured" className="ops-input" value={data.namedInsured ?? ''}
              onChange={e => setData(d => ({ ...d, namedInsured: e.target.value || null }))} />
          </div>
          <div className="ops-field">
            <label htmlFor="coi-holder">Certificate holder</label>
            <input id="coi-holder" className="ops-input" value={data.certificateHolder ?? ''}
              onChange={e => setData(d => ({ ...d, certificateHolder: e.target.value || null }))} />
          </div>
          <div className="ops-field">
            <label htmlFor="coi-producer">Producer / agency</label>
            <input id="coi-producer" className="ops-input" value={data.producer ?? ''}
              onChange={e => setData(d => ({ ...d, producer: e.target.value || null }))} />
          </div>
        </div>

        <h3 style={{ fontSize: '.84rem', margin: '16px 0 0' }}>
          Coverage lines ({data.coverages.length})
        </h3>

        {data.coverages.length === 0 && (
          <p className="ops-hint">
            No coverage lines were found on this document. Nothing can be applied — enter the
            certificate by hand instead.
          </p>
        )}

        {data.coverages.map((coverage, index) => (
          <div key={index} className={`ops-ai-review-row${lowFor(index) ? ' is-low' : ''}`}>
            <div className="ops-ai-review-head">
              {COVERAGE_LABELS[coverage.coverageType] ?? coverage.coverageType}
              {coverage.confidence !== null && (
                <span className="ops-hint">
                  confidence {Math.round(coverage.confidence * 100)}%
                </span>
              )}
              {lowFor(index) && (
                <span className="ops-chip" style={{ background: 'var(--ops-warn-soft)', color: 'var(--ops-warn)' }}>
                  needs a look
                </span>
              )}
            </div>

            <div className="ops-grid-3">
              <div className="ops-field">
                <label htmlFor={`cov-${index}-type`}>Coverage</label>
                <select id={`cov-${index}-type`} className="ops-select" value={coverage.coverageType}
                  onChange={e => updateCoverage(index, { coverageType: e.target.value as CoverageType })}>
                  {COVERAGE_OPTIONS.map(c => (
                    <option key={c} value={c}>{COVERAGE_LABELS[c] ?? c}</option>
                  ))}
                </select>
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-carrier`}>Carrier</label>
                <input id={`cov-${index}-carrier`} className="ops-input" value={coverage.carrier ?? ''}
                  placeholder="not found — type it in"
                  onChange={e => updateCoverage(index, { carrier: e.target.value || null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-policy`}>Policy number</label>
                <input id={`cov-${index}-policy`} className="ops-input" value={coverage.policyNumber ?? ''}
                  placeholder="not found — type it in"
                  onChange={e => updateCoverage(index, { policyNumber: e.target.value || null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-eff`}>Effective</label>
                <input id={`cov-${index}-eff`} type="date" className="ops-input" value={coverage.effectiveDate ?? ''}
                  onChange={e => updateCoverage(index, { effectiveDate: e.target.value || null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-exp`}>Expires</label>
                <input id={`cov-${index}-exp`} type="date" className="ops-input" value={coverage.expirationDate ?? ''}
                  onChange={e => updateCoverage(index, { expirationDate: e.target.value || null })} />
                {!coverage.expirationDate && (
                  <p className="ops-error">No expiration date was found. Compliance depends on this.</p>
                )}
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-occ`}>Each occurrence ($)</label>
                <input id={`cov-${index}-occ`} type="number" min="0" className="ops-input"
                  value={coverage.eachOccurrence ?? ''}
                  onChange={e => updateCoverage(index, { eachOccurrence: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-agg`}>General aggregate ($)</label>
                <input id={`cov-${index}-agg`} type="number" min="0" className="ops-input"
                  value={coverage.generalAggregate ?? ''}
                  onChange={e => updateCoverage(index, { generalAggregate: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-csl`}>Combined single limit ($)</label>
                <input id={`cov-${index}-csl`} type="number" min="0" className="ops-input"
                  value={coverage.combinedSingleLimit ?? ''}
                  onChange={e => updateCoverage(index, { combinedSingleLimit: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <div className="ops-field">
                <label htmlFor={`cov-${index}-el`}>Employers liability ($)</label>
                <input id={`cov-${index}-el`} type="number" min="0" className="ops-input"
                  value={coverage.employersLiability ?? ''}
                  onChange={e => updateCoverage(index, { employersLiability: e.target.value ? Number(e.target.value) : null })} />
              </div>
            </div>

            <div className="ops-chips">
              {([
                ['additionalInsured', 'Additional insured'],
                ['waiverOfSubrogation', 'Waiver of subrogation'],
                ['primaryNoncontributory', 'Primary & non-contributory'],
              ] as const).map(([key, label]) => (
                <label key={key} className="ops-check">
                  <input
                    type="checkbox"
                    checked={coverage[key] === true}
                    onChange={e => updateCoverage(index, { [key]: e.target.checked } as Partial<CoiCoverage>)}
                  />
                  <span>
                    {label}
                    {coverage[key] === null && (
                      <span className="ops-hint" style={{ display: 'block' }}>
                        Not clear on the document — tick only if you can see it
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <ActionForm action={applyCoiExtractionAction}>
          {state => (
            <>
              <input type="hidden" name="draft_id" value={draft.id} />
              <input type="hidden" name="reviewed" value={JSON.stringify(data)} />
              {state.error && <p className="ops-error">{state.error}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <SubmitButton
                  className="ops-btn ops-btn-primary"
                  pendingLabel="Applying…"
                >
                  <ShieldCheck aria-hidden="true" /> Apply reviewed extraction
                </SubmitButton>
              </div>
              <p className="ops-hint" style={{ marginTop: 8 }}>
                Creates a new certificate version from the values above and recalculates
                compliance with the normal rules. Previous certificates are kept.
              </p>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}
