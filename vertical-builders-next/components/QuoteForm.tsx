'use client'

import { useEffect, useState } from 'react'
import { BIZ, CONTACT_PREFS, PROJECT_TYPES } from '@/lib/data'

type Status = 'idle' | 'sending' | 'success' | 'error'

interface FieldErrors { [key: string]: string }

function validate(data: Record<string, string>): FieldErrors {
  const errors: FieldErrors = {}
  if (!data.name?.trim()) errors.name = 'Please enter your name.'
  if (!data.phone?.trim() || data.phone.replace(/\D/g, '').length < 10) errors.phone = 'Please enter a valid phone number.'
  if (!data.email?.trim() || !/^\S+@\S+\.\S+$/.test(data.email)) errors.email = 'Please enter a valid email.'
  if (!data.projectType) errors.projectType = 'Please choose a project type.'
  return errors
}

/**
 * Reads UTM parameters and the referrer so the CRM can attribute the lead.
 * Everything is optional — a lead with no attribution is still a lead.
 */
function attribution() {
  if (typeof window === 'undefined') return {}
  const params = new URLSearchParams(window.location.search)
  const pick = (key: string) => params.get(key) ?? undefined
  return {
    sourcePage: window.location.pathname,
    utmSource: pick('utm_source'),
    utmMedium: pick('utm_medium'),
    utmCampaign: pick('utm_campaign'),
    utmTerm: pick('utm_term'),
    utmContent: pick('utm_content'),
    referrer: document.referrer || undefined,
  }
}

export default function QuoteForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [projectType, setProjectType] = useState('')

  // Links like /contact?service=Roofing arrive with the project type chosen.
  // Read on the client so the page itself stays statically prerendered.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('service')
    if (wanted && (PROJECT_TYPES as readonly string[]).includes(wanted)) setProjectType(wanted)
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>

    // Honeypot: silently succeed for bots
    if (data.company) { setStatus('success'); return }

    const fieldErrors = validate(data)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) {
      // Move focus to the first problem so keyboard and screen-reader users land on it.
      const first = Object.keys(fieldErrors)[0]
      form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus()
      return
    }

    setStatus('sending')
    try {
      // Lead intake goes straight into Vertical Ops (the CRM). The endpoint
      // creates the lead record first and notifies the office afterwards, so a
      // mail problem can never lose an enquiry.
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, ...attribution() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus('success')
      form.reset()
      setProjectType('')
      // Fire a GA4 lead event on confirmed success only (not on validation
      // failures or API errors) so Analytics/Ads conversion counts reflect
      // real leads.
      if (typeof window !== 'undefined' && typeof (window as any).gtag === 'function') {
        ;(window as any).gtag('event', 'qualify_lead', { project_type: data.projectType })
      }
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="form-success" role="status" tabIndex={-1} ref={el => el?.focus()}>
        <h2>Request received — thank you.</h2>
        <p>
          The office will contact you shortly, usually the same business day, to set up your free
          inspection or estimate. Need us sooner? Call <a href={BIZ.phoneHref} style={{ color: '#fff' }}>{BIZ.phone}</a>.
        </p>
      </div>
    )
  }

  return (
    <form className="quote" onSubmit={handleSubmit} noValidate aria-label="Free estimate request">
      <p className="form-note">Takes about a minute. Fields marked * are required.</p>
      {/* Honeypot field — hidden from real users */}
      <p className="hidden-field" aria-hidden="true">
        <label>Company <input name="company" tabIndex={-1} autoComplete="off" /></label>
      </p>
      <div className="form-row">
        <div>
          <label htmlFor="name">Name *</label>
          <input id="name" name="name" required autoComplete="name" aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-err' : undefined} />
          {errors.name && <p className="field-error" id="name-err">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="phone">Phone *</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" required autoComplete="tel" aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'phone-err' : undefined} />
          {errors.phone && <p className="field-error" id="phone-err">{errors.phone}</p>}
        </div>
      </div>
      <div className="form-row">
        <div>
          <label htmlFor="email">Email *</label>
          <input id="email" name="email" type="email" inputMode="email" required autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-err' : undefined} />
          {errors.email && <p className="field-error" id="email-err">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="city">City of the property</label>
          <input id="city" name="city" autoComplete="address-level2" placeholder="e.g. Venice" />
        </div>
      </div>
      <div className="form-row">
        <div>
          <label htmlFor="projectType">Project Type *</label>
          <select
            id="projectType"
            name="projectType"
            required
            value={projectType}
            onChange={e => setProjectType(e.target.value)}
            aria-invalid={!!errors.projectType}
            aria-describedby={errors.projectType ? 'projectType-err' : undefined}
          >
            <option value="" disabled>Select a project type…</option>
            {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
          {errors.projectType && <p className="field-error" id="projectType-err">{errors.projectType}</p>}
        </div>
        <div>
          <label htmlFor="customerType">Residential or Commercial</label>
          <select id="customerType" name="customerType" defaultValue="residential">
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
        </div>
      </div>
      <div className="form-row">
        <div>
          <label htmlFor="preferredContactMethod">Best way to reach you</label>
          <select id="preferredContactMethod" name="preferredContactMethod" defaultValue="phone">
            {CONTACT_PREFS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div />
      </div>
      <div>
        <label htmlFor="message">Message</label>
        <textarea id="message" name="message" placeholder="What's going on, and roughly when you'd like it done…" />
      </div>
      <button className="btn btn-accent" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Request My Free Estimate'}
      </button>
      <p className="form-privacy">We use your details only to respond to this request. <a href="/privacy">Privacy policy</a>.</p>
      {status === 'error' && (
        <p className="form-error" role="alert">
          Something went wrong sending your request. Please call us at <a href={BIZ.phoneHref}>{BIZ.phone}</a>.
        </p>
      )}
    </form>
  )
}
