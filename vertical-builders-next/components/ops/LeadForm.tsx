'use client'

import { ActionForm, CheckField, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveLead } from '@/app/ops/actions/crm'
import { LEAD_STAGES, LEAD_STAGE_LABELS } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface LeadFormValues {
  id?: string
  first_name?: string
  last_name?: string | null
  company_name?: string | null
  email?: string | null
  phone?: string | null
  preferred_contact_method?: string | null
  customer_type?: string | null
  service_type?: string | null
  property_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  project_description?: string | null
  timeline?: string | null
  financing_interest?: boolean | null
  pipeline_stage?: string | null
  assigned_to?: string | null
  next_follow_up_at?: string | null
  lost_reason?: string | null
  notes_summary?: string | null
}

export default function LeadForm({
  lead,
  staff,
  serviceTypes,
}: {
  lead?: LeadFormValues
  staff: { id: string; label: string }[]
  serviceTypes: string[]
}) {
  const action = saveLead.bind(null, lead?.id ?? null)

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          <div className="ops-card">
            <div className="ops-card-head"><h2>Contact details</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <Field label="First name" name="first_name" required defaultValue={lead?.first_name} errors={state.fieldErrors} autoComplete="given-name" />
                <Field label="Last name" name="last_name" defaultValue={lead?.last_name} errors={state.fieldErrors} autoComplete="family-name" />
              </div>
              <Field label="Company" name="company_name" defaultValue={lead?.company_name} errors={state.fieldErrors} />
              <div className="ops-grid-2">
                <Field label="Email" name="email" type="email" defaultValue={lead?.email} errors={state.fieldErrors} />
                <Field label="Phone" name="phone" type="tel" defaultValue={lead?.phone} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <SelectField
                  label="Preferred contact" name="preferred_contact_method" placeholder="No preference"
                  defaultValue={lead?.preferred_contact_method}
                  options={[
                    { value: 'phone', label: 'Phone call' },
                    { value: 'text', label: 'Text message' },
                    { value: 'email', label: 'Email' },
                  ]}
                />
                <SelectField
                  label="Customer type" name="customer_type" placeholder="Not specified"
                  defaultValue={lead?.customer_type}
                  options={[
                    { value: 'residential', label: 'Residential' },
                    { value: 'commercial', label: 'Commercial' },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Project</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <SelectField
                  label="Service needed" name="service_type" placeholder="Not specified"
                  defaultValue={lead?.service_type}
                  options={serviceTypes.map(s => ({ value: s, label: s }))}
                />
                <Field label="Timeline" name="timeline" defaultValue={lead?.timeline} placeholder="ASAP, 1–3 months…" errors={state.fieldErrors} />
              </div>
              <Field label="Property address" name="property_address" defaultValue={lead?.property_address} errors={state.fieldErrors} />
              <div className="ops-grid-3">
                <Field label="City" name="city" defaultValue={lead?.city} errors={state.fieldErrors} />
                <Field label="State" name="state" defaultValue={lead?.state ?? 'FL'} errors={state.fieldErrors} />
                <Field label="ZIP" name="zip" defaultValue={lead?.zip} errors={state.fieldErrors} />
              </div>
              <TextareaField label="What they told us" name="project_description" defaultValue={lead?.project_description} rows={4} />
              <CheckField label="Interested in financing" name="financing_interest" defaultChecked={Boolean(lead?.financing_interest)} />
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Pipeline</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <SelectField
                  label="Stage" name="pipeline_stage" required
                  defaultValue={lead?.pipeline_stage ?? 'new'}
                  options={LEAD_STAGES.map(s => ({ value: s, label: LEAD_STAGE_LABELS[s] }))}
                />
                <SelectField
                  label="Assigned to" name="assigned_to" placeholder="Unassigned"
                  defaultValue={lead?.assigned_to}
                  options={staff.map(s => ({ value: s.id, label: s.label }))}
                />
              </div>
              <div className="ops-grid-2">
                <Field
                  label="Next follow-up" name="next_follow_up_at" type="date"
                  defaultValue={lead?.next_follow_up_at?.slice(0, 10)} errors={state.fieldErrors}
                />
                <Field label="Lost reason" name="lost_reason" defaultValue={lead?.lost_reason}
                  hint="Only used when the stage is Lost." errors={state.fieldErrors} />
              </div>
              <TextareaField label="Internal summary" name="notes_summary" defaultValue={lead?.notes_summary} rows={3}
                hint="A one-line summary for the list view. Longer notes go on the Notes tab." />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <SubmitButton>{lead?.id ? 'Save lead' : 'Create lead'}</SubmitButton>
            <a className="ops-btn" href={lead?.id ? `/ops/leads/${lead.id}` : '/ops/leads'}>Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}
