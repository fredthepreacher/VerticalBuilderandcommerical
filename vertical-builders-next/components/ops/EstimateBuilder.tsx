'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, GripVertical, Plus, Sparkles, Trash2 } from 'lucide-react'
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { generateAiDraft, saveEstimateAction } from '@/app/ops/actions/estimates'
import { calculateTotals, lineTotalCents } from '@/lib/ops/finance/calc'
import { formatCents } from '@/lib/ops/utils/money'
import {
  AI_ESTIMATE_DISCLAIMER, ESTIMATE_STATUS_LABELS, UNITS,
  type EstimateStatus, type PricebookItem,
} from '@/lib/ops/types'
import { SERVICE_TYPES } from '@/lib/ops/constants'
import type { ActionState } from '@/lib/ops/actions-shared'

/**
 * The estimate builder.
 *
 * Totals recalculate in the browser as you type so the number is never a
 * surprise, but the server recomputes them from the same pure function on save
 * — the client figure is a preview, never the stored value.
 */

export interface BuilderLine {
  key: number
  id?: string
  category: string
  description: string
  quantity: string
  unit: string
  unitPrice: string
  pricebookItemId: string
  source: string
  aiGenerated: boolean
  needsReview: boolean
  reviewed: boolean
  notes: string
}

export interface EstimateBuilderValues {
  id?: string
  title?: string
  status?: EstimateStatus
  contact_id?: string | null
  lead_id?: string | null
  project_id?: string | null
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  service_type?: string | null
  scope_summary?: string | null
  discount_cents?: number
  tax_percent?: number
  valid_until?: string | null
  customer_notes?: string | null
  internal_notes?: string | null
  assigned_to?: string | null
  lines?: BuilderLine[]
}

let nextKey = 1

function blankLine(): BuilderLine {
  return {
    key: nextKey++,
    category: '', description: '', quantity: '1', unit: 'EA', unitPrice: '',
    pricebookItemId: '', source: 'manual', aiGenerated: false,
    needsReview: false, reviewed: false, notes: '',
  }
}

