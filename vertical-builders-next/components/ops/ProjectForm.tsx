'use client'

import { ActionForm, CheckField, Field, SelectField, SubmitButton, TextareaField } from './Form'
import { saveProject } from '@/app/ops/actions/crm'
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/ops/types'
import { PERMIT_STATUSES, SERVICE_CATEGORIES } from '@/lib/ops/constants'
import { centsToDollars } from '@/lib/ops/utils/money'
import type { ActionState } from '@/lib/ops/actions-shared'

export interface ProjectFormValues {
  id?: string
  project_name?: string
  customer_id?: string | null
  jobsite_address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  customer_type?: string | null
  service_category?: string | null
  description?: string | null
  status?: string | null
  estimator_id?: string | null
  project_manager_id?: string | null
  start_date?: string | null
  estimated_completion_date?: string | null
  actual_completion_date?: string | null
  estimate_amount_cents?: number | null
  contract_amount_cents?: number | null
  permit_number?: string | null
  permit_status?: string | null
  insurance_claim_related?: boolean | null
  insurance_carrier?: string | null
  insurance_claim_number?: string | null
  notes?: string | null
}

export default function ProjectForm({
  project,
  customers,
  staff,
}: {
  project?: ProjectFormValues
  customers: { id: string; label: string }[]
  staff: { id: string; label: string }[]
}) {
  const action = saveProject.bind(null, project?.id ?? null)
  const dollars = (cents?: number | null) => {
    const v = centsToDollars(cents ?? null)
    return v === null ? undefined : String(v)
  }

  return (
    <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
      {state => (
        <>
          <div className="ops-card">
            <div className="ops-card-head"><h2>Project</h2></div>
            <div className="ops-card-body">
              <Field label="Project name" name="project_name" required defaultValue={project?.project_name} errors={state.fieldErrors} />
              <div className="ops-grid-2">
                <SelectField label="Customer" name="customer_id" placeholder="No customer linked"
                  defaultValue={project?.customer_id} options={customers.map(c => ({ value: c.id, label: c.label }))} />
                <SelectField label="Status" name="status" defaultValue={project?.status ?? 'prospect'}
                  options={PROJECT_STATUSES.map(s => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} />
              </div>
              <Field label="Jobsite address" name="jobsite_address" defaultValue={project?.jobsite_address} errors={state.fieldErrors} />
              <div className="ops-grid-3">
                <Field label="City" name="city" defaultValue={project?.city} errors={state.fieldErrors} />
                <Field label="State" name="state" defaultValue={project?.state ?? 'FL'} errors={state.fieldErrors} />
                <Field label="ZIP" name="zip" defaultValue={project?.zip} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <SelectField label="Residential / commercial" name="customer_type" placeholder="Not specified"
                  defaultValue={project?.customer_type}
                  options={[
                    { value: 'residential', label: 'Residential' },
                    { value: 'commercial', label: 'Commercial' },
                  ]} />
                <SelectField label="Service category" name="service_category" placeholder="Not specified"
                  defaultValue={project?.service_category}
                  options={SERVICE_CATEGORIES.map(s => ({ value: s, label: s }))} />
              </div>
              <TextareaField label="Scope / description" name="description" defaultValue={project?.description} rows={4} />
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Schedule &amp; team</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <SelectField label="Estimator" name="estimator_id" placeholder="Unassigned"
                  defaultValue={project?.estimator_id} options={staff.map(s => ({ value: s.id, label: s.label }))} />
                <SelectField label="Project manager" name="project_manager_id" placeholder="Unassigned"
                  defaultValue={project?.project_manager_id} options={staff.map(s => ({ value: s.id, label: s.label }))} />
              </div>
              <div className="ops-grid-3">
                <Field label="Start date" name="start_date" type="date" defaultValue={project?.start_date ?? undefined} errors={state.fieldErrors} />
                <Field label="Estimated completion" name="estimated_completion_date" type="date"
                  defaultValue={project?.estimated_completion_date ?? undefined} errors={state.fieldErrors} />
                <Field label="Actual completion" name="actual_completion_date" type="date"
                  defaultValue={project?.actual_completion_date ?? undefined} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-2">
                <Field label="Estimate amount (USD)" name="estimate_amount" inputMode="decimal"
                  defaultValue={dollars(project?.estimate_amount_cents)} errors={state.fieldErrors} placeholder="24500" />
                <Field label="Contract amount (USD)" name="contract_amount" inputMode="decimal"
                  defaultValue={dollars(project?.contract_amount_cents)} errors={state.fieldErrors} placeholder="24500" />
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>Permits &amp; insurance claim</h2></div>
            <div className="ops-card-body">
              <div className="ops-grid-2">
                <Field label="Permit number" name="permit_number" defaultValue={project?.permit_number} errors={state.fieldErrors} />
                <SelectField label="Permit status" name="permit_status" placeholder="Not started"
                  defaultValue={project?.permit_status}
                  options={PERMIT_STATUSES.map(s => ({ value: s, label: s }))} />
              </div>
              <CheckField label="This job is tied to an insurance claim" name="insurance_claim_related"
                defaultChecked={Boolean(project?.insurance_claim_related)} />
              <div className="ops-grid-2">
                <Field label="Carrier" name="insurance_carrier" defaultValue={project?.insurance_carrier} errors={state.fieldErrors} />
                <Field label="Claim number" name="insurance_claim_number" defaultValue={project?.insurance_claim_number} errors={state.fieldErrors} />
              </div>
              <TextareaField label="Internal notes" name="notes" defaultValue={project?.notes} rows={3} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <SubmitButton>{project?.id ? 'Save project' : 'Create project'}</SubmitButton>
            <a className="ops-btn" href={project?.id ? `/ops/projects/${project.id}` : '/ops/projects'}>Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}
