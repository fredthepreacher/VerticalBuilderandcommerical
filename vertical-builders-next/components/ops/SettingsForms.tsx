'use client'

import { useTransition } from 'react'
import { ActionForm, Field, SubmitButton } from './Form'
import { saveRequirementTemplate, saveSettings, setUserActive, setUserRole } from '@/app/ops/actions/settings'
import { COVERAGE_LABELS, COVERAGE_TYPES, USER_ROLES, type CoverageType } from '@/lib/ops/types'
import type { InsuranceRequirement } from '@/lib/ops/types'
import type { ActionState } from '@/lib/ops/actions-shared'

export function GeneralSettingsForm({
  settings,
}: {
  settings: {
    warning_window_days: number
    reminder_thresholds: number[]
    company_name: string
    company_email: string
    company_phone: string
    max_upload_mb: number
    upload_token_ttl_days: number
  }
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>General</h2></div>
      <div className="ops-card-body">
        <ActionForm action={saveSettings}>
          {state => (
            <>
              <div className="ops-grid-2">
                <Field label="Warning window (days)" name="warning_window_days" type="number" min="1" max="365"
                  defaultValue={settings.warning_window_days} errors={state.fieldErrors}
                  hint="How far ahead a policy counts as “expiring soon”." />
                <Field label="Reminder thresholds (days)" name="reminder_thresholds"
                  defaultValue={settings.reminder_thresholds.join(',')} errors={state.fieldErrors}
                  hint="Comma separated. 0 means on the expiration day itself." />
              </div>
              <div className="ops-grid-2">
                <Field label="Max upload size (MB)" name="max_upload_mb" type="number" min="1" max="50"
                  defaultValue={settings.max_upload_mb} errors={state.fieldErrors} />
                <Field label="Vendor upload link lifetime (days)" name="upload_token_ttl_days" type="number" min="1" max="90"
                  defaultValue={settings.upload_token_ttl_days} errors={state.fieldErrors} />
              </div>
              <div className="ops-grid-3">
                <Field label="Company name" name="company_name" defaultValue={settings.company_name} errors={state.fieldErrors} />
                <Field label="Office email" name="company_email" type="email" defaultValue={settings.company_email} errors={state.fieldErrors} />
                <Field label="Office phone" name="company_phone" defaultValue={settings.company_phone} errors={state.fieldErrors} />
              </div>
              <SubmitButton>Save settings</SubmitButton>
              <p className="ops-hint" style={{ marginTop: 8 }}>
                Saving re-evaluates every subcontractor, since the warning window changes what
                counts as expiring.
              </p>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

export function RequirementTemplateForm({
  template,
  requirements,
}: {
  template: { id: string; name: string; scope: string; trade: string | null; disclaimer: string | null }
  requirements: InsuranceRequirement[]
}) {
  const action = saveRequirementTemplate.bind(null, template.id)
  const byCoverage = new Map(requirements.map(r => [r.coverage_type, r]))

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <h2>{template.name}</h2>
        <div className="ops-card-actions">
          <span className="ops-hint" style={{ textTransform: 'capitalize' }}>
            {template.scope}{template.trade ? ` · ${template.trade}` : ''}
          </span>
        </div>
      </div>
      <div className="ops-card-body">
        <div className="ops-banner warn" style={{ fontSize: '.82rem' }}>
          <div>
            <strong>These are configuration, not legal advice</strong>
            Vertical Ops evaluates subcontractors against exactly what is entered here. Confirm every
            line with Vertical Builders &amp; Commercial’s insurance professional before relying on
            the results.
          </div>
        </div>

        <ActionForm action={action as (p: ActionState, f: FormData) => Promise<ActionState>}>
          {() => (
            <>
              <Field label="Template name" name="name" defaultValue={template.name} required />

              {COVERAGE_TYPES.map(coverage => {
                const req = byCoverage.get(coverage)
                return (
                  <fieldset className="ops-policy-line" key={coverage}>
                    <legend style={{ padding: 0, width: '100%' }}>
                      <label className="ops-check" style={{ marginBottom: 10 }}>
                        <input type="checkbox" name={`req[${coverage}][required]`} defaultChecked={req?.required ?? false} />
                        <strong style={{ fontSize: '.88rem', color: 'var(--ops-ink)' }}>
                          Require {COVERAGE_LABELS[coverage]}
                        </strong>
                      </label>
                    </legend>

                    <div className="ops-grid-4">
                      {limitsFor(coverage).map(f => (
                        <div className="ops-field" key={f.name}>
                          <label htmlFor={`${coverage}-${f.name}`}>{f.label}</label>
                          <input
                            id={`${coverage}-${f.name}`}
                            name={`req[${coverage}][${f.name}]`}
                            className="ops-input"
                            inputMode="numeric"
                            placeholder="1,000,000"
                            defaultValue={valueFor(req, f.name) ?? ''}
                          />
                        </div>
                      ))}
                    </div>

                    <div className="ops-flag-row">
                      <Flag label="Additional insured required" name={`req[${coverage}][ai]`} on={req?.additional_insured_required} />
                      <Flag label="Waiver of subrogation required" name={`req[${coverage}][wos]`} on={req?.waiver_of_subrogation_required} />
                      <Flag label="Primary / non-contributory required" name={`req[${coverage}][pnc]`} on={req?.primary_noncontributory_required} />
                      <Flag label="Endorsement copy required" name={`req[${coverage}][endorsement]`} on={req?.endorsement_required} />
                    </div>

                    <div className="ops-field" style={{ marginTop: 10, marginBottom: 0 }}>
                      <label htmlFor={`${coverage}-notes`}>Notes</label>
                      <input id={`${coverage}-notes`} name={`req[${coverage}][notes]`} className="ops-input"
                        defaultValue={req?.notes ?? ''} />
                    </div>
                  </fieldset>
                )
              })}

              <SubmitButton pendingLabel="Saving and re-evaluating…">Save requirements</SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}

function limitsFor(coverage: CoverageType): { name: string; label: string }[] {
  switch (coverage) {
    case 'workers_compensation':
      return [{ name: 'el', label: "Min employer's liability" }]
    case 'commercial_auto':
      return [{ name: 'csl', label: 'Min combined single limit' }]
    default:
      return [
        { name: 'each_occurrence', label: 'Min each occurrence' },
        { name: 'aggregate', label: 'Min aggregate' },
      ]
  }
}

function valueFor(req: InsuranceRequirement | undefined, field: string): string | null {
  if (!req) return null
  switch (field) {
    case 'each_occurrence': return req.min_limit_each_occurrence?.toString() ?? null
    case 'aggregate': return req.min_limit_aggregate?.toString() ?? null
    case 'csl': return req.min_combined_single_limit?.toString() ?? null
    case 'el': return req.min_workers_comp_el?.toString() ?? null
    default: return null
  }
}

function Flag({ label, name, on }: { label: string; name: string; on?: boolean }) {
  return (
    <label className="ops-check">
      <input type="checkbox" name={name} defaultChecked={on} />
      <span>{label}</span>
    </label>
  )
}

export function UserRow({
  profile,
  isSelf,
}: {
  profile: { id: string; full_name: string | null; email: string | null; role: string; active: boolean }
  isSelf: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <tr>
      <td data-label="Name" className="ops-cell-primary">
        {profile.full_name ?? profile.email}
        {isSelf && <span className="ops-sub2">That’s you</span>}
      </td>
      <td data-label="Email">{profile.email}</td>
      <td data-label="Role">
        <select
          className="ops-select" defaultValue={profile.role} disabled={isSelf || pending}
          aria-label={`Role for ${profile.full_name ?? profile.email}`}
          onChange={e => {
            const role = e.target.value
            startTransition(async () => { await setUserRole(profile.id, role) })
          }}
        >
          {USER_ROLES.map(r => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </td>
      <td data-label="Status">
        <button
          type="button" className="ops-btn ops-btn-sm" disabled={isSelf || pending}
          onClick={() => startTransition(async () => { await setUserActive(profile.id, !profile.active) })}
        >
          {profile.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </td>
    </tr>
  )
}
