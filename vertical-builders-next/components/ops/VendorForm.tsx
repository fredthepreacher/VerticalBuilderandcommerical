'use client'

import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveVendor } from '@/app/ops/actions/compliance'
import { TRADES, VENDOR_STATUSES, VENDOR_TYPES } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface VendorFormValues {
  id?: string
  legal_name?: string
  dba?: string | null
  vendor_type?: string | null
  primary_trade?: string | null
  trades?: string[] | null
  status?: string | null
  contact_first_name?: string | null
  contact_last_name?: string | null
  email?: string | null
  phone?: string | null
  secondary_contact?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  ein_last4?: string | null
  license_number?: string | null
  license_type?: string | null
  license_expiration_date?: string | null
  w9_status?: string | null
  default_requirement_template_id?: string | null
  notes?: string | null
}

export default function VendorForm({
  vendor,
  templates,
}: {
  vendor?: VendorFormValues
  templates: { id: string; name: string }[]
}) {
  const action = saveVendor.bind(null, vendor?.id ?? null)

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          <div className="ops-card">
            <div className="ops-card-head"><h2>Company</h2></div>
            <div className="ops-card-body">
              <Field label="Legal company name" name="legal_name" required
                defaultValue={vendor?.legal_name} errors={state.fieldErrors}
                hint="Exactly as it appears on their certificate of insurance." />
              <div className="ops-grid-2">
                <Field label="DBA / trading as" name="dba" defaultValue={vendor?.dba} errors={state.fieldErrors} />
                <SelectField label="Vendor type" name="vendor_type" defaultValue={vendor?.vendor_type ?? 'subcontractor'}
                  options={VENDOR_TYPES.map(t => ({ value: t, label: cap(t) }))} />
              </div>
              <div className="ops-grid-2">
                <SelectField label="Primary trade" name="primary_trade" placeholder="Not specified"
                  defaultValue={vendor?.primary_trade}
                  options={TRADES.map(t => ({ value: t, label: t }))}
                  hint="Drives which trade-specific insurance requirements apply." />
                <SelectField label="Status" name="status" defaultValue={vendor?.status ?? 'pending'}
                  options={VENDOR_STATUSES.map(s => ({ value: s, label: cap(s) }))}
                  hint="Blocked vendors should not be scheduled." />
              </div>
              <div className="ops-field">
                <span className="ops-label">Additional trades</span>
                <div className="ops-chips">
                  {TRADES.map(t => (
                    <label key={t} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input type="checkbox" name="trades" value={t}
                        defaultChecked={vendor?.trades?.includes(t)}
                        style={{ accentColor: 'var(--ops-accent)' }} />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Contact</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <Field label="Contact first name" name="contact_first_name" defaultValue={vendor?.contact_first_name} errors={state.fieldErrors} />
                <Field label="Contact last name" name="contact_last_name" defaultValue={vendor?.contact_last_name} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <Field label="Email" name="email" type="email" defaultValue={vendor?.email} errors={state.fieldErrors}
                  hint="Renewal requests are emailed here." />
                <Field label="Phone" name="phone" type="tel" defaultValue={vendor?.phone} errors={state.fieldErrors} />
              </div>
              <Field label="Secondary contact" name="secondary_contact" defaultValue={vendor?.secondary_contact} errors={state.fieldErrors} />
              <Field label="Address" name="address" defaultValue={vendor?.address} errors={state.fieldErrors} />
              <div className="ops-grid-3">
                <Field label="City" name="city" defaultValue={vendor?.city} errors={state.fieldErrors} />
                <Field label="State" name="state" defaultValue={vendor?.state ?? 'FL'} errors={state.fieldErrors} />
                <Field label="ZIP" name="zip" defaultValue={vendor?.zip} errors={state.fieldErrors} />
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Licensing &amp; compliance setup</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-3">
                <Field label="License number" name="license_number" defaultValue={vendor?.license_number} errors={state.fieldErrors} />
                <Field label="License type" name="license_type" defaultValue={vendor?.license_type} errors={state.fieldErrors} />
                <Field label="License expiration" name="license_expiration_date" type="date"
                  defaultValue={vendor?.license_expiration_date ?? undefined} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-3">
                <SelectField label="W-9 status" name="w9_status" defaultValue={vendor?.w9_status ?? 'missing'}
                  options={[
                    { value: 'missing', label: 'Missing' },
                    { value: 'on_file', label: 'On file' },
                    { value: 'expired', label: 'Expired' },
                  ]} />
                <Field label="EIN — last 4 only" name="ein_last4" defaultValue={vendor?.ein_last4}
                  errors={state.fieldErrors} placeholder="1234"
                  hint="Reference only. Never store a full tax ID here." />
                <SelectField label="Requirement template" name="default_requirement_template_id"
                  placeholder="Use trade / global default"
                  defaultValue={vendor?.default_requirement_template_id}
                  options={templates.map(t => ({ value: t.id, label: t.name }))}
                  hint="Overrides the trade rule for this vendor." />
              </div>
              <TextareaField label="Notes" name="notes" defaultValue={vendor?.notes} rows={3} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <SubmitButton>{vendor?.id ? 'Save subcontractor' : 'Create subcontractor'}</SubmitButton>
            <a className="ops-btn" href={vendor?.id ? `/ops/subcontractors/${vendor.id}` : '/ops/subcontractors'}>Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}
