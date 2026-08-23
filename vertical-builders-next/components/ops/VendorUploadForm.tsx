'use client'

import { useState } from 'react'
import { CheckCircle2, UploadCloud } from 'lucide-react'

/**
 * The vendor-facing upload form. Most subcontractors open this on a phone in a
 * truck, so it is one big target, plain language, and no required fields beyond
 * the file itself.
 */
export default function VendorUploadForm({
  token,
  vendorName,
  maxUploadMb,
}: {
  token: string
  vendorName: string
  maxUploadMb: number
}) {
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (!file) {
      setError('Choose a file first.')
      return
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${maxUploadMb} MB — try a smaller scan or a photo.`)
      return
    }

    const form = new FormData(e.currentTarget)
    form.set('token', token)
    form.set('file', file)

    setStatus('sending')
    try {
      const res = await fetch('/api/uploads/coi', { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'That did not go through. Please try again, or call the office.')
        setStatus('idle')
        return
      }
      setStatus('done')
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
      setStatus('idle')
    }
  }

  if (status === 'done') {
    return (
      <div className="ops-banner ok" role="status" style={{ marginBottom: 0 }}>
        <CheckCircle2 aria-hidden="true" />
        <div>
          <strong>Got it — thank you</strong>
          Your document has been received for {vendorName}. The Vertical Builders office will review
          it. You can close this page.
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <label className="ops-dropzone" htmlFor="vendor-file">
        <UploadCloud aria-hidden="true" />
        <strong>{file ? file.name : 'Tap to choose a file or take a photo'}</strong>
        <span>PDF, JPG or PNG · up to {maxUploadMb} MB</span>
        <input
          id="vendor-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          capture={undefined}
          required
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          onChange={e => { setFile(e.target.files?.[0] ?? null); setError(null) }}
        />
      </label>

      <details style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: '.86rem', fontWeight: 600, color: 'var(--ops-ink)' }}>
          Add your agent’s details (optional — it speeds up processing)
        </summary>
        <div style={{ marginTop: 14 }}>
          <div className="ops-field">
            <label htmlFor="broker_name">Insurance agency</label>
            <input id="broker_name" name="broker_name" className="ops-input" autoComplete="organization" />
          </div>
          <div className="ops-grid-2">
            <div className="ops-field">
              <label htmlFor="broker_contact_name">Agent name</label>
              <input id="broker_contact_name" name="broker_contact_name" className="ops-input" autoComplete="name" />
            </div>
            <div className="ops-field">
              <label htmlFor="broker_phone">Agent phone</label>
              <input id="broker_phone" name="broker_phone" type="tel" className="ops-input" autoComplete="tel" />
            </div>
          </div>
          <div className="ops-field">
            <label htmlFor="broker_email">Agent email</label>
            <input id="broker_email" name="broker_email" type="email" className="ops-input" autoComplete="email" />
          </div>
          <div className="ops-field">
            <label htmlFor="message">Anything we should know?</label>
            <textarea id="message" name="message" rows={3} className="ops-textarea"
              placeholder="The endorsement page is coming separately from my agent." />
          </div>
        </div>
      </details>

      {error && <p className="ops-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

      <button
        type="submit"
        className="ops-btn ops-btn-primary"
        style={{ width: '100%', marginTop: 18, minHeight: 48, fontSize: '.95rem' }}
        disabled={status === 'sending'}
      >
        {status === 'sending' ? 'Uploading…' : 'Send to Vertical Builders'}
      </button>
    </form>
  )
}
