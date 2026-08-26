'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { logActivity } from '@/lib/ops/services/activity'
import { uploadDocument } from '@/lib/ops/services/documents'
import { getSettings } from '@/lib/ops/services/settings'
import {
  createInvoiceFromEstimate, recordJobCost, recordManualPayment,
  saveInvoice, sendInvoice, voidInvoice, voidPayment,
} from '@/lib/ops/services/invoices'
import { stripeProvider } from '@/lib/ops/finance/payment-provider'
import { invoiceSchema, jobCostSchema, manualPaymentSchema } from '@/lib/ops/validations/estimate'
import type { PaymentMethod } from '@/lib/ops/types'
import {
  failure, handleUnexpected, str, success, zodToState, type ActionState,
} from '@/lib/ops/actions-shared'

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export async function saveInvoiceAction(
  invoiceId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability(invoiceId ? 'invoicesEdit' : 'invoicesCreate')
    const supabase = createSupabaseServerClient()

    const parsed = invoiceSchema.safeParse({
      project_id: str(form, 'project_id') ?? '',
      contact_id: str(form, 'contact_id') ?? '',
      estimate_id: str(form, 'estimate_id') ?? '',
      invoice_type: str(form, 'invoice_type') ?? 'standard',
      issue_date: str(form, 'issue_date') ?? new Date().toISOString().slice(0, 10),
      due_date: str(form, 'due_date') ?? '',
      discount_cents: str(form, 'discount') ?? '0',
      tax_percent: str(form, 'tax_percent') ?? '0',
      notes: str(form, 'notes'),
      customer_message: str(form, 'customer_message'),
      items: parseInvoiceItems(form),
    })
    if (!parsed.success) return zodToState(parsed.error)

    const result = await saveInvoice(supabase, parsed.data, user.id, invoiceId)
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/invoices')
    revalidatePath(`/ops/projects/${parsed.data.project_id}`)
    if (invoiceId) {
      revalidatePath(`/ops/invoices/${invoiceId}`)
      return success('Invoice saved.')
    }
    redirect(`/ops/invoices/${result.invoiceId}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('saveInvoice', error)
  }
}

export async function invoiceFromEstimate(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('invoicesCreate')
    const supabase = createSupabaseServerClient()

    const estimateId = str(form, 'estimate_id')
    const projectId = str(form, 'project_id')
    if (!estimateId || !projectId) {
      return failure('An estimate and a job are both needed. Convert the estimate to a job first.')
    }

    const result = await createInvoiceFromEstimate(supabase, {
      estimateId,
      projectId,
      actorUserId: user.id,
      invoiceType: (str(form, 'invoice_type') as 'standard' | 'deposit') ?? 'standard',
      depositPercent: Number(str(form, 'deposit_percent') ?? 50),
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath('/ops/invoices')
    redirect(`/ops/invoices/${result.invoiceId}`)
  } catch (error) {
    if (isRedirect(error)) throw error
    return handleUnexpected('invoiceFromEstimate', error)
  }
}

export async function sendInvoiceAction(invoiceId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('invoicesEdit')
    const supabase = createSupabaseServerClient()
    const result = await sendInvoice(supabase, invoiceId, user.id)
    if (!result.ok) return failure(result.error!)
    revalidatePath(`/ops/invoices/${invoiceId}`)
    revalidatePath('/ops/invoices')
    return success('Invoice marked as sent.')
  } catch (error) {
    return handleUnexpected('sendInvoice', error)
  }
}

export async function voidInvoiceAction(invoiceId: string, reason: string): Promise<ActionState> {
  try {
    const user = await requireCapability('invoicesVoid')
    const supabase = createSupabaseServerClient()
    if (!reason || reason.trim().length < 3) {
      return failure('Give a reason for voiding this invoice — it stays on the record.')
    }
    const result = await voidInvoice(supabase, { invoiceId, reason: reason.trim(), actorUserId: user.id })
    if (!result.ok) return failure(result.error!)
    revalidatePath(`/ops/invoices/${invoiceId}`)
    revalidatePath('/ops/invoices')
    return success('Invoice voided.')
  } catch (error) {
    return handleUnexpected('voidInvoice', error)
  }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('paymentsRecord')
    const supabase = createSupabaseServerClient()

    const parsed = manualPaymentSchema.safeParse({
      invoice_id: str(form, 'invoice_id') ?? '',
      amount_cents: str(form, 'amount') ?? '',
      method: str(form, 'method') ?? 'check',
      check_number: str(form, 'check_number'),
      reference_number: str(form, 'reference_number'),
      received_date: str(form, 'received_date') ?? new Date().toISOString().slice(0, 10),
      notes: str(form, 'notes'),
      allow_overpayment: form.get('allow_overpayment') !== null,
    })
    if (!parsed.success) return zodToState(parsed.error)

    const result = await recordManualPayment(supabase, {
      invoiceId: parsed.data.invoice_id,
      amountCents: parsed.data.amount_cents,
      method: parsed.data.method as PaymentMethod,
      checkNumber: parsed.data.check_number ?? null,
      referenceNumber: parsed.data.reference_number ?? null,
      receivedDate: parsed.data.received_date,
      notes: parsed.data.notes ?? null,
      allowOverpayment: parsed.data.allow_overpayment,
      actorUserId: user.id,
    })
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/invoices/${parsed.data.invoice_id}`)
    revalidatePath('/ops/invoices')
    revalidatePath('/ops/dashboard')
    return success('Payment recorded. The invoice balance has been updated.')
  } catch (error) {
    return handleUnexpected('recordPayment', error)
  }
}

