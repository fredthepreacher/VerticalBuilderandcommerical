'use client'

import { useState } from 'react'
import { BIZ, PROJECT_TYPES } from '@/lib/data'

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

export default function QuoteForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errors, setErrors] = useState<FieldErrors>({})

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>

    // Honeypot: silently succeed for bots
    if (data.company) { setStatus('success'); return }

    const fieldErrors = validate(data)
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0) return

    setStatus('sending')
    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus('success')
      form.reset()
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="form-success" role="status">
        <h3>Request Received!</h3>
        <p>
          Thanks for reaching out. We&apos;ll get back to you shortly — usually the same business day.
          Need us sooner? Call <a href={BIZ.phoneHref} style={{ color: '#fff' }}>{BIZ.phone}</a>.
        </p>
      </div>
    )
  }

  return (
    <form className="quote" onSubmit={handleSubmit} noValidate>
      {/* Honeypot field — hidden from real users */}
      <p className="hidden-field" aria-hidden="true">
        <label>Company <input name="company" tabIndex={-1} autoComplete="off" /></label>
      </p>
      <div className="form-row">
        <div>
          <label htmlFor="name">Name *</label>
          <input id="name" name="name" required autoComplete="name" />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="phone">Phone *</label>
          <input id="phone" name="phone" type="tel" required autoComplete="tel" />
          {errors.phone && <p className="field-error">{errors.phone}</p>}
        </div>
      </div>
      <div className="form-row">
        <div>
          <label htmlFor="email">Email *</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
          {errors.email && <p className="field-error">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="city">City</label>
          <input id="city" name="city" autoComplete="address-level2" />
        </div>
      </div>
      <div>
        <label htmlFor="projectType">Project Type *</label>
        <select id="projectType" name="projectType" required defaultValue="">
          <option value="" disabled>Select a project type…</option>
          {PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}
        </select>
        {errors.projectType && <p className="field-error">{errors.projectType}</p>}
      </div>
      <div>
        <label htmlFor="message">Message</label>
        <textarea id="message" name="message" placeholder="Tell us briefly about your project…" />
      </div>
      <button className="btn btn-accent" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send My Request'}
      </button>
      {status === 'error' && (
        <p className="form-error" role="alert">
          Something went wrong sending your request. Please call us at <a href={BIZ.phoneHref}>{BIZ.phone}</a>.
        </p>
      )}
    </form>
  )
}
