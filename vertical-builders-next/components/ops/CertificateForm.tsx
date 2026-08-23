'use client'

import { useState } from 'react'
import { Plus, Trash2, UploadCloud } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { saveCertificate } from '@/app/ops/actions/compliance'
import { COVERAGE_LABELS, COVERAGE_TYPES, type CoverageType } from '@/lib/ops/types'

/**
 * Manual COI entry.
 *
 * This is the workflow the MVP is judged on: it must be fast with no AI, no
 * OCR, and no assumptions. One certificate header, then "Add coverage line" as
 * many times as the ACORD form has rows — because a single PDF routinely
 * carries GL, WC and Auto with three different carriers and three different
 * expiration dates.
 */

interface Line {
  key: number
  coverage: CoverageType
}

const STARTER_LINES: CoverageType[] = ['general_liability', 'workers_compensation', 'commercial_auto']

export default function CertificateForm({
  vendors,
  projects,
  defaultVendorId,
  replacesCertificateId,
}: {
  vendors: { id: string; label: string }[]
  projects: { id: string; label: string }[]
  defaultVendorId?: string
  replacesCertificateId?: string
}) {
  const [lines, setLines] = useState<Line[]>(
    STARTER_LINES.map((coverage, i) => ({ key: i, coverage })),
  )
  const [nextKey, setNextKey] = useState(STARTER_LINES.length)
  const [filename, setFilename] = useState<string | null>(null)

  function addLine() {
    setLines(l => [...l, { key: nextKey, coverage: 'umbrella' }])
    setNextKey(k => k + 1)
  }

  function removeLine(key: number) {
    setLines(l => (l.length === 1 ? l : l.filter(x => x.key !== key)))
  }

  function setCoverage(key: number, coverage: CoverageType) {
    setLines(l => l.map(x => (x.key === key ? { ...x, coverage } : x)))
  }

  return (
    <ActionForm action={saveCertificate} encType="multipart/form-data">
      {state => (
        <>
          {replacesCertificateId && (
            <input type="hidden" name="replaces_certificate_id" value={replacesCertificateId} />
          )}

          <div className="ops-card">
            <div className="ops-card-head"><h2>1 · Certificate</h2></div>
            <div className="ops-card-body">
              <div className="ops-field">
                <label htmlFor="vendor_id">Subcontractor *</label>
                <select id="vendor_id" name="vendor_id" className="ops-select" required defaultValue={defaultVendorId ?? ''}>
                  <option value="" disabled>Choose a subcontractor…</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                {state.fieldErrors?.vendor_id && <p className="ops-error">{state.fieldErrors.vendor_id[0]}</p>}
              </div>

              <label className="ops-dropzone" htmlFor="certificate_file">
                <UploadCloud aria-hidden="true" />
                <strong>{filename ?? 'Attach the original certificate'}</strong>
                <span>PDF, JPG, PNG or WebP · up to 10 MB · optional but strongly recommended</span>
                <input
                  id="certificate_file" name="certificate_file" type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                  onChange={e => setFilename(e.target.files?.[0]?.name ?? null)}
                />
              </label>

              <div className="ops-grid-3" style={{ marginTop: 16 }}>
                <TextInput label="Issue date" name="issue_date" type="date" />
                <TextInput label="Named insured" name="named_insured" placeholder="Exactly as printed on the COI" />
                <TextInput label="Certificate holder" name="certificate_holder" defaultValue="Vertical Builders & Commercial" />
              </div>

              <div className="ops-grid-4">
                <TextInput label="Agency / broker" name="broker_name" />
                <TextInput label="Broker contact" name="broker_contact_name" />
                <TextInput label="Broker email" name="broker_email" type="email" />
                <TextInput label="Broker phone" name="broker_phone" type="tel" />
              </div>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head">
              <h2>2 · Coverage lines</h2>
              <div className="ops-card-actions">
                <button type="button" className="ops-btn ops-btn-sm" onClick={addLine}>
                  <Plus aria-hidden="true" /> Add coverage line
                </button>
              </div>
            </div>
            <div className="ops-card-body">
              <p className="ops-hint" style={{ marginBottom: 14 }}>
                One row per policy on the certificate. Each row keeps its own carrier, policy
                number and expiration date — a certificate is never treated as a single date.
                Leave a row completely blank to skip it.
              </p>

              {lines.map((line, index) => (
                <fieldset className="ops-policy-line" key={line.key}>
                  <div className="ops-policy-line-head">
                    <legend style={{ padding: 0 }}>
                      <h4>Coverage {index + 1}</h4>
                    </legend>
                    <select
                      className="ops-select"
                      style={{ maxWidth: 240 }}
                      name={`policy[${line.key}][coverage_type]`}
                      value={line.coverage}
                      onChange={e => setCoverage(line.key, e.target.value as CoverageType)}
                      aria-label={`Coverage type for row ${index + 1}`}
                    >
                      {COVERAGE_TYPES.map(c => <option key={c} value={c}>{COVERAGE_LABELS[c]}</option>)}
                    </select>
                    {lines.length > 1 && (
                      <button
                        type="button" className="ops-btn ops-btn-sm ops-btn-danger"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Remove coverage row ${index + 1}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="ops-grid-4">
                    <TextInput label="Carrier" name={`policy[${line.key}][carrier]`} />
                    <TextInput label="NAIC" name={`policy[${line.key}][naic]`} />
                    <TextInput label="Policy number" name={`policy[${line.key}][policy_number]`} />
                    <TextInput label="Effective" name={`policy[${line.key}][effective_date]`} type="date" />
                  </div>
                  <div className="ops-grid-4">
                    <TextInput label="Expiration" name={`policy[${line.key}][expiration_date]`} type="date" />
                    {limitFieldsFor(line.coverage).map(f => (
                      <TextInput
                        key={f.name}
                        label={f.label}
                        name={`policy[${line.key}][${f.name}]`}
                        placeholder="1,000,000"
                        inputMode="numeric"
                      />
                    ))}
                  </div>

                  <div className="ops-flag-row">
                    <Check label="Additional insured" name={`policy[${line.key}][additional_insured]`} />
                    <Check label="Waiver of subrogation" name={`policy[${line.key}][waiver_of_subrogation]`} />
                    <Check label="Primary / non-contributory" name={`policy[${line.key}][primary_noncontributory]`} />
                    {line.coverage === 'workers_compensation' && (
                      <Check label="Statutory" name={`policy[${line.key}][statutory]`} defaultChecked />
                    )}
                    {line.coverage !== 'workers_compensation' && (
                      <>
                        <Check label="Occurrence form" name={`policy[${line.key}][occurrence_form]`} />
                        <Check label="Claims made" name={`policy[${line.key}][claims_made]`} />
                      </>
                    )}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <TextInput label="Notes on this line" name={`policy[${line.key}][notes]`} />
                  </div>
                </fieldset>
              ))}

              <button type="button" className="ops-btn" onClick={addLine}>
                <Plus aria-hidden="true" /> Add another coverage line
              </button>
            </div>
          </div>

          <div className="ops-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head"><h2>3 · Link &amp; review</h2></div>
            <div className="ops-card-body">
              {projects.length > 0 && (
                <div className="ops-field">
                  <span className="ops-label">Applies to projects (optional)</span>
                  <div className="ops-chips">
                    {projects.map(p => (
                      <label key={p.id} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" name="project_ids" value={p.id} style={{ accentColor: 'var(--ops-accent)' }} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="ops-field">
                <label htmlFor="reviewer_notes">Notes for the reviewer</label>
                <textarea id="reviewer_notes" name="reviewer_notes" rows={3} className="ops-textarea"
                  placeholder="Agent says the endorsement page is following separately." />
              </div>

              <div className="ops-banner info" style={{ marginBottom: 0 }}>
                <div>
                  <strong>Saved as “Needs review”</strong>
                  Nothing counts as compliant until a person compares these lines against the
                  document and approves it. Approving supersedes the previous certificate without
                  deleting it.
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <SubmitButton pendingLabel="Saving certificate…">Save certificate</SubmitButton>
            <a className="ops-btn" href="/ops/compliance">Cancel</a>
          </div>
        </>
      )}
    </ActionForm>
  )
}

function limitFieldsFor(coverage: CoverageType): { name: string; label: string }[] {
  switch (coverage) {
    case 'general_liability':
      return [
        { name: 'each_occurrence', label: 'Each occurrence' },
        { name: 'general_aggregate', label: 'General aggregate' },
        { name: 'products_completed_ops_aggregate', label: 'Products / comp-ops' },
      ]
    case 'workers_compensation':
      return [
        { name: 'el_each_accident', label: 'EL each accident' },
        { name: 'el_disease_each_employee', label: 'EL disease / employee' },
        { name: 'el_disease_policy_limit', label: 'EL disease / policy' },
      ]
    case 'commercial_auto':
      return [{ name: 'combined_single_limit', label: 'Combined single limit' }]
    case 'umbrella':
      return [
        { name: 'each_occurrence', label: 'Each occurrence' },
        { name: 'umbrella_aggregate', label: 'Aggregate' },
      ]
    default:
      return [
        { name: 'each_occurrence', label: 'Each occurrence' },
        { name: 'general_aggregate', label: 'Aggregate' },
      ]
  }
}

function TextInput({
  label, name, type = 'text', defaultValue, placeholder, inputMode,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  placeholder?: string
  inputMode?: 'numeric' | 'text'
}) {
  const id = name.replace(/[[\]]/g, '_')
  return (
    <div className="ops-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} name={name} type={type} className="ops-input"
        defaultValue={defaultValue} placeholder={placeholder} inputMode={inputMode}
      />
    </div>
  )
}

function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  const id = name.replace(/[[\]]/g, '_')
  return (
    <label className="ops-check" htmlFor={id}>
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  )
}
