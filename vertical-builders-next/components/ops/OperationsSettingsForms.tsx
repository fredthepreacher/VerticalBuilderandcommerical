'use client'

import { Fragment, useState, useTransition } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { ActionForm, CheckField, Field, SelectField, SubmitButton, TextareaField } from './Form'
import {
  saveEstimatingSettings, saveFinancialPermissions, saveMeasurementSettings,
  savePaymentSettings, savePricebookItem, setPricebookItemActive,
} from '@/app/ops/actions/settings'
import { UNITS, UNIT_LABELS, type Unit } from '@/lib/ops/types'
import { formatCents } from '@/lib/ops/utils/money'
import { Badge } from './StatusBadge'

// ---------------------------------------------------------------------------
// Estimating & invoicing defaults
// ---------------------------------------------------------------------------

export function EstimatingSettingsForm({
  settings,
}: {
  settings: {
    estimate_number_prefix: string
    estimate_valid_days: number
    estimate_default_notes: string | null
    estimate_tax_enabled: boolean
    estimate_default_tax_percent: number
    invoice_number_prefix: string
    invoice_due_days: number
  }
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Estimating &amp; invoicing</h2></div>
      <div className="ops-card-body">
        <ActionForm action={saveEstimatingSettings}>
          {state => (
            <>
              <div className="ops-grid-2">
                <Field label="Estimate number prefix" name="estimate_number_prefix"
                  defaultValue={settings.estimate_number_prefix} errors={state.fieldErrors}
                  hint="2–6 letters. Existing numbers are never rewritten." />
                <Field label="Estimate valid for (days)" name="estimate_valid_days" type="number"
                  min="1" max="365" defaultValue={settings.estimate_valid_days} errors={state.fieldErrors} />
                <Field label="Invoice number prefix" name="invoice_number_prefix"
                  defaultValue={settings.invoice_number_prefix} errors={state.fieldErrors} />
                <Field label="Invoice due in (days)" name="invoice_due_days" type="number"
                  min="0" max="180" defaultValue={settings.invoice_due_days} errors={state.fieldErrors}
                  hint="0 means due on receipt." />
              </div>

              <CheckField label="Charge sales tax on estimates" name="estimate_tax_enabled"
                defaultChecked={settings.estimate_tax_enabled}
                hint="Tax is applied after any discount. Individual lines can still be marked non-taxable." />

              <Field label="Default tax rate (%)" name="estimate_default_tax_percent" type="number"
                step="0.001" min="0" max="25" inputMode="decimal"
                defaultValue={settings.estimate_default_tax_percent} errors={state.fieldErrors}
                hint="Vertical Ops is not a tax engine — confirm the rate with your accountant." />

              <TextareaField label="Default estimate notes" name="estimate_default_notes" rows={4}
                defaultValue={settings.estimate_default_notes}
                placeholder="Payment terms, exclusions, how long the price holds…"
                hint="Prefilled on every new estimate and editable per estimate." />

              {state.error && <p className="ops-error">{state.error}</p>}
              <SubmitButton>Save defaults</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Roof measurement provider
// ---------------------------------------------------------------------------

export function MeasurementSettingsForm({
  provider,
  configured,
}: {
  provider: string
  configured: { eagleview: boolean; nearmap: boolean; maps: boolean }
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Roof measurements</h2></div>
      <div className="ops-card-body">
        <ActionForm action={saveMeasurementSettings}>
          {state => (
            <>
              <SelectField
                label="Measurement source" name="roof_measurement_provider" required
                defaultValue={provider} errors={state.fieldErrors}
                options={[
                  { value: 'manual', label: 'Manual entry only' },
                  { value: 'eagleview', label: `EagleView${configured.eagleview ? '' : ' — credentials missing'}` },
                  { value: 'nearmap', label: `Nearmap${configured.nearmap ? '' : ' — API key missing'}` },
                ]}
                hint="Ordering a report costs money, so only owner/admin and office can trigger one."
              />
              {state.error && <p className="ops-error">{state.error}</p>}
              <SubmitButton>Save provider</SubmitButton>
            </>
          )}
        </ActionForm>

        <dl className="ops-deflist" style={{ marginTop: 18 }}>
          <dt>EagleView credentials</dt>
          <dd>{configured.eagleview
            ? <Badge tone="ok">Present</Badge>
            : <Badge tone="neutral">Not set</Badge>}</dd>
          <dt>Nearmap API key</dt>
          <dd>{configured.nearmap
            ? <Badge tone="ok">Present</Badge>
            : <Badge tone="neutral">Not set</Badge>}</dd>
          <dt>Google Maps key (aerial preview)</dt>
          <dd>{configured.maps
            ? <Badge tone="ok">Present</Badge>
            : <Badge tone="neutral">Not set</Badge>}</dd>
        </dl>

        <p className="ops-hint" style={{ marginTop: 14 }}>
          Aerial imagery on its own does not contain roof geometry. A measurement is only recorded
          when it comes from a real report, a manual takeoff, or a figure someone typed in and
          signed their name to — never inferred from a picture.
        </p>
        <p className="ops-hint">
          Secrets are read from environment variables on the server. They are never written to this
          table and never sent to the browser.
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const METHODS: { value: string; label: string; online: boolean }[] = [
  { value: 'card', label: 'Credit / debit card', online: true },
  { value: 'ach', label: 'Bank transfer (ACH)', online: true },
  { value: 'check', label: 'Check', online: false },
  { value: 'cash', label: 'Cash', online: false },
  { value: 'other', label: 'Other / offline', online: false },
]

export function PaymentSettingsForm({
  settings,
  stripe,
}: {
  settings: { online_payments_enabled: boolean; allowed_payment_methods: string[] }
  stripe: { secretKey: boolean; publishableKey: boolean; webhookSecret: boolean; mode: string }
}) {
  const ready = stripe.secretKey && stripe.publishableKey && stripe.webhookSecret

  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Payments</h2></div>
      <div className="ops-card-body">
        {!ready && (
          <div className="ops-banner warn" style={{ marginBottom: 16 }}>
            <div>
              Stripe is not fully configured, so the Pay online button will not appear even if you
              switch it on here. Missing:{' '}
              {[
                !stripe.secretKey && 'STRIPE_SECRET_KEY',
                !stripe.publishableKey && 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
                !stripe.webhookSecret && 'STRIPE_WEBHOOK_SECRET',
              ].filter(Boolean).join(', ')}.
            </div>
          </div>
        )}

        <ActionForm action={savePaymentSettings}>
          {state => (
            <>
              <CheckField label="Accept payments online" name="online_payments_enabled"
                defaultChecked={settings.online_payments_enabled}
                hint="Customers pay through Stripe's hosted page. Card and bank details are never entered in Vertical Ops." />

              <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
                <legend className="ops-label">Methods you accept</legend>
                <div className="ops-grid-2">
                  {METHODS.map(m => (
                    <CheckField
                      key={m.value}
                      label={m.label}
                      name={`method_${m.value}`}
                      defaultChecked={settings.allowed_payment_methods.includes(m.value)}
                      hint={m.online ? 'Available online and for manual entry.' : 'Recorded manually by the office.'}
                    />
                  ))}
                </div>
              </fieldset>

              {state.error && <p className="ops-error">{state.error}</p>}
              <SubmitButton>Save payment settings</SubmitButton>
            </>
          )}
        </ActionForm>

        <dl className="ops-deflist" style={{ marginTop: 18 }}>
          <dt>Stripe mode</dt>
          <dd>
            {stripe.mode === 'live'
              ? <Badge tone="ok">Live keys</Badge>
              : stripe.mode === 'test'
                ? <Badge tone="warn">Test keys — real cards will not be charged</Badge>
                : <Badge tone="neutral">No keys</Badge>}
          </dd>
          <dt>Webhook endpoint</dt>
          <dd><code style={{ fontSize: '.78rem' }}>POST /api/webhooks/stripe</code></dd>
        </dl>
        <p className="ops-hint" style={{ marginTop: 12 }}>
          A payment is only recorded when Stripe&rsquo;s signed webhook confirms it. The browser coming
          back from the checkout page is never treated as proof on its own.
        </p>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Who can see money
// ---------------------------------------------------------------------------

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function FinancialPermissionsForm({
  settings,
}: {
  settings: {
    costs_visible_to_pm: boolean
    profit_visible_to_pm: boolean
    schedule_work_days: number[]
  }
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Financial visibility &amp; working days</h2></div>
      <div className="ops-card-body">
        <ActionForm action={saveFinancialPermissions}>
          {state => (
            <>
              <p className="ops-hint" style={{ marginBottom: 12 }}>
                Owner/admin and office always see costs and profit. The read-only/auditor
                role never does. These two switches decide only what a project manager sees.
              </p>

              <CheckField label="Project managers can see job costs" name="costs_visible_to_pm"
                defaultChecked={settings.costs_visible_to_pm}
                hint="Needed if PMs log their own receipts and subcontractor bills." />
              <CheckField label="Project managers can see gross profit and margin" name="profit_visible_to_pm"
                defaultChecked={settings.profit_visible_to_pm}
                hint="Off by default — a PM can usually log a cost without being shown the company's margin." />

              <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
                <legend className="ops-label">Scheduling work days</legend>
                <p className="ops-hint">Used to shade the Gantt chart. It does not block work being scheduled on other days.</p>
                <div className="ops-grid-3">
                  {DAY_LABELS.map((label, index) => (
                    <CheckField key={index} label={label} name={`workday_${index}`}
                      defaultChecked={settings.schedule_work_days.includes(index)} />
                  ))}
                </div>
              </fieldset>

              {state.error && <p className="ops-error">{state.error}</p>}
              <SubmitButton>Save visibility settings</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pricebook
// ---------------------------------------------------------------------------

export interface PricebookItemRow {
  id: string
  name: string
  category: string | null
  service_type: string | null
  description: string | null
  unit: Unit
  default_unit_price_cents: number
  default_material_cost_cents: number | null
  default_labor_cost_cents: number | null
  active: boolean
  tags: string[]
}

export function PricebookManager({
  items,
  canManage,
}: {
  items: PricebookItemRow[]
  canManage: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [pending, startTransition] = useTransition()

  const unpriced = items.filter(i => i.active && i.default_unit_price_cents === 0)
  const categories = Array.from(new Set(items.map(i => i.category ?? 'Uncategorised'))).sort()

  return (
    <div className="ops-stack">
      {unpriced.length > 0 && (
        <div className="ops-banner warn">
          <div>
            {unpriced.length} item{unpriced.length === 1 ? '' : 's'} still cost $0. The starter
            catalogue ships deliberately unpriced — a plausible-looking wrong price is worse than a
            blank one. Estimate lines built from an unpriced item are flagged for review and cannot
            be sent.
          </div>
        </div>
      )}

      <section className="ops-card">
        <div className="ops-card-head">
          <h2>Pricebook</h2>
          <div className="ops-card-actions">
            <span className="ops-hint">{items.filter(i => i.active).length} active</span>
            {canManage && (
              <button type="button" className="ops-btn ops-btn-sm ops-btn-primary"
                onClick={() => { setAdding(a => !a); setEditing(null) }}>
                <Plus aria-hidden="true" /> Add item
              </button>
            )}
          </div>
        </div>

        {adding && canManage && (
          <div className="ops-card-body" style={{ borderBottom: '1px solid var(--ops-line)' }}>
            <PricebookItemForm item={null} categories={categories} onDone={() => setAdding(false)} />
          </div>
        )}

        {items.length === 0 ? (
          <div className="ops-card-body">
            <p className="ops-hint">
              No pricebook items. Run migration 0007 to install the starter catalogue, then price it here.
            </p>
          </div>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table ops-table-cards">
              <thead>
                <tr>
                  <th>Item</th><th>Category</th><th>Unit</th>
                  <th className="num">Price</th><th className="num">Cost</th>
                  <th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const cost = (item.default_material_cost_cents ?? 0) + (item.default_labor_cost_cents ?? 0)
                  return (
                    <Fragment key={item.id}>
                      <tr style={item.active ? undefined : { opacity: .6 }}>
                        <td data-label="Item" className="ops-cell-primary">
                          {item.name}
                          {item.description && (
                            <span className="ops-sub2">{item.description}</span>
                          )}
                        </td>
                        <td data-label="Category">{item.category ?? '—'}</td>
                        <td data-label="Unit" title={UNIT_LABELS[item.unit]}>{item.unit}</td>
                        <td data-label="Price" className="num">
                          {item.default_unit_price_cents === 0
                            ? <span style={{ color: 'var(--ops-warn)' }}>Not priced</span>
                            : formatCents(item.default_unit_price_cents)}
                        </td>
                        <td data-label="Cost" className="num">{cost > 0 ? formatCents(cost) : '—'}</td>
                        <td data-label="Status">
                          {item.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Retired</Badge>}
                        </td>
                        <td className="ops-actions">
                          {canManage && (
                            <>
                              <button type="button" className="ops-btn ops-btn-sm"
                                onClick={() => { setEditing(e => e === item.id ? null : item.id); setAdding(false) }}>
                                <Pencil aria-hidden="true" /> Edit
                              </button>
                              <button type="button" className="ops-btn ops-btn-sm" disabled={pending}
                                onClick={() => startTransition(async () => {
                                  await setPricebookItemActive(item.id, !item.active)
                                })}>
                                {item.active ? 'Retire' : 'Restore'}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                      {editing === item.id && canManage && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--ops-raised)' }}>
                            <PricebookItemForm item={item} categories={categories}
                              onDone={() => setEditing(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="ops-card-body">
          <p className="ops-hint">
            Retiring an item hides it from new estimates without touching estimates already written
            — those keep the price they were quoted at.
          </p>
        </div>
      </section>
    </div>
  )
}

function PricebookItemForm({
  item,
  categories,
  onDone,
}: {
  item: PricebookItemRow | null
  categories: string[]
  onDone: () => void
}) {
  return (
    <ActionForm action={savePricebookItem.bind(null, item?.id ?? null)}>
      {state => (
        <>
          <div className="ops-grid-2">
            <Field label="Name" name="name" required defaultValue={item?.name} errors={state.fieldErrors} />
            <Field label="Category" name="category" defaultValue={item?.category}
              placeholder={categories[0] ?? 'Roofing'} errors={state.fieldErrors} />
          </div>

          <div className="ops-grid-3">
            <SelectField label="Unit" name="unit" required defaultValue={item?.unit ?? 'EA'}
              options={UNITS.map(u => ({ value: u, label: `${u} — ${UNIT_LABELS[u]}` }))} />
            <Field label="Unit price ($)" name="default_unit_price" type="number" step="0.01" min="0"
              inputMode="decimal" errors={state.fieldErrors}
              defaultValue={item ? (item.default_unit_price_cents / 100).toFixed(2) : '0.00'}
              hint="Leave at 0 if this is always quoted per job." />
            <Field label="Service type" name="service_type" defaultValue={item?.service_type}
              placeholder="Blank = applies to every job" errors={state.fieldErrors} />
          </div>

          <div className="ops-grid-2">
            <Field label="Material cost ($)" name="default_material_cost" type="number" step="0.01" min="0"
              inputMode="decimal" errors={state.fieldErrors}
              defaultValue={item?.default_material_cost_cents != null
                ? (item.default_material_cost_cents / 100).toFixed(2) : ''} />
            <Field label="Labor cost ($)" name="default_labor_cost" type="number" step="0.01" min="0"
              inputMode="decimal" errors={state.fieldErrors}
              defaultValue={item?.default_labor_cost_cents != null
                ? (item.default_labor_cost_cents / 100).toFixed(2) : ''} />
          </div>

          <TextareaField label="Description" name="description" rows={2} defaultValue={item?.description} />

          <input type="hidden" name="tags" value={(item?.tags ?? []).join(',')} />
          <input type="hidden" name="active" value={item?.active === false ? 'off' : 'on'} />

          {state.error && <p className="ops-error">{state.error}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <SubmitButton className="ops-btn ops-btn-primary" pendingLabel="Saving…">
              {item ? 'Save item' : 'Add item'}
            </SubmitButton>
            <button type="button" className="ops-btn" onClick={onDone}>Close</button>
          </div>
        </>
      )}
    </ActionForm>
  )
}
