'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveProposalTemplateAction } from '@/app/ops/actions/proposal-templates'
import { SERVICE_TYPES } from '@/lib/ops/constants'
import { UNITS, type PricebookItem } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

/**
 * ============================================================================
 * PROPOSAL TEMPLATE EDITOR
 * ----------------------------------------------------------------------------
 * Deliberately plainer than the estimate builder. A template has no client, no
 * property, no totals and no tax — it is wording plus a running order, and
 * every extra field here would be one the operator has to skip past four times
 * a week.
 *
 * Quantity and rate are BLANK BY DEFAULT and stay blank unless typed. The whole
 * point of the feature is "measure the job, then price it", and a template that
 * pre-filled 1 × $0.00 would put those figures on a customer's proposal.
 * ============================================================================
 */

export interface TemplateLineValues {
  key: number
  id?: string
  category: string
  description: string
  unit: string
  defaultQuantity: string
  defaultRate: string
  pricebookItemId: string
  notes: string
}

export interface TemplateValues {
  id?: string
  name?: string
  description?: string | null
  service_type?: string | null
  scope_summary?: string | null
  customer_notes?: string | null
  lines?: TemplateLineValues[]
}

let nextKey = 1

export function blankTemplateLine(): TemplateLineValues {
  return {
    key: nextKey++,
    category: '', description: '', unit: 'EA',
    // Empty, not '1' and not '0'. See the note above.
    defaultQuantity: '', defaultRate: '',
    pricebookItemId: '', notes: '',
  }
}

