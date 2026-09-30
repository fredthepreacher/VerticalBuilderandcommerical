'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check, X, Home, Ruler, AlertTriangle, RotateCcw, ChevronDown, ChevronUp, Keyboard, MapPin, ExternalLink,
} from 'lucide-react'
import { reviewProspectAction, reopenProspectAction, enterManualMeasurementAction } from '@/app/ops/actions/prospecting'
import type { ReviewProspect } from '@/lib/ops/prospecting/review-queue'
import type { ReviewAction } from '@/lib/ops/prospecting/review'

/**
 * Rapid Roof Review console. Keyboard-first: a decision saves, confirms, and
 * advances to the next prospect. Every action is also a button (touch/iPad).
 * Decisions carry the review_version the operator saw, so a concurrent edit by
 * another reviewer is reported, not overwritten. No modal per property.
 */

const KEY_ACTIONS: Record<string, ReviewAction> = {
  a: 'approve', n: 'reject_new_roof', w: 'reject_wrong_roof_type',
  d: 'reject_duplicate', b: 'reject_bad_address', o: 'reject_not_opportunity',
  m: 'manual_measurement', f: 'follow_up',
}

const ACTION_LABEL: Record<ReviewAction, string> = {
  approve: 'Approve', reject_new_roof: 'New roof', reject_wrong_roof_type: 'Wrong type',
  reject_duplicate: 'Duplicate', reject_bad_address: 'Bad address', reject_not_opportunity: 'Not an opp.',
  manual_measurement: 'Manual measure', follow_up: 'Follow-up',
}

