'use client'

import { useState } from 'react'
import LeadForm, { type LeadFormValues } from './LeadForm'
import { LeadStructurePanel } from './LeadAiAssist'
import type { LeadStructure } from '@/lib/ops/ai/schemas'
import type { ParsedLead } from '@/lib/ops/smart/lead-parser'

/**
 * New-lead screen with the assistant panel above it.
 *
 * Whichever mode filled the fields — built-in extraction or AI structuring —
 * the outcome is identical: the form gets defaults, and the operator saves
 * through the ordinary path with the same validation, the same server action
 * and the same activity log entry as a lead typed in by hand. `formKey` forces
 * a remount so the uncontrolled inputs pick up the new values.
 */
export default function NewLeadWithAi({
  staff,
  serviceTypes,
  aiConfigured,
  initial,
}: {
  staff: { id: string; label: string }[]
  serviceTypes: string[]
  aiConfigured: boolean
  initial?: LeadFormValues
}) {
  const [values, setValues] = useState<LeadFormValues | undefined>(initial)
  const [formKey, setFormKey] = useState(0)

  function applyFields(fields: ParsedLead['fields']) {
    setValues({
      first_name: fields.first_name || undefined,
      last_name: fields.last_name || undefined,
      company_name: fields.company_name || undefined,
      email: fields.email || undefined,
      phone: fields.phone || undefined,
      service_type: fields.service_type || undefined,
      property_address: fields.property_address || undefined,
      city: fields.city || undefined,
      state: fields.state || undefined,
      zip: fields.zip || undefined,
      project_description: fields.project_description || undefined,
      timeline: fields.timeline || undefined,
    })
    setFormKey(k => k + 1)
  }

  function applyDraft(draft: LeadStructure) {
    setValues({
      first_name: draft.fields.first_name || undefined,
      last_name: draft.fields.last_name || undefined,
      company_name: draft.fields.company_name || undefined,
      email: draft.fields.email || undefined,
      phone: draft.fields.phone || undefined,
      customer_type: draft.fields.customer_type ?? undefined,
      service_type: draft.fields.service_type || undefined,
      property_address: draft.fields.property_address || undefined,
      city: draft.fields.city || undefined,
      state: draft.fields.state || undefined,
      zip: draft.fields.zip || undefined,
      project_description: draft.fields.project_description || undefined,
      timeline: draft.fields.timeline || undefined,
    })
    setFormKey(k => k + 1)
  }

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <LeadStructurePanel aiConfigured={aiConfigured} onDraft={applyDraft} onFields={applyFields} />
      </div>
      <LeadForm key={formKey} lead={values} staff={staff} serviceTypes={serviceTypes} />
    </>
  )
}