export async function voidPaymentAction(paymentId: string, reason: string): Promise<ActionState> {
  try {
    const user = await requireCapability('paymentsRefund')
    const supabase = createSupabaseServerClient()
    if (!reason || reason.trim().length < 3) {
      return failure('Give a reason — voiding a payment changes what the customer owes.')
    }
    const result = await voidPayment(supabase, { paymentId, reason: reason.trim(), actorUserId: user.id })
    if (!result.ok) return failure(result.error!)
    revalidatePath('/ops/invoices')
    return success('Payment voided and the invoice balance recalculated.')
  } catch (error) {
    return handleUnexpected('voidPayment', error)
  }
}

/**
 * Opens a hosted Stripe Checkout session for an invoice.
 *
 * A `pending` payment row is created up front so the attempt is visible in the
 * UI, but it only becomes `succeeded` when a signed webhook says so. Returning
 * from the success URL proves nothing.
 */
export async function createPaymentSessionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('paymentsRecord')
    const supabase = createSupabaseServerClient()
    const settings = await getSettings(supabase)

    if (!settings.online_payments_enabled) {
      return failure('Online payments are switched off in Settings.')
    }

    const invoiceId = str(form, 'invoice_id')
    if (!invoiceId) return failure('Invoice is required.')

    const { data: invoice } = await supabase
      .from('invoices')
      .select('id, invoice_number, project_id, balance_due_cents, status, contacts(email), projects(project_name)')
      .eq('id', invoiceId)
      .maybeSingle()

    if (!invoice) return failure('Invoice not found.')
    if (invoice.status === 'draft') return failure('Send the invoice before taking payment.')
    if (invoice.status === 'void') return failure('This invoice is void.')
    if ((invoice.balance_due_cents as number) <= 0) return failure('This invoice is already paid in full.')

    const contact = Array.isArray(invoice.contacts) ? invoice.contacts[0] : invoice.contacts
    const project = Array.isArray(invoice.projects) ? invoice.projects[0] : invoice.projects

    const methods: ('card' | 'ach')[] = []
    if (settings.allowed_payment_methods.includes('card')) methods.push('card')
    if (settings.allowed_payment_methods.includes('ach')) methods.push('ach')

    const base = await resolveBaseUrl()
    const session = await stripeProvider.createPaymentSession({
      invoiceId,
      invoiceNumber: invoice.invoice_number as string,
      projectName: (project?.project_name as string) ?? 'Project',
      amountCents: invoice.balance_due_cents as number,
      customerEmail: (contact?.email as string | null) ?? null,
      methods,
      successUrl: `${base}/ops/invoices/${invoiceId}?payment=submitted`,
      cancelUrl: `${base}/ops/invoices/${invoiceId}?payment=cancelled`,
    })

    if (!session.ok || !session.url) return failure(session.error ?? 'The payment page could not be opened.')

    await supabase.from('payments').insert({
      invoice_id: invoiceId,
      project_id: invoice.project_id,
      amount_cents: invoice.balance_due_cents,
      method: methods.includes('card') ? 'card' : 'ach',
      status: 'pending',                       // never 'succeeded' from here
      provider: 'stripe',
      provider_session_id: session.sessionId ?? null,
      recorded_by: user.id,
      notes: 'Awaiting confirmation from Stripe.',
    })

    await logActivity(supabase, {
      action: 'payment.pending',
      entityType: 'invoice',
      entityId: invoiceId,
      actorUserId: user.id,
      metadata: { amount_cents: invoice.balance_due_cents, invoice_number: invoice.invoice_number },
    })

    revalidatePath(`/ops/invoices/${invoiceId}`)
    return success('Payment page ready — send this link to the customer, or open it to pay now.', {
      checkoutUrl: session.url,
    })
  } catch (error) {
    return handleUnexpected('createPaymentSession', error)
  }
}

