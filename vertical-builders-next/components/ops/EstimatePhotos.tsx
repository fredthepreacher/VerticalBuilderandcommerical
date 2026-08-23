'use client'

import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { uploadEstimatePhoto } from '@/app/ops/actions/estimates'
import { ESTIMATE_PHOTO_TYPES } from '@/lib/ops/types'

export interface EstimatePhoto {
  id: string
  documentId: string
  caption: string | null
  photoType: string
  customerVisible: boolean
  filename: string
}

export default function EstimatePhotos({
  estimateId,
  photos,
  canUpload,
}: {
  estimateId: string
  photos: EstimatePhoto[]
  canUpload: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const visible = photos.filter(p => p.customerVisible).length

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <h2>Photos</h2>
        {canUpload && (
          <div className="ops-card-actions">
            <button type="button" className="ops-btn ops-btn-sm" onClick={() => setShowForm(s => !s)}>
              <ImagePlus aria-hidden="true" /> Add
            </button>
          </div>
        )}
      </div>

      <div className="ops-card-body">
        {photos.length === 0 ? (
          <p className="ops-hint">
            No photos yet. Inspection shots make an estimate far more persuasive, and the ones you
            mark customer-visible are printed on the PDF.
          </p>
        ) : (
          <>
            <div className="ops-photo-grid">
              {photos.map(photo => (
                <figure key={photo.id} className="ops-photo">
                  {/* Private bucket: the download route mints a signed URL per request. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/documents/${photo.documentId}/download`} alt={photo.caption ?? photo.filename} loading="lazy" />
                  <span className="phase-tag">{photo.photoType}</span>
                  {(photo.caption || !photo.customerVisible) && (
                    <figcaption>
                      {photo.caption}
                      {!photo.customerVisible && <em style={{ display: 'block', opacity: .8 }}>Internal only</em>}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
            <p className="ops-hint" style={{ marginTop: 10 }}>
              {visible} of {photos.length} will appear on the customer PDF.
            </p>
          </>
        )}

        {showForm && canUpload && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--ops-line)' }}>
            <ActionForm action={uploadEstimatePhoto} encType="multipart/form-data">
              {state => (
                <>
                  <input type="hidden" name="estimate_id" value={estimateId} />
                  <div className="ops-field">
                    <label htmlFor="ep-file">Photo</label>
                    <input id="ep-file" name="file" type="file" className="ops-input" required
                      accept="image/jpeg,image/png,image/webp" capture="environment" />
                    <p className="ops-hint">JPG or PNG print on the PDF. WebP is stored but not printed.</p>
                  </div>
                  <div className="ops-grid-2">
                    <div className="ops-field">
                      <label htmlFor="ep-type">Type</label>
                      <select id="ep-type" name="photo_type" className="ops-select" defaultValue="inspection">
                        {ESTIMATE_PHOTO_TYPES.map(t => (
                          <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="ops-field">
                      <label htmlFor="ep-caption">Caption</label>
                      <input id="ep-caption" name="caption" className="ops-input"
                        placeholder="Damaged shingles, north slope" />
                    </div>
                  </div>
                  <label className="ops-check" style={{ marginBottom: 12 }}>
                    <input type="checkbox" name="customer_visible" defaultChecked />
                    <span>Include on the customer PDF</span>
                  </label>
                  {state.error && <p className="ops-error">{state.error}</p>}
                  <SubmitButton className="ops-btn ops-btn-sm ops-btn-primary" pendingLabel="Uploading…">
                    Upload photo
                  </SubmitButton>
                </>
              )}
            </ActionForm>
          </div>
        )}
      </div>
    </section>
  )
}
