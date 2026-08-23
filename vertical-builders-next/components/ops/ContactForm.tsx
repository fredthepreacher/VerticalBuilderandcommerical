'use client'

import { ActionForm, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveContact } from '@/app/ops/actions/crm'
import { CONTACT_METHODS } from '@/lib/ops/constants'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface ContactFormValues {
  id?: string
  contact_type?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
  secondary_phone?: string | null
  preferred_contact_method?: string | null
  billing_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
}

export default function ContactForm({ contact }: { contact?: ContactFormValues }) {
  const action = saveContact.bind(null, contact?.id ?? null)

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <div className="ops-card">
          <div className="ops-card-head"><h2>Contact details</h2></div>
          <div className="ops-card-body">
            <SelectField
              label="Contact type" name="contact_type" defaultValue={contact?.contact_type ?? 'homeowner'}
              options={[
                { value: 'homeowner', label: 'Homeowner' },
                { value: 'business', label: 'Business' },
                { value: 'property_manager', label: 'Property manager' },
                { value: 'other', label: 'Other' },
              ]}
            />
            <div className="ops-grid-2">
              <Field label="First name" name="first_name" defaultValue={contact?.first_name} errors={state.fieldErrors} autoComplete="given-name" />
              <Field label="Last name" name="last_name" defaultValue={contact?.last_name} errors={state.fieldErrors} autoComplete="family-name" />
            </div>
            <Field label="Company" name="company_name" defaultValue={contact?.company_name} errors={state.fieldErrors} />
            <div className="ops-grid-2">
              <Field label="Email" name="email" type="email" defaultValue={contact?.email} errors={state.fieldErrors} />
              <Field label="Phone" name="phone" type="tel" defaultValue={contact?.phone} errors={state.fieldErrors} />
            </div>
            <div className="ops-grid-2">
              <Field label="Secondary phone" name="secondary_phone" type="tel" defaultValue={contact?.secondary_phone} errors={state.fieldErrors} />
              <SelectField label="Preferred contact" name="preferred_contact_method" placeholder="No preference"
                defaultValue={contact?.preferred_contact_method}
                options={CONTACT_METHODS.map(m => ({ value: m.value, label: m.label }))} />
            </div>
            <Field label="Billing address" name="billing_address" defaultValue={contact?.billing_address} errors={state.fieldErrors} />
            <div className="ops-grid-3">
              <Field label="City" name="city" defaultValue={contact?.city} errors={state.fieldErrors} />
              <Field label="State" name="state" defaultValue={contact?.state ?? 'FL'} errors={state.fieldErrors} />
              <Field label="ZIP" name="zip" defaultValue={contact?.zip} errors={state.fieldErrors} />
            </div>
            <TextareaField label="Notes" name="notes" defaultValue={contact?.notes} rows={3} />

            <div style={{ display: 'flex', gap: 8 }}>
              <SubmitButton>{contact?.id ? 'Save contact' : 'Create contact'}</SubmitButton>
              <a className="ops-btn" href={contact?.id ? `/ops/contacts/${contact.id}` : '/ops/contacts'}>Cancel</a>
            </div>
          </div>
        </div>
      )}
    </ActionForm>
  )
}
