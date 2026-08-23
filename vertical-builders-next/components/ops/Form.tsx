'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { IDLE, type ActionState } from '@/lib/ops/actions-shared'

/**
 * Thin wrapper around a server action that gives every form in Vertical Ops the
 * same success / error / pending behaviour without a form library.
 */
export function ActionForm({
  action,
  children,
  className,
  encType,
  onSuccess,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>
  children: (state: ActionState) => React.ReactNode
  className?: string
  encType?: string
  onSuccess?: (state: ActionState) => void
}) {
  const [state, formAction] = useFormState(action, IDLE)

  if (state.ok && onSuccess) onSuccess(state)

  return (
    <form action={formAction} className={className} encType={encType} noValidate>
      {state.error && (
        <div className="ops-banner bad" role="alert">
          <AlertCircle aria-hidden="true" />
          <div>{state.error}</div>
        </div>
      )}
      {state.ok && state.message && (
        <div className="ops-banner ok" role="status">
          <CheckCircle2 aria-hidden="true" />
          <div>{state.message}</div>
        </div>
      )}
      {children(state)}
    </form>
  )
}

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  className = 'ops-btn ops-btn-primary',
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  )
}

export function Field({
  label, name, type = 'text', defaultValue, required, placeholder, hint, errors, autoComplete, ...rest
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string | number | null
  required?: boolean
  placeholder?: string
  hint?: string
  errors?: Record<string, string[]>
  autoComplete?: string
  min?: string
  max?: string
  step?: string
  inputMode?: 'numeric' | 'decimal' | 'text' | 'tel' | 'email'
}) {
  const error = errors?.[name]?.[0]
  return (
    <div className="ops-field">
      <label htmlFor={name}>{label}{required && ' *'}</label>
      <input
        id={name}
        name={name}
        type={type}
        className="ops-input"
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        {...rest}
      />
      {hint && !error && <p className="ops-hint" id={`${name}-hint`}>{hint}</p>}
      {error && <p className="ops-error" id={`${name}-error`}>{error}</p>}
    </div>
  )
}

export function SelectField({
  label, name, options, defaultValue, required, hint, errors, placeholder,
}: {
  label: string
  name: string
  options: { value: string; label: string }[]
  defaultValue?: string | null
  required?: boolean
  hint?: string
  errors?: Record<string, string[]>
  placeholder?: string
}) {
  const error = errors?.[name]?.[0]
  return (
    <div className="ops-field">
      <label htmlFor={name}>{label}{required && ' *'}</label>
      <select
        id={name}
        name={name}
        className="ops-select"
        defaultValue={defaultValue ?? ''}
        aria-invalid={error ? 'true' : undefined}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && !error && <p className="ops-hint">{hint}</p>}
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}

export function TextareaField({
  label, name, defaultValue, rows = 4, hint, errors, placeholder,
}: {
  label: string
  name: string
  defaultValue?: string | null
  rows?: number
  hint?: string
  errors?: Record<string, string[]>
  placeholder?: string
}) {
  const error = errors?.[name]?.[0]
  return (
    <div className="ops-field">
      <label htmlFor={name}>{label}</label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        className="ops-textarea"
        defaultValue={defaultValue ?? undefined}
        placeholder={placeholder}
        aria-invalid={error ? 'true' : undefined}
      />
      {hint && !error && <p className="ops-hint">{hint}</p>}
      {error && <p className="ops-error">{error}</p>}
    </div>
  )
}

export function CheckField({
  label, name, defaultChecked, hint,
}: {
  label: string
  name: string
  defaultChecked?: boolean
  hint?: string
}) {
  return (
    <div className="ops-field">
      <label className="ops-check" htmlFor={name}>
        <input id={name} name={name} type="checkbox" defaultChecked={defaultChecked} />
        <span>
          {label}
          {hint && <span className="ops-hint" style={{ display: 'block' }}>{hint}</span>}
        </span>
      </label>
    </div>
  )
}