export default function EstimateBuilder({
  estimate,
  clients,
  staff,
  pricebook,
  taxEnabled,
}: {
  estimate?: EstimateBuilderValues
  clients: { id: string; label: string }[]
  staff: { id: string; label: string }[]
  pricebook: PricebookItem[]
  taxEnabled: boolean
}) {
  const [lines, setLines] = useState<BuilderLine[]>(
    estimate?.lines?.length ? estimate.lines : [blankLine()],
  )
  const [discount, setDiscount] = useState(
    estimate?.discount_cents ? String(estimate.discount_cents / 100) : '',
  )
  const [taxPercent, setTaxPercent] = useState(String(estimate?.tax_percent ?? 0))

  const action = saveEstimateAction.bind(null, estimate?.id ?? null)

  const totals = useMemo(
    () =>
      calculateTotals({
        lines: lines.map(l => ({
          quantity: Number(l.quantity) || 0,
          unitPriceCents: Math.round((Number(l.unitPrice) || 0) * 100),
        })),
        discountCents: Math.round((Number(discount) || 0) * 100),
        taxPercent: Number(taxPercent) || 0,
        taxEnabled,
      }),
    [lines, discount, taxPercent, taxEnabled],
  )

  const unreviewed = lines.filter(l => l.needsReview && !l.reviewed).length

  function update(key: number, patch: Partial<BuilderLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  function applyPricebookItem(key: number, itemId: string) {
    const item = pricebook.find(p => p.id === itemId)
    if (!item) {
      update(key, { pricebookItemId: '', source: 'manual' })
      return
    }
    update(key, {
      pricebookItemId: itemId,
      description: item.name,
      unit: item.unit,
      unitPrice: item.default_unit_price_cents ? String(item.default_unit_price_cents / 100) : '',
      category: item.category ?? '',
      source: 'pricebook',
      // An item the company has not priced yet still needs a human decision.
      needsReview: !item.default_unit_price_cents,
      reviewed: false,
    })
  }

  function move(key: number, direction: -1 | 1) {
    setLines(prev => {
      const index = prev.findIndex(l => l.key === key)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          {unreviewed > 0 && (
            <div className="ops-banner warn" role="status">
              <AlertTriangle aria-hidden="true" />
              <div>
                <strong>{unreviewed} line{unreviewed === 1 ? '' : 's'} still need your review</strong>
                {AI_ESTIMATE_DISCLAIMER} Tick “reviewed” on each one once you have confirmed the
                quantity and price. This estimate cannot be sent until they are all cleared.
              </div>
            </div>
          )}

          {/* ---- header --------------------------------------------------- */}
          <div className="ops-card">
            <div className="ops-card-head">
              <h2>Client &amp; property</h2>
              {estimate?.status && (
                <div className="ops-card-actions">
                  <span className="ops-hint">{ESTIMATE_STATUS_LABELS[estimate.status]}</span>
                </div>
              )}
            </div>
            <div className="ops-card-body">
              <input type="hidden" name="status" value={estimate?.status ?? 'draft'} />
              {estimate?.lead_id && <input type="hidden" name="lead_id" value={estimate.lead_id} />}
              {estimate?.project_id && <input type="hidden" name="project_id" value={estimate.project_id} />}

              <Field label="Estimate title" name="title" required
                defaultValue={estimate?.title} errors={state.fieldErrors}
                placeholder="Delacroix roof replacement" />

              <div className="ops-grid-2">
                <SelectField label="Client" name="contact_id" placeholder="No client linked yet"
                  defaultValue={estimate?.contact_id}
                  options={clients.map(c => ({ value: c.id, label: c.label }))} />
                <SelectField label="Service type" name="service_type" placeholder="Not specified"
                  defaultValue={estimate?.service_type}
                  options={SERVICE_TYPES.map(s => ({ value: s, label: s }))} />
              </div>

              <Field label="Property address" name="property_address"
                defaultValue={estimate?.property_address} errors={state.fieldErrors} />
              <div className="ops-grid-3">
                <Field label="City" name="city" defaultValue={estimate?.city} errors={state.fieldErrors} />
                <Field label="State" name="state" defaultValue={estimate?.state ?? 'FL'} errors={state.fieldErrors} />
                <Field label="ZIP" name="zip" defaultValue={estimate?.zip} errors={state.fieldErrors} />
              </div>

              <TextareaField label="Scope of work" name="scope_summary" rows={4}
                defaultValue={estimate?.scope_summary}
                hint="This appears on the customer's PDF. Plain language, no jargon." />
            </div>
          </div>

          {/* ---- lines ------------------------------------------------------ */}
          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head">
              <h2>Line items</h2>
              <div className="ops-card-actions">
                <button type="button" className="ops-btn ops-btn-sm"
                  onClick={() => setLines(prev => [...prev, blankLine()])}>
                  <Plus aria-hidden="true" /> Add line
                </button>
              </div>
            </div>

            <div className="ops-table-wrap">
              <table className="ops-lines">
                <thead>
                  <tr>
                    <th style={{ width: 26 }} />
                    <th style={{ minWidth: 260 }}>Description</th>
                    <th style={{ width: 96 }} className="num">Qty</th>
                    <th style={{ width: 96 }}>Unit</th>
                    <th style={{ width: 120 }} className="num">Rate ($)</th>
                    <th style={{ width: 110 }} className="num">Amount</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const amount = lineTotalCents({
                      quantity: Number(line.quantity) || 0,
                      unitPriceCents: Math.round((Number(line.unitPrice) || 0) * 100),
                    })
                    const flagged = line.needsReview && !line.reviewed

                    return (
                      <tr key={line.key} className={flagged ? 'needs-review' : undefined}>
                        <td className="ops-line-drag">
                          <button type="button" className="ops-btn ops-btn-ghost ops-btn-sm"
                            onClick={() => move(line.key, -1)} disabled={index === 0}
                            aria-label={`Move line ${index + 1} up`} style={{ padding: 2, minHeight: 0 }}>
                            <GripVertical aria-hidden="true" style={{ width: 13, height: 13 }} />
                          </button>
                        </td>

                        <td>
                          {line.id && <input type="hidden" name={`line[${index}][id]`} value={line.id} />}
                          <input type="hidden" name={`line[${index}][source]`} value={line.source} />
                          <input type="hidden" name={`line[${index}][ai_generated]`} value={String(line.aiGenerated)} />
                          <input type="hidden" name={`line[${index}][needs_review]`} value={String(line.needsReview)} />
                          <input type="hidden" name={`line[${index}][category]`} value={line.category} />
                          {line.reviewed && <input type="hidden" name={`line[${index}][reviewed]`} value="1" />}

                          <select
                            aria-label={`Pricebook item for line ${index + 1}`}
                            value={line.pricebookItemId}
                            onChange={e => applyPricebookItem(line.key, e.target.value)}
                            style={{ marginBottom: 6 }}
                          >
                            <option value="">Custom line (not from the pricebook)</option>
                            {pricebook.map(item => (
                              <option key={item.id} value={item.id}>
                                {item.name}{item.default_unit_price_cents ? '' : ' — no price set'}
                              </option>
                            ))}
                          </select>
                          <input type="hidden" name={`line[${index}][pricebook_item_id]`} value={line.pricebookItemId} />

                          <input
                            name={`line[${index}][description]`}
                            value={line.description}
                            onChange={e => update(line.key, { description: e.target.value })}
                            placeholder="What the customer is paying for"
                            aria-label={`Description for line ${index + 1}`}
                          />

                          {line.notes && (
                            <input
                              name={`line[${index}][notes]`} value={line.notes}
                              onChange={e => update(line.key, { notes: e.target.value })}
                              style={{ marginTop: 5, fontSize: '.76rem' }}
                              aria-label={`Note for line ${index + 1}`}
                            />
                          )}

                          {flagged && (
                            <label className="ops-check ops-line-flag" style={{ marginTop: 7 }}>
                              <input
                                type="checkbox" checked={line.reviewed}
                                onChange={e => update(line.key, { reviewed: e.target.checked })}
                              />
                              <span>
                                {line.aiGenerated ? 'AI-generated' : 'Unpriced'} — confirm the quantity and rate, then tick reviewed
                              </span>
                            </label>
                          )}
                        </td>

                        <td>
                          <input
                            className="num" inputMode="decimal"
                            name={`line[${index}][quantity]`} value={line.quantity}
                            onChange={e => update(line.key, { quantity: e.target.value })}
                            aria-label={`Quantity for line ${index + 1}`}
                          />
                        </td>

                        <td>
                          <select
                            name={`line[${index}][unit]`} value={line.unit}
                            onChange={e => update(line.key, { unit: e.target.value })}
                            aria-label={`Unit for line ${index + 1}`}
                          >
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>

                        <td>
                          <input
                            className="num" inputMode="decimal"
                            name={`line[${index}][unit_price]`} value={line.unitPrice}
                            onChange={e => update(line.key, { unitPrice: e.target.value })}
                            placeholder="0.00"
                            aria-label={`Rate for line ${index + 1}`}
                          />
                        </td>

                        <td className="num">
                          <span className="ops-line-total">{formatCents(amount)}</span>
                        </td>

                        <td>
                          <button
                            type="button" className="ops-btn ops-btn-ghost ops-btn-sm"
                            onClick={() => setLines(prev => prev.length === 1 ? prev : prev.filter(l => l.key !== line.key))}
                            disabled={lines.length === 1}
                            aria-label={`Remove line ${index + 1}`}
                            style={{ color: 'var(--ops-bad)', padding: 4, minHeight: 0, marginTop: 8 }}
                          >
                            <Trash2 aria-hidden="true" style={{ width: 14, height: 14 }} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="ops-card-body">
              <button type="button" className="ops-btn" onClick={() => setLines(prev => [...prev, blankLine()])}>
                <Plus aria-hidden="true" /> Add another line
              </button>

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 22, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="ops-field">
                    <label htmlFor="discount">Discount ($)</label>
                    <input id="discount" name="discount" className="ops-input" inputMode="decimal"
                      value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0.00" />
                  </div>
                  {taxEnabled && (
                    <div className="ops-field">
                      <label htmlFor="tax_percent">Tax (%)</label>
                      <input id="tax_percent" name="tax_percent" className="ops-input" inputMode="decimal"
                        value={taxPercent} onChange={e => setTaxPercent(e.target.value)} />
                    </div>
                  )}
                  {!taxEnabled && <input type="hidden" name="tax_percent" value="0" />}
                </div>

                <dl className="ops-totals">
                  <div className="ops-totals-row"><span>Subtotal</span><span>{formatCents(totals.subtotalCents)}</span></div>
                  {totals.discountCents > 0 && (
                    <div className="ops-totals-row"><span>Discount</span><span>−{formatCents(totals.discountCents)}</span></div>
                  )}
                  {taxEnabled && totals.taxCents > 0 && (
                    <div className="ops-totals-row"><span>Tax ({taxPercent}%)</span><span>{formatCents(totals.taxCents)}</span></div>
                  )}
                  <div className="ops-totals-row grand"><span>Total</span><span>{formatCents(totals.totalCents)}</span></div>
                </dl>
              </div>
            </div>
          </div>

          {/* ---- notes ------------------------------------------------------ */}
          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Notes &amp; validity</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <Field label="Valid until" name="valid_until" type="date"
                  defaultValue={estimate?.valid_until ?? undefined} errors={state.fieldErrors} />
                <SelectField label="Assigned to" name="assigned_to" placeholder="Unassigned"
                  defaultValue={estimate?.assigned_to}
                  options={staff.map(s => ({ value: s.id, label: s.label }))} />
              </div>
              <TextareaField label="Customer notes" name="customer_notes" rows={3}
                defaultValue={estimate?.customer_notes}
                hint="Printed on the PDF under the totals." />
              <TextareaField label="Internal notes" name="internal_notes" rows={3}
                defaultValue={estimate?.internal_notes}
                hint="Never shown to the customer. Used as context when generating an AI draft." />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <SubmitButton>{estimate?.id ? 'Save estimate' : 'Create estimate'}</SubmitButton>
            {estimate?.id && (
              <a className="ops-btn" href={`/api/estimates/${estimate.id}/pdf?disposition=inline`}
                target="_blank" rel="noopener noreferrer">
                Preview PDF
              </a>
            )}
            <a className="ops-btn" href="/ops/estimates">Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}

export function AiDraftPanel({
  estimateId,
  aiConfigured,
  hasLines,
  warnings,
  assumptions,
}: {
  estimateId: string
  aiConfigured: boolean
  hasLines: boolean
  warnings: string[]
  assumptions: string[]
}) {
  return (
    <section className="ops-ai-panel">
      <h3><Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-info)' }} /> AI draft</h3>

      {!aiConfigured ? (
        <p className="ops-hint" style={{ marginTop: 8 }}>
          AI drafting needs <code>OPENAI_API_KEY</code>. Without it, build the estimate from the
          pricebook using the selector on each line — everything else works exactly the same.
        </p>
      ) : (
        <>
          <p className="ops-hint" style={{ marginTop: 8, marginBottom: 12 }}>
            Turns the scope and any attached roof measurement into draft lines, priced from the
            company pricebook. The AI never sets a price of its own, and every line it produces is
            flagged until you confirm it.
          </p>

          <AiDraftForm estimateId={estimateId} hasLines={hasLines} />
        </>
      )}

      {assumptions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong style={{ fontSize: '.76rem', textTransform: 'uppercase', letterSpacing: '.7px', color: 'var(--ops-muted)' }}>
            Assumptions
          </strong>
          <ul style={{ marginTop: 6, display: 'grid', gap: 4 }}>
            {assumptions.map((a, i) => (
              <li key={i} style={{ fontSize: '.79rem', paddingLeft: 14, position: 'relative' }}>
                <span style={{ position: 'absolute', left: 3, color: 'var(--ops-faint)' }}>•</span>{a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="ops-ai-warnings">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </section>
  )
}

function AiDraftForm({ estimateId, hasLines }: { estimateId: string; hasLines: boolean }) {
  return (
    <ActionForm action={generateAiDraft}>
      {state => (
        <>
          <input type="hidden" name="estimate_id" value={estimateId} />
          {hasLines && (
            <label className="ops-check" style={{ marginBottom: 10 }}>
              <input type="checkbox" name="replace_existing" />
              <span>Replace the {hasLines ? 'existing' : ''} lines on this estimate</span>
            </label>
          )}
          <SubmitButton className="ops-btn ops-btn-sm ops-btn-dark" pendingLabel="Drafting…">
            Generate AI draft
          </SubmitButton>
          {state.data?.warnings && Array.isArray(state.data.warnings) && (
            <ul className="ops-ai-warnings">
              {(state.data.warnings as string[]).map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </>
      )}
    </ActionForm>
  )
}
