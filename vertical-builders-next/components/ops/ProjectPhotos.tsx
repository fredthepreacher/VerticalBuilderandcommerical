'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Camera, Download } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { uploadProjectPhoto } from '@/app/ops/actions/operations'
import { PHOTO_PHASES, PHOTO_PHASE_LABELS, type PhotoPhase } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'

export interface ProjectPhoto {
  id: string
  documentId: string
  phase: PhotoPhase
  caption: string | null
  takenAt: string | null
  customerVisible: boolean
  filename: string
}

/**
 * Before / during / after photos.
 *
 * Built for a phone: the upload control opens the camera directly, several
 * shots can go up at once, and the phase is chosen before shooting rather than
 * tagged afterwards — because nobody goes back and tags 40 photos at the end of
 * a job.
 */
export default function ProjectPhotos({
  projectId,
  photos,
  canUpload,
  activePhase,
}: {
  projectId: string
  photos: ProjectPhoto[]
  canUpload: boolean
  activePhase?: string
}) {
  const [showUpload, setShowUpload] = useState(photos.length === 0)
  const [lightbox, setLightbox] = useState<ProjectPhoto | null>(null)

  const filtered = activePhase ? photos.filter(p => p.phase === activePhase) : photos
  const counts = PHOTO_PHASES.map(phase => ({
    phase,
    count: photos.filter(p => p.phase === phase).length,
  })).filter(c => c.count > 0)

  const href = (phase?: string) =>
    `/ops/projects/${projectId}?tab=photos${phase ? `&phase=${phase}` : ''}`

  return (
    <>
      <section className="ops-card">
        <div className="ops-card-head">
          <Camera aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
          <h2>Photos</h2>
          <div className="ops-card-actions">
            {canUpload && (
              <button type="button" className="ops-btn ops-btn-sm ops-btn-primary"
                onClick={() => setShowUpload(s => !s)}>
                <Camera aria-hidden="true" /> Add photos
              </button>
            )}
          </div>
        </div>

        <div className="ops-card-body">
          {counts.length > 0 && (
            <div className="ops-chips" style={{ marginBottom: 16 }}>
              <Link href={href()} className={`ops-chip ops-chip-link${!activePhase ? ' is-on' : ''}`}>
                All · {photos.length}
              </Link>
              {counts.map(({ phase, count }) => (
                <Link key={phase} href={href(phase)}
                  className={`ops-chip ops-chip-link${activePhase === phase ? ' is-on' : ''}`}>
                  {PHOTO_PHASE_LABELS[phase]} · {count}
                </Link>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="ops-hint">
              {photos.length === 0
                ? 'No photos yet. Before-and-after shots are the single most useful thing a crew can leave behind — for the customer, for a warranty claim, and for a dispute.'
                : 'No photos in that phase.'}
            </p>
          ) : (
            <div className="ops-photo-grid">
              {filtered.map(photo => (
                <figure key={photo.id} className="ops-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/documents/${photo.documentId}/download`}
                    alt={photo.caption ?? `${PHOTO_PHASE_LABELS[photo.phase]} photo`}
                    loading="lazy"
                  />
                  <span className="phase-tag">{PHOTO_PHASE_LABELS[photo.phase]}</span>
                  <button
                    type="button" className="ops-photo-open"
                    onClick={() => setLightbox(photo)}
                    aria-label={`View ${photo.caption ?? photo.filename} full size`}
                    style={{ background: 'transparent', border: 0, cursor: 'zoom-in' }}
                  />
                  {(photo.caption || photo.takenAt) && (
                    <figcaption>
                      {photo.caption}
                      {photo.takenAt && (
                        <span style={{ display: 'block', opacity: .85 }}>{formatDate(photo.takenAt)}</span>
                      )}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}

          {showUpload && canUpload && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--ops-line)' }}>
              <ActionForm action={uploadProjectPhoto} encType="multipart/form-data">
                {state => (
                  <>
                    <input type="hidden" name="project_id" value={projectId} />

                    <div className="ops-grid-2">
                      <div className="ops-field">
                        <label htmlFor="pp-phase">Phase</label>
                        <select id="pp-phase" name="phase" className="ops-select"
                          defaultValue={activePhase ?? 'progress'}>
                          {PHOTO_PHASES.map(p => (
                            <option key={p} value={p}>{PHOTO_PHASE_LABELS[p]}</option>
                          ))}
                        </select>
                      </div>
                      <div className="ops-field">
                        <label htmlFor="pp-date">Taken on</label>
                        <input id="pp-date" name="taken_at" type="date" className="ops-input"
                          defaultValue={new Date().toISOString().slice(0, 10)} />
                      </div>
                    </div>

                    <label className="ops-dropzone" htmlFor="pp-files">
                      <Camera aria-hidden="true" />
                      <strong>Take photos or choose from the library</strong>
                      <span>Up to 20 at a time · JPG, PNG or WebP</span>
                      <input
                        id="pp-files" name="photos" type="file" multiple required
                        accept="image/jpeg,image/png,image/webp" capture="environment"
                        style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                      />
                    </label>

                    <div className="ops-field" style={{ marginTop: 14 }}>
                      <label htmlFor="pp-caption">Caption for this batch</label>
                      <input id="pp-caption" name="caption" className="ops-input"
                        placeholder="Tear-off complete, decking exposed" />
                    </div>

                    <label className="ops-check" style={{ marginBottom: 12 }}>
                      <input type="checkbox" name="customer_visible" />
                      <span>
                        Safe to show the customer
                        <span className="ops-hint" style={{ display: 'block' }}>
                          Marks them for future customer-facing use. Nothing is published anywhere today.
                        </span>
                      </span>
                    </label>

                    {state.error && <p className="ops-error">{state.error}</p>}
                    <SubmitButton className="ops-btn ops-btn-primary" pendingLabel="Uploading…">
                      Upload photos
                    </SubmitButton>
                  </>
                )}
              </ActionForm>
            </div>
          )}

          <p className="ops-hint" style={{ marginTop: 16 }}>
            Photos live in the same private store as every other document. There is no public URL —
            each one is fetched through a short-lived signed link for signed-in staff only.
          </p>
        </div>
      </section>

      {lightbox && (
        <div
          className="ops-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <div style={{ maxWidth: '92vw', maxHeight: '88vh', textAlign: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/documents/${lightbox.documentId}/download`}
              alt={lightbox.caption ?? lightbox.filename}
              style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 8, background: '#000' }}
            />
            <div style={{ color: '#fff', marginTop: 12, fontSize: '.86rem' }}>
              <strong>{PHOTO_PHASE_LABELS[lightbox.phase]}</strong>
              {lightbox.caption && <> — {lightbox.caption}</>}
              {lightbox.takenAt && <> · {formatDate(lightbox.takenAt)}</>}
              <a className="ops-btn ops-btn-sm" style={{ marginLeft: 12 }}
                href={`/api/documents/${lightbox.documentId}/download`} rel="noopener"
                onClick={e => e.stopPropagation()}>
                <Download aria-hidden="true" /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
