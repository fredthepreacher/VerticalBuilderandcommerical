'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveInvoiceAction } from '@/app/ops/actions/finance'
import { calculateTotals, lineTotalCents } from '@/lib/ops/finance/calc'
import { formatCents } from '@/lib/ops/utils/money'
import { INVOICE_TYPES } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface InvoiceLine {
  key: number
  description: string
  quantity: string
  unit: string
  unitPrice: string
  estimateLineItemId?: string
}

let nextKey = 1
const blank = (): InvoiceLine => ({
  key: nextKey++, description: '', quantity: '1', unit: '', unitPrice: '',
})

export interface InvoiceValues {
  id?: string
  project_id?: string
  contact_id?: string | null
  estimate_id?: string | null
  invoice_type?: string
  issue_date?: string
  due_date?: string | null
  discount_cents?: number
  tax_percent?: number
  notes?: string | null
  customer_message?: string | null
  items?: InvoiceLine[]
  status?: string
}

export default function InvoiceBuilder({
  invoice,
  projects,
  clients,
  taxEnabled,
}: {
  invoice?: InvoiceValues
  projects: { id: string; label: string; contactId: string | null }[]
  clients: { id: string; label: string }[]
  taxEnabled: boolean
}) {
  const [items, setItems] = useState<InvoiceLine[]>(invoice?.items?.length ? invoice.items : [blank()])
  const [discount, setDiscount] = useState(
    invoice?.discount_cents ? String(invoice.discount_cents / 100) : '',
  )
  const [taxPercent, setTaxPercent] = useState(String(invoice?.tax_percent ?? 0))

  const action = saveInvoiceAction.bind(null, invoice?.id ?? null)
  const locked = Boolean(invoice?.status && invoice.status !== 'draft')

  const totals = useMemo(
    () =>
      calculateTotals({
        lines: items.map(i => ({
          quantity: Number(i.quantity) || 0,
          unitPriceCents: Math.round((Number(i.unitPrice) || 0) * 100),
        })),
        discountCents: Math.round((Number(discount) || 0) * 100),
        taxPercent: Number(taxPercent) || 0,
        taxEnabled,
      }),
    [items, discount, taxPercent, taxEnabled],
  )

  function update(key: number, patch: Partial<InvoiceLine>) {
    setItems(prev => prev.map(i => (i.key === key ? { ...i, ...patch } : i)))
  }

  if (locked) {
    return (
      <div className="ops-banner neutral">
        <div>
          <strong>This invoice has been sent</strong>
          Its amounts are locked so the customer&apos;s copy and our record always agree. If it is
          wrong, void it and raise a replacement.
        </div>
      </div>
    )
  }

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          <div className="ops-card">
            <div className="ops-card-head"><h2>Invoice details</h2></div>
            <div className="ops-card-body">
              {invoice?.estimate_id && <input type="hidden" name="estimate_id" value={invoice.estimate_id} />}

              <div className="ops-grid-2">
                <SelectField label="Job" name="project_id" required placeholder="Choose a job…"
                  defaultValue={invoice?.project_id}
                  options={projects.map(p => ({ value: p.id, label: p.label }))}
                  hint="An invoice always belongs to a job — that is how it reaches profitability." />
                <SelectField label="Client" name="contact_id" placeholder="Use the job's client"
                  defaultValue={invoice?.contact_id}
                  options={clients.map(c => ({ value: c.id, label: c.label }))} />
              </div>

              <div className="ops-grid-3">
                <SelectField label="Type" name="invoice_type" defaultValue={invoice?.invoice_type ?? 'standard'}
                  options={INVOICE_TYPES.map(t => ({
                    value: t, label: t.charAt(0).toUpperCase() + t.slice(1),
                  }))} />
                <Field label="Issue date" name="issue_date" type="date" required
                  defaultValue={invoice?.issue_date ?? new Date().toISOString().slice(0, 10)}
                  errors={state.fieldErrors} />
                <Field label="Due date" name="due_date" type="date"
                  defaultValue={invoice?.due_date ?? undefined} errors={state.fieldErrors}
                  hint="Defaults to the company terms." />
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head">
              <h2>Lines</h2>
              <div className="ops-card-actions">
                <button type="button" className="ops-btn ops-btn-sm"
                  onClick={() => setItems(prev => [...prev, blank()])}>
                  <Plus aria-hidden="true" /> Add line
                </button>
              </div>
            </div>

            <div className="ops-table-wrap">
              <table className="ops-lines">
                <thead>
                  <tr>
                    <th style={{ minWidth: 260 }}>Description</th>
                    <th style={{ width: 90 }} className="num">Qty</th>
                    <th style={{ width: 80 }}>Unit</th>
                    <th style={{ width: 120 }} className="num">Rate ($)</th>
                    <th style={{ width: 110 }} className="num">Amount</th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const amount = lineTotalCents({
                      quantity: Number(item.quantity) || 0,
                      unitPriceCents: Math.round((Number(item.unitPrice) || 0) * 100),
                    })
                    return (
                      <tr key={item.key}>
                        <td>
                          {item.estimateLineItemId && (
                            <input type="hidden" name={`item[${index}][estimate_line_item_id]`}
                              value={item.estimateLineItemId} />
                          )}
                          <input
                            name={`item[${index}][description]`} value={item.description}
                            onChange={e => update(item.key, { description: e.target.value })}
                            placeholder="What is being billed"
                            aria-label={`Description for line ${index + 1}`}
                          />
                        </td>
                        <td>
                          <input className="num" inputMode="decimal"
                            name={`item[${index}][quantity]`} value={item.quantity}
                            onChange={e => update(item.key, { quantity: e.target.value })}
                            aria-label={`Quantity for line ${index + 1}`} />
                        </td>
                        <td>
                          <input name={`item[${index}][unit]`} value={item.unit}
                            onChange={e => update(item.key, { unit: e.target.value })}
                            placeholder="EA" aria-label={`Unit for line ${index + 1}`} />
                        </td>
                        <td>
                          <input className="num" inputMode="decimal"
                            name={`item[${index}][unit_price]`} value={item.unitPrice}
                            onChange={e => update(item.key, { unitPrice: e.target.value })}
                            placeholder="0.00" aria-label={`Rate for line ${index + 1}`} />
                        </td>
                        <td className="num"><span className="ops-line-total">{formatCents(amount)}</span></td>
                        <td>
                          <button type="button" className="ops-btn ops-btn-ghost ops-btn-sm"
                            disabled={items.length === 1}
                            onClick={() => setItems(prev => prev.length === 1 ? prev : prev.filter(i => i.key !== item.key))}
                            aria-label={`Remove line ${index + 1}`}
                            style={{ color: 'var(--ops-bad)', padding: 4, minHeight: 0, marginTop: 4 }}>
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
              {state.fieldErrors?.items && <p className="ops-error">{state.fieldErrors.items[0]}</p>}

              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="ops-field">
                    <label htmlFor="inv-discount">Discount ($)</label>
                    <input id="inv-discount" name="discount" className="ops-input" inputMode="decimal"
                      value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0.00" />
                  </div>
                  {taxEnabled ? (
                    <div className="ops-field">
                      <label htmlFor="inv-tax">Tax (%)</label>
                      <input id="inv-tax" name="tax_percent" className="ops-input" inputMode="decimal"
                        value={taxPercent} onChange={e => setTaxPercent(e.target.value)} />
                    </div>
                  ) : <input type="hidden" name="tax_percent" value="0" />}
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

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Messages</h2></div>
            <div className="ops-card-body">
              <TextareaField label="Message to the customer" name="customer_message" rows={3}
                defaultValue={invoice?.customer_message}
                hint="Appears on the invoice. Payment terms, thanks, what happens next." />
              <TextareaField label="Internal notes" name="notes" rows={2} defaultValue={invoice?.notes} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <SubmitButton>{invoice?.id ? 'Save invoice' : 'Create invoice'}</SubmitButton>
            <a className="ops-btn" href={invoice?.id ? `/ops/invoices/${invoice.id}` : '/ops/invoices'}>Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}