export default function ReviewConsole({
  prospects, canMeasure,
}: {
  prospects: ReviewProspect[]
  canMeasure: boolean
}) {
  const router = useRouter()
  const [queue, setQueue] = useState(prospects)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKeys, setShowKeys] = useState(false)
  const [showMeasure, setShowMeasure] = useState(false)
  const [note, setNote] = useState('')
  const [lastDecided, setLastDecided] = useState<{ prospect: ReviewProspect } | null>(null)
  const measureRef = useRef<HTMLFormElement>(null)

  const current = queue[index] ?? null

  const post = useCallback(async (path: 'review' | 'reopen', form: FormData) => {
    const fn = path === 'review' ? reviewProspectAction : reopenProspectAction
    return fn({}, form)
  }, [])

  const decide = useCallback(async (action: ReviewAction) => {
    if (!current || busy) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set('prospect_id', current.id)
    form.set('action', action)
    form.set('expected_version', String(current.review_version))
    if (note.trim()) form.set('note', note.trim())
    const res = await reviewProspectAction({}, form)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'Could not save.')
      if (res.data && (res.data as { conflict?: boolean }).conflict) router.refresh()
      return
    }
    setLastDecided({ prospect: current })
    setFlash(`${ACTION_LABEL[action]} · ${current.property_address ?? 'prospect'}`)
    setNote(''); setShowMeasure(false)
    // Remove from local queue and keep index pointing at the next one.
    setQueue(q => q.filter((_, i) => i !== index))
    setIndex(i => Math.min(i, queue.length - 2 < 0 ? 0 : queue.length - 2))
  }, [current, busy, note, index, queue.length, router])

  const undo = useCallback(async () => {
    if (!lastDecided || busy) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set('prospect_id', lastDecided.prospect.id)
    // The decision bumped the version by 1; reopen against that new version.
    form.set('expected_version', String(lastDecided.prospect.review_version + 1))
    const res = await reopenProspectAction({}, form)
    setBusy(false)
    if (!res.ok) { setError(res.error ?? 'Could not undo.'); router.refresh(); return }
    setFlash('Reopened the last prospect')
    setLastDecided(null)
    router.refresh()
  }, [lastDecided, busy, router])

  const move = useCallback((delta: number) => {
    setIndex(i => Math.max(0, Math.min(queue.length - 1, i + delta)))
  }, [queue.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (KEY_ACTIONS[k]) { e.preventDefault(); void decide(KEY_ACTIONS[k]) }
      else if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
      else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
      else if (k === 'u') { e.preventDefault(); void undo() }
      else if (k === '?') { e.preventDefault(); setShowKeys(s => !s) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [decide, move, undo])

  if (queue.length === 0) {
    return (
      <div className="ops-card"><div className="ops-card-body">
        <div className="ops-banner ok" role="status"><Check aria-hidden="true" /><div><strong>Queue clear.</strong> Nothing left to review in this filter.</div></div>
        {lastDecided && <button className="ops-btn" onClick={undo} disabled={busy}><RotateCcw aria-hidden="true" /> Undo last</button>}
        <div style={{ marginTop: 12 }}><a className="ops-btn" href="/ops/prospecting">Back to Roof Prospecting</a></div>
      </div></div>
    )
  }

  const p = current!
  const addr = [p.city, p.state, p.zip].filter(Boolean).join(' ')
  const bandTone = p.confidence_band === 'high' ? 'ok' : p.confidence_band === 'medium' ? 'warn' : 'bad'
  const mapHref = p.property_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.property_address, addr].filter(Boolean).join(', '))}`
    : null

  return (
    <div>
      {flash && <div className="ops-banner ok" role="status" aria-live="polite"><Check aria-hidden="true" /><div>{flash}</div></div>}
      {error && <div className="ops-banner bad" role="alert"><AlertTriangle aria-hidden="true" /><div>{error}</div></div>}

      <div className="ops-review-head">
        <div className="ops-sub2">{index + 1} of {queue.length} in this queue</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {lastDecided && <button className="ops-btn ops-btn-sm" onClick={undo} disabled={busy}><RotateCcw aria-hidden="true" /> Undo (U)</button>}
          <button className="ops-btn ops-btn-sm" onClick={() => setShowKeys(s => !s)} aria-expanded={showKeys}><Keyboard aria-hidden="true" /> Keys</button>
        </div>
      </div>

      {showKeys && (
        <div className="ops-card" style={{ marginBottom: 12 }}><div className="ops-card-body ops-keylegend">
          <span><kbd>A</kbd> Approve</span><span><kbd>N</kbd> New roof</span><span><kbd>W</kbd> Wrong type</span>
          <span><kbd>D</kbd> Duplicate</span><span><kbd>B</kbd> Bad address</span><span><kbd>O</kbd> Not an opp.</span>
          <span><kbd>M</kbd> Manual measure</span><span><kbd>F</kbd> Follow-up</span>
          <span><kbd>J</kbd>/<kbd>↓</kbd> Next</span><span><kbd>K</kbd>/<kbd>↑</kbd> Prev</span><span><kbd>U</kbd> Undo</span>
        </div></div>
      )}

      <div className="ops-review-grid">
        {/* Evidence */}
        <div className="ops-card">
          <div className="ops-card-head">
            <h2><MapPin aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {p.property_address ?? 'No address'}</h2>
            <span className={`ops-badge is-${bandTone}`}>{(p.confidence_band ?? 'unrated').toUpperCase()} confidence</span>
          </div>
          <div className="ops-card-body">
            <div className="ops-review-cols">
              <section>
                <h3 className="ops-review-h">Property</h3>
                <dl className="ops-deflist">
                  <dt>Address</dt><dd>{p.property_address ?? '—'}<br />{addr}</dd>
                  <dt>Mailing</dt><dd>{p.mailing_address ? <>{p.mailing_address}</> : <span className="ops-faint">same as property</span>}</dd>
                  <dt>Owner</dt><dd>{p.owner_name ?? '—'}</dd>
                  <dt>Parcel</dt><dd>{p.parcel_apn ?? '—'}</dd>
                  <dt>Campaign</dt><dd>{p.campaign_name ?? '—'}{p.county ? ` · ${p.county}` : ''}</dd>
                </dl>
              </section>
              <section>
                <h3 className="ops-review-h">Permit <SourceTag>PERMIT DATA</SourceTag></h3>
                <dl className="ops-deflist">
                  <dt>Class</dt><dd>{p.permit_class ?? '—'}</dd>
                  <dt>Type</dt><dd>{p.permit_type ?? '—'}</dd>
                  <dt>Date</dt><dd>{p.permit_date ?? '—'}</dd>
                  <dt>Material</dt><dd>{p.roof_type ?? '—'}</dd>
                  <dt>Description</dt><dd className="ops-faint" style={{ whiteSpace: 'pre-wrap' }}>{p.permit_description ?? '—'}</dd>
                </dl>
              </section>
              <section>
                <h3 className="ops-review-h">Measurement {p.measurement ? <SourceTag>{(p.measurement.provider ?? 'MANUAL').toUpperCase()}</SourceTag> : <SourceTag>NONE</SourceTag>}</h3>
                {p.measurement ? (
                  <dl className="ops-deflist">
                    <dt>Type</dt><dd>{p.measurement.measurement_type ?? '—'}</dd>
                    <dt>Roof sq ft</dt><dd>{p.measurement.roof_area_sqft ?? '—'}</dd>
                    <dt>Base squares</dt><dd>{p.measured_squares ?? p.measurement.roof_area_squares ?? '—'}</dd>
                    <dt>Waste</dt><dd>{p.waste_squares != null ? `+${p.waste_squares} (${p.waste_rule_applied ?? 'rule'})` : '—'}</dd>
                    <dt>Final squares</dt><dd><strong>{p.final_squares ?? '—'}</strong> <SourceTag>DERIVED</SourceTag></dd>
                  </dl>
                ) : (
                  <p className="ops-hint">No roof measurement yet. Enter one below, or press <kbd>M</kbd> to request one.</p>
                )}
              </section>
            </div>

            <div className="ops-review-screening">
              <h3 className="ops-review-h">Why this needs review</h3>
              <ul className="ops-reasonlist">
                {(p.confidence_reasons.length ? p.confidence_reasons : [p.screening_reason ?? 'Awaiting review']).map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              {mapHref && (
                <a className="ops-btn ops-btn-sm" href={mapHref} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden="true" /> Open in Maps
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Decision rail */}
        <div className="ops-card ops-review-actions-card">
          <div className="ops-card-body">
            <label className="ops-field" style={{ marginBottom: 10 }}>
              <span className="ops-review-h">Note (optional)</span>
              <textarea className="ops-textarea" rows={2} value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. second structure on parcel" />
            </label>

            <div className="ops-review-actions">
              <button className="ops-btn ops-btn-primary" disabled={busy} onClick={() => decide('approve')}><Check aria-hidden="true" /> Approve <kbd>A</kbd></button>
              <button className="ops-btn ops-btn-danger" disabled={busy} onClick={() => decide('reject_new_roof')}><X aria-hidden="true" /> New roof <kbd>N</kbd></button>
              <button className="ops-btn ops-btn-danger" disabled={busy} onClick={() => decide('reject_wrong_roof_type')}><X aria-hidden="true" /> Wrong type <kbd>W</kbd></button>
              <button className="ops-btn ops-btn-danger" disabled={busy} onClick={() => decide('reject_duplicate')}><X aria-hidden="true" /> Duplicate <kbd>D</kbd></button>
              <button className="ops-btn ops-btn-danger" disabled={busy} onClick={() => decide('reject_bad_address')}><X aria-hidden="true" /> Bad address <kbd>B</kbd></button>
              <button className="ops-btn ops-btn-danger" disabled={busy} onClick={() => decide('reject_not_opportunity')}><X aria-hidden="true" /> Not an opp. <kbd>O</kbd></button>
              <button className="ops-btn" disabled={busy} onClick={() => decide('manual_measurement')}><Ruler aria-hidden="true" /> Manual measure <kbd>M</kbd></button>
              <button className="ops-btn" disabled={busy} onClick={() => decide('follow_up')}><AlertTriangle aria-hidden="true" /> Follow-up <kbd>F</kbd></button>
            </div>

            <div style={{ marginTop: 14 }}>
              <button className="ops-btn ops-btn-sm" onClick={() => move(1)} disabled={busy}><ChevronDown aria-hidden="true" /> Skip (J)</button>
              <button className="ops-btn ops-btn-sm" onClick={() => move(-1)} disabled={busy}><ChevronUp aria-hidden="true" /> Prev (K)</button>
            </div>

            {canMeasure && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--ops-line)', paddingTop: 12 }}>
                <button className="ops-btn ops-btn-sm" onClick={() => setShowMeasure(s => !s)} aria-expanded={showMeasure}>
                  <Ruler aria-hidden="true" /> Enter manual measurement
                </button>
                {showMeasure && (
                  <form ref={measureRef} className="ops-measure-form" action={async (fd) => {
                    setBusy(true); setError(null)
                    fd.set('prospect_id', p.id)
                    const res = await enterManualMeasurementAction({}, fd)
                    setBusy(false)
                    if (!res.ok) { setError(res.error ?? 'Could not save measurement.'); return }
                    setFlash('Measurement saved — re-screened'); setShowMeasure(false); router.refresh()
                  }}>
                    <div className="ops-grid-2">
                      <label className="ops-field"><span>Roof squares</span><input className="ops-input" name="squares" inputMode="decimal" placeholder="e.g. 53" /></label>
                      <label className="ops-field"><span>or Sq ft</span><input className="ops-input" name="sqft" inputMode="decimal" placeholder="e.g. 5300" /></label>
                    </div>
                    <button className="ops-btn ops-btn-primary ops-btn-sm" type="submit" disabled={busy}>Save & re-screen</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SourceTag({ children }: { children: React.ReactNode }) {
  return <span className="ops-source-tag">{children}</span>
}
