'use client'

import { useState } from 'react'
import LeadForm, { type LeadFormValues } from './LeadForm'
import { LeadStructurePanel } from './LeadAiAssist'
import type { LeadStructure } from '@/lib/ops/ai/schemas'

/**
 * New-lead screen with the optional AI helper above it.
 *
 * The AI only ever fills in the form. `formKey` forces a remount so the
 * uncontrolled inputs pick up the new defaults, and the operator then edits and
 * saves through the ordinary path — same validation, same server action, same
 * activity log entry as a lead typed in by hand.
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
        <LeadStructurePanel configured={aiConfigured} onDraft={applyDraft} />
      </div>
      <LeadForm key={formKey} lead={values} staff={staff} serviceTypes={serviceTypes} />
    </>
  )
}
