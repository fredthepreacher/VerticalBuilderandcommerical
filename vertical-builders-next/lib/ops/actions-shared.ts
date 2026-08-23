import type { ZodError } from 'zod'

/**
 * Shared shape for every server action result, so forms can render errors the
 * same way everywhere. Never leaks a stack trace or a database message to the
 * browser — those go to the server log.
 */
export interface ActionState {
  ok?: boolean
  error?: string
  message?: string
  fieldErrors?: Record<string, string[]>
  /** Set by actions that produce something the UI needs, e.g. an upload link. */
  data?: Record<string, unknown>
}

export const IDLE: ActionState = {}

export function zodToState(error: ZodError): ActionState {
  const flat = error.flatten()
  return {
    ok: false,
    error: 'Please correct the highlighted fields.',
    fieldErrors: flat.fieldErrors as Record<string, string[]>,
  }
}

export function failure(message: string): ActionState {
  return { ok: false, error: message }
}

export function success(message?: string, data?: Record<string, unknown>): ActionState {
  return { ok: true, message, data }
}

/**
 * Turns an unexpected exception into a safe message. The real error is logged
 * server-side; the user gets something actionable instead of a stack trace.
 */
export function handleUnexpected(context: string, error: unknown): ActionState {
  console.error(`[action:${context}]`, error)
  if (error instanceof Error && error.name === 'PermissionError') {
    return { ok: false, error: error.message }
  }
  return { ok: false, error: 'Something went wrong saving that. Please try again, or contact an administrator if it keeps happening.' }
}

/** Reads a form field as a trimmed string, or undefined when blank. */
export function str(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function bool(form: FormData, key: string): boolean {
  const value = form.get(key)
  return value === 'on' || value === 'true' || value === '1'
}

export function strList(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}
