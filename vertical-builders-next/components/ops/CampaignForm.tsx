'use client'

import { ActionForm, SubmitButton, Field, SelectField, CheckField } from './Form'
import { saveCampaignAction } from '@/app/ops/actions/prospecting'
import { WASTE_RULE_TYPES, WASTE_RULE_LABELS } from '@/lib/ops/prospecting/constants'
import { ROOF_TYPE_OPTIONS } from '@/lib/ops/validations/prospecting'

export interface CampaignFormValues {
  id?: string
  name?: string
  county?: string | null
  data_source?: string | null
  roof_types?: string[]
  permit_date_from?: string | null
  permit_date_to?: string | null
  min_roof_age_years?: number | null
  waste_rule_type?: string
  waste_rule_value?: number | null
  waste_min_squares?: number | null
  pricebook_service_type?: string | null
  proposal_template_id?: string | null
  default_batch_size?: number
  mail_tag?: string | null
  active?: boolean
}

const ROOF_LABELS: Record<string, string> = {
  shingle: 'Shingle', tile: 'Tile', metal: 'Metal', flat: 'Flat / low-slope',
  slate: 'Slate', wood: 'Wood shake', other: 'Other',
}

export default function CampaignForm({
  campaign, templates,
}: {
  campaign?: CampaignFormValues
  templates: { id: string; name: string }[]
}) {
  const selectedRoofs = new Set(campaign?.roof_types ?? [])

  return (
    <ActionForm action={saveCampaignAction}>
      {(state) => (
        <div className="ops-card">
          <div className="ops-card-body">
            {campaign?.id && <input type="hidden" name="campaign_id" value={campaign.id} />}

            <Field label="Campaign name" name="name" required defaultValue={campaign?.name}
              placeholder="Sarasota shingle roofs 2004–2020" errors={state.fieldErrors} />

            <div className="ops-grid-2">
              <Field label="County / area" name="county" defaultValue={campaign?.county}
                placeholder="Sarasota" errors={state.fieldErrors} />
              <Field label="Data source" name="data_source" defaultValue={campaign?.data_source}
                placeholder="County permit office export" errors={state.fieldErrors} />
            </div>

            <div className="ops-field">
              <label>Roof types to target</label>
              <p className="ops-hint">
                Leave all unchecked to accept every roof type. Rows outside the filter are flagged for
                review, never auto-qualified.
              </p>
              <div className="ops-check-row">
                {ROOF_TYPE_OPTIONS.map(rt => (
                  <label key={rt} className="ops-check ops-check-inline">
                    <input type="checkbox" name="roof_types" value={rt} defaultChecked={selectedRoofs.has(rt)} />
                    <span>{ROOF_LABELS[rt] ?? rt}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="ops-grid-2">
              <Field label="Permit date from" name="permit_date_from" type="date"
                defaultValue={campaign?.permit_date_from} errors={state.fieldErrors} />
              <Field label="Permit date to" name="permit_date_to" type="date"
                defaultValue={campaign?.permit_date_to} errors={state.fieldErrors} />
            </div>

            <Field label="Minimum roof age (years) to count as an opportunity" name="min_roof_age_years"
              type="number" inputMode="numeric" defaultValue={campaign?.min_roof_age_years}
              hint="A roof younger than this is treated as low-priority. Leave blank to skip age screening."
              errors={state.fieldErrors} />

            <div className="ops-grid-2">
              <SelectField label="Waste rule" name="waste_rule_type"
                defaultValue={campaign?.waste_rule_type ?? 'percent'}
                options={WASTE_RULE_TYPES.map(t => ({ value: t, label: WASTE_RULE_LABELS[t] }))}
                errors={state.fieldErrors}
              />
              <Field label="Waste value" name="waste_rule_value" type="number" inputMode="decimal" step="0.01"
                defaultValue={campaign?.waste_rule_value}
                hint="Percent for 'percentage', squares for 'fixed'/'minimum'. Ignored for 'no waste'."
                errors={state.fieldErrors} />
            </div>

            <Field label="Minimum billable squares (optional floor)" name="waste_min_squares"
              type="number" inputMode="decimal" step="0.01" defaultValue={campaign?.waste_min_squares}
              hint="Applied alongside the waste rule. Leave blank for none." errors={state.fieldErrors} />

            <div className="ops-grid-2">
              <Field label="Price book service type" name="pricebook_service_type"
                defaultValue={campaign?.pricebook_service_type} placeholder="Roofing"
                hint="Which price-book items estimates from this campaign draw on (Phase 4)." errors={state.fieldErrors} />
              <SelectField label="Proposal template" name="proposal_template_id"
                defaultValue={campaign?.proposal_template_id} placeholder="— None —"
                options={templates.map(t => ({ value: t.id, label: t.name }))} errors={state.fieldErrors} />
            </div>

            <div className="ops-grid-2">
              <Field label="Default batch size" name="default_batch_size" type="number" inputMode="numeric"
                defaultValue={campaign?.default_batch_size ?? 60}
                hint="How many records a bulk action processes at once." errors={state.fieldErrors} />
              <Field label="Mail campaign tag" name="mail_tag" defaultValue={campaign?.mail_tag}
                placeholder="SAR-SHINGLE-Q4" errors={state.fieldErrors} />
            </div>

            <CheckField label="Active" name="active" defaultChecked={campaign?.active ?? true}
              hint="Inactive campaigns stay for history but are hidden from the import picker." />

            <div className="ops-form-actions">
              <SubmitButton>{campaign?.id ? 'Save campaign' : 'Create campaign'}</SubmitButton>
            </div>
          </div>
        </div>
      )}
    </ActionForm>
  )
}