export default function ProposalTemplateEditor({
  template,
  pricebook,
}: {
  template?: TemplateValues
  pricebook: PricebookItem[]
}) {
  const [lines, setLines] = useState<TemplateLineValues[]>(
    template?.lines?.length ? template.lines : [blankTemplateLine()],
  )

  const action = saveProposalTemplateAction.bind(null, template?.id ?? null)

  function update(key: number, patch: Partial<TemplateLineValues>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
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

  /**
   * Linking a pricebook item fills the wording and the unit, and leaves the
   * rate alone. A template that hard-copied today's price would go stale
   * silently; the link means the operator can look the current price up when
   * they build the estimate.
   */
  function linkPricebookItem(key: number, itemId: string) {
    const item = pricebook.find(p => p.id === itemId)
    if (!item) {
      update(key, { pricebookItemId: '' })
      return
    }
    setLines(prev => prev.map(l => (l.key === key ? {
      ...l,
      pricebookItemId: itemId,
      description: l.description || item.name,
      unit: item.unit,
      category: l.category || (item.category ?? ''),
    } : l)))
  }

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          <div className="ops-card">
            <div className="ops-card-head"><h2>Template</h2></div>
            <div className="ops-card-body">
              <Field
                label="Template name" name="name" required
                defaultValue={template?.name} errors={state.fieldErrors}
                placeholder="Tile Roof Proposal"
                hint="How you will find it later. Not shown to the customer."
              />

              <div className="ops-grid-2">
                <SelectField
                  label="Service type" name="service_type" placeholder="Any"
                  defaultValue={template?.service_type ?? undefined}
                  options={SERVICE_TYPES.map(s => ({ value: s, label: s }))}
                />
                <Field
                  label="Internal description" name="description"
                  defaultValue={template?.description ?? undefined} errors={state.fieldErrors}
                  placeholder="When to use this one"
                />
              </div>

              <TextareaField
                label="Scope of work" name="scope_summary" rows={5}
                defaultValue={template?.scope_summary ?? undefined}
                hint="Copied onto the estimate and printed on the customer's PDF. Write it once, reuse it forever."
              />

              <TextareaField
                label="Customer notes" name="customer_notes" rows={3}
                defaultValue={template?.customer_notes ?? undefined}
                hint="Printed under the totals — terms, warranty wording, what is excluded."
              />
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head">
              <h2>Line items</h2>
              <div className="ops-card-actions">
                <button type="button" className="ops-btn ops-btn-sm"
                  onClick={() => setLines(prev => [...prev, blankTemplateLine()])}>
                  <Plus aria-hidden="true" /> Add line
                </button>
              </div>
            </div>

            <div className="ops-card-body">
              <p className="ops-hint" style={{ marginBottom: 14 }}>
                Leave quantity and rate blank on anything you measure and price per job — that is
                the normal case. Anything you fill in here is only a starting point, and stays
                editable on every estimate.
              </p>
            </div>

            <div className="ops-table-wrap">
              <table className="ops-lines">
                <thead>
                  <tr>
                    <th style={{ width: 26 }} />
                    <th style={{ minWidth: 240 }}>Description</th>
                    <th style={{ width: 100 }} className="num">Default qty</th>
                    <th style={{ width: 92 }}>Unit</th>
                    <th style={{ width: 116 }} className="num">Default rate</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={line.key}>
                      <td className="ops-line-drag">
                        <button type="button" className="ops-btn ops-btn-ghost ops-btn-sm"
                          onClick={() => move(line.key, -1)} disabled={index === 0}
                          aria-label={`Move line ${index + 1} up`} style={{ padding: 2, minHeight: 0 }}>
                          <GripVertical aria-hidden="true" style={{ width: 13, height: 13 }} />
                        </button>
                      </td>

                      <td>
                        {line.id && <input type="hidden" name={`line[${index}][id]`} value={line.id} />}
                        <input type="hidden" name={`line[${index}][category]`} value={line.category} />

                        <input
                          name={`line[${index}][description]`}
                          value={line.description}
                          onChange={e => update(line.key, { description: e.target.value })}
                          placeholder="What the customer is paying for"
                          aria-label={`Description for line ${index + 1}`}
                        />

                        <input
                          name={`line[${index}][notes]`}
                          value={line.notes}
                          onChange={e => update(line.key, { notes: e.target.value })}
                          placeholder="Internal note (optional)"
                          style={{ marginTop: 5, fontSize: '.76rem' }}
                          aria-label={`Note for line ${index + 1}`}
                        />

                        <details className="ops-template-link">
                          <summary>Optional price book link</summary>
                          <select
                            aria-label={`Price book item for line ${index + 1}`}
                            value={line.pricebookItemId}
                            onChange={e => linkPricebookItem(line.key, e.target.value)}
                          >
                            <option value="">None</option>
                            {pricebook.map(item => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                          <input type="hidden" name={`line[${index}][pricebook_item_id]`} value={line.pricebookItemId} />
                          <p className="ops-hint">
                            Fills the wording and unit. The rate is looked up when you build the
                            estimate, so the template never goes stale.
                          </p>
                        </details>
                      </td>

                      <td>
                        <input
                          className="num" inputMode="decimal"
                          name={`line[${index}][default_quantity]`} value={line.defaultQuantity}
                          onChange={e => update(line.key, { defaultQuantity: e.target.value })}
                          placeholder="—"
                          aria-label={`Default quantity for line ${index + 1}`}
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
                          name={`line[${index}][default_unit_price]`} value={line.defaultRate}
                          onChange={e => update(line.key, { defaultRate: e.target.value })}
                          placeholder="—"
                          aria-label={`Default rate for line ${index + 1}`}
                        />
                      </td>

                      <td>
                        <button
                          type="button" className="ops-btn ops-btn-ghost ops-btn-sm"
                          onClick={() => setLines(prev => prev.length === 1 ? prev : prev.filter(l => l.key !== line.key))}
                          disabled={lines.length === 1}
                          aria-label={`Remove line ${index + 1}`}
                          style={{ color: 'var(--ops-bad)', padding: 4, minHeight: 0 }}
                        >
                          <Trash2 aria-hidden="true" style={{ width: 14, height: 14 }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ops-card-body">
              <button type="button" className="ops-btn"
                onClick={() => setLines(prev => [...prev, blankTemplateLine()])}>
                <Plus aria-hidden="true" /> Add another line
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <SubmitButton>{template?.id ? 'Save template' : 'Create template'}</SubmitButton>
            <Link className="ops-btn" href="/ops/estimates/templates">Cancel</Link>
          </div>
        </>
      )}
    </ActionForm>
  )
}