// ---------------------------------------------------------------------------
// Job costs
// ---------------------------------------------------------------------------

export async function saveJobCost(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('costsEdit')
    const supabase = createSupabaseServerClient()
    const admin = createSupabaseAdminClient()

    const parsed = jobCostSchema.safeParse({
      project_id: str(form, 'project_id') ?? '',
      category: str(form, 'category') ?? 'materials',
      vendor_id: str(form, 'vendor_id') ?? '',
      description: str(form, 'description') ?? '',
      amount_cents: str(form, 'amount') ?? '',
      cost_date: str(form, 'cost_date') ?? new Date().toISOString().slice(0, 10),
      notes: str(form, 'notes'),
    })
    if (!parsed.success) return zodToState(parsed.error)

    // Optional receipt.
    let documentId: string | null = null
    const file = form.get('receipt')
    if (file instanceof File && file.size > 0) {
      const settings = await getSettings(supabase)
      const upload = await uploadDocument(admin, {
        file,
        entityType: 'project',
        entityId: parsed.data.project_id,
        documentType: 'receipt',
        documentDate: parsed.data.cost_date,
        uploadedBy: user.id,
        maxBytes: settings.max_upload_mb * 1024 * 1024,
      })
      if (!upload.ok) return failure(upload.error!)
      documentId = upload.document!.id
    }

    const result = await recordJobCost(
      supabase,
      { ...parsed.data, document_id: documentId },
      user.id,
      str(form, 'cost_id') ?? null,
    )
    if (!result.ok) return failure(result.error!)

    revalidatePath(`/ops/projects/${parsed.data.project_id}`)
    revalidatePath('/ops/dashboard')
    return success('Cost recorded.')
  } catch (error) {
    return handleUnexpected('saveJobCost', error)
  }
}

export async function deleteJobCost(costId: string, projectId: string): Promise<ActionState> {
  try {
    const user = await requireCapability('costsEdit')
    const supabase = createSupabaseServerClient()

    const { error } = await supabase.from('job_costs').delete().eq('id', costId)
    if (error) return failure('The cost could not be removed.')

    await logActivity(supabase, {
      action: 'job_cost.deleted', entityType: 'project', entityId: projectId,
      actorUserId: user.id, metadata: { cost_id: costId },
    })
    revalidatePath(`/ops/projects/${projectId}`)
    return success('Cost removed.')
  } catch (error) {
    return handleUnexpected('deleteJobCost', error)
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseInvoiceItems(form: FormData): Record<string, unknown>[] {
  const indexes = new Set<number>()
  for (const key of Array.from(form.keys())) {
    const match = /^item\[(\d+)]\[/.exec(key)
    if (match) indexes.add(Number(match[1]))
  }

  const items: Record<string, unknown>[] = []
  for (const i of Array.from(indexes).sort((a, b) => a - b)) {
    const get = (field: string) => {
      const value = form.get(`item[${i}][${field}]`)
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    }
    const description = get('description')
    if (!description) continue

    items.push({
      sort_order: items.length,
      description,
      quantity: get('quantity') ?? '1',
      unit: get('unit'),
      unit_price_cents: get('unit_price') ?? '0',
      estimate_line_item_id: get('estimate_line_item_id') ?? '',
    })
  }
  return items
}

async function resolveBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_CRM_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/$/, '')
  const h = headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function isRedirect(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'digest' in error &&
    typeof (error as { digest: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
}
