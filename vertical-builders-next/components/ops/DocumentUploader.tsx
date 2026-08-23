'use client'

import { useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { uploadVendorDocument } from '@/app/ops/actions/compliance'
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/lib/ops/types'

export default function DocumentUploader({
  entityType,
  entityId,
  defaultType = 'other',
}: {
  entityType: 'vendor' | 'project' | 'contact'
  entityId: string
  defaultType?: string
}) {
  const [filename, setFilename] = useState<string | null>(null)

  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Upload a document</h2></div>
      <div className="ops-card-body">
        <ActionForm action={uploadVendorDocument} encType="multipart/form-data">
          {state => (
            <>
              <input type="hidden" name="entity_type" value={entityType} />
              <input type="hidden" name="entity_id" value={entityId} />

              <label className="ops-dropzone" htmlFor="doc-file">
                <UploadCloud aria-hidden="true" />
                <strong>{filename ?? 'Choose a file'}</strong>
                <span>PDF, JPG, PNG or WebP · up to 10 MB</span>
                <input
                  id="doc-file"
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  required
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                  onChange={e => setFilename(e.target.files?.[0]?.name ?? null)}
                />
              </label>

              <div className="ops-field" style={{ marginTop: 14 }}>
                <label htmlFor="document_type">Document type</label>
                <select id="document_type" name="document_type" className="ops-select" defaultValue={defaultType}>
                  {DOCUMENT_TYPES.filter(t => t !== 'audit_package').map(t => (
                    <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              <div className="ops-grid-2">
                <div className="ops-field">
                  <label htmlFor="document_date">Document date</label>
                  <input id="document_date" name="document_date" type="date" className="ops-input" />
                </div>
                <div className="ops-field">
                  <label htmlFor="expiration_date">Expires</label>
                  <input id="expiration_date" name="expiration_date" type="date" className="ops-input" />
                  <p className="ops-hint">Optional. Expiring documents show up in reminders.</p>
                </div>
              </div>

              <div className="ops-field">
                <label htmlFor="description">Description</label>
                <input id="description" name="description" className="ops-input" placeholder="GL endorsement page, signed 2026 agreement…" />
              </div>

              {state.fieldErrors?.file && <p className="ops-error">{state.fieldErrors.file[0]}</p>}
              <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
              <p className="ops-hint" style={{ marginTop: 10 }}>
                Files are stored in a private bucket. They are only reachable through short-lived
                signed links generated for signed-in staff.
              </p>
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}
