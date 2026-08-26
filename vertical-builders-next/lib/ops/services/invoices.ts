import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateTotals, lineTotalCents, validatePaymentAmount } from '../finance/calc'
import type { Invoice, PaymentMethod } from '../types'
import { logActivity } from './activity'
import { getSettings } from './settings'

/**
 * Invoicing and payment recording.
 *
 * The invoice's `amount_paid_cents` / `balance_due_cents` / `status` are never
 * written directly by this file. The database trigger installed in migration
 * 0005 recalculates them from the payments table whenever a payment row
 * changes, so a refund or a voided payment can never leave a stale balance.
 */

export interface SaveInvoiceResult {
  ok: boolean
  invoiceId?: string
  error?: string
}

export interface InvoiceItemInput {
  id?: string
  sort_order: number
  description: string
  quantity: number
  unit?: string | null
  unit_price_cents: number
  estimate_line_item_id?: string | null
}

export async function saveInvoice(
  supabase: SupabaseClient,
  input: {
    project_id: string
    contact_id?: string | null
    estimate_id?: string | null
    invoice_type: string
    issue_date: string
    due_date?: string | null
    discount_cents?: number
    tax_percent: number
    notes?: string | null
    customer_message?: string | null
    items: InvoiceItemInput[]
  },
  actorUserId: string,
  invoiceId?: string | null,
): Promise<SaveInvoiceResult> {
  const settings = await getSettings(supabase)

  const totals = calculateTotals({
    lines: input.items.map(i => ({ quantity: i.quantity, unitPriceCents: i.unit_price_cents })),
    discountCents: input.discount_cents ?? 0,
    taxPercent: input.tax_percent,
    taxEnabled: settings.estimate_tax_enabled,
  })

  const dueDate = input.due_date
    ?? new Date(Date.now() + settings.invoice_due_days * 86_400_000).toISOString().slice(0, 10)

  const header = {
    project_id: input.project_id,
    contact_id: input.contact_id ?? null,
    estimate_id: input.estimate_id ?? null,
    invoice_type: input.invoice_type,
    issue_date: input.issue_date,
    due_date: dueDate,
    subtotal_cents: totals.subtotalCents,
    discount_cents: totals.discountCents,
    tax_percent: settings.estimate_tax_enabled ? input.tax_percent : 0,
    tax_cents: totals.taxCents,
    total_cents: totals.totalCents,
    notes: input.notes ?? null,
    customer_message: input.customer_message ?? null,
  }

  let id = invoiceId ?? null

  if (id) {
    // Changing the amount of an invoice a customer has already paid against
    // would silently rewrite what they owe. Draft only.
    const { data: existing } = await supabase
      .from('invoices').select('status, amount_paid_cents').eq('id', id).maybeSingle()
    if (existing && existing.status !== 'draft') {
      return {
        ok: false,
        error: 'This invoice has already been sent. Void it and raise a new one rather than changing the amount.',
      }
    }

    // balance_due_cents is also enforced by a database trigger (migration 0008);
    // setting it here too keeps the value correct in the returned row without a
    // refetch, and keeps the intent visible at the call site.
    const { error } = await supabase
      .from('invoices')
      .update({
        ...header,
        balance_due_cents: totals.totalCents - ((existing?.amount_paid_cents as number | undefined) ?? 0),
      })
      .eq('id', id)
    if (error) {
      console.error('[invoices] update failed', error)
      return { ok: false, error: 'The invoice could not be saved.' }
    }
  } else {
    const { data, error } = await supabase
      .from('invoices')
      .insert({ ...header, created_by: actorUserId, balance_due_cents: totals.totalCents })
      .select('id, invoice_number')
      .single()
    if (error || !data) {
      console.error('[invoices] insert failed', error)
      return { ok: false, error: 'The invoice could not be created.' }
    }
    id = data.id as string
    await logActivity(supabase, {
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: id,
      actorUserId,
      metadata: {
        invoice_number: data.invoice_number,
        project_id: input.project_id,
        total_cents: totals.totalCents,
      },
    })
  }

  await supabase.from('invoice_items').delete().eq('invoice_id', id)
  const rows = input.items.map((item, index) => ({
    invoice_id: id,
    sort_order: item.sort_order ?? index,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit ?? null,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: lineTotalCents({ quantity: item.quantity, unitPriceCents: item.unit_price_cents }),
    estimate_line_item_id: item.estimate_line_item_id ?? null,
  }))
  const { error: itemsError } = await supabase.from('invoice_items').insert(rows)
  if (itemsError) {
    console.error('[invoices] items insert failed', itemsError)
    return { ok: false, invoiceId: id, error: 'The invoice saved but its lines did not. Re-open and check it.' }
  }

  // Keeps the derived columns correct after a draft edit.
  await supabase.rpc('recalculate_invoice_totals', { p_invoice_id: id })

  return { ok: true, invoiceId: id }
}

/**
 * Builds an invoice from an approved estimate. Line items carry a pointer back
 * to the estimate line they came from, so "what did we quote for this?" stays
 * answerable after the fact.
 */
export async function createInvoiceFromEstimate(
  supabase: SupabaseClient,
  params: {
    estimateId: string
    projectId: string
    actorUserId: string
    invoiceType?: 'standard' | 'deposit' | 'progress' | 'final'
    /** For a deposit invoice: percentage of the estimate total, 1-100. */
    depositPercent?: number
  },
): Promise<SaveInvoiceResult> {
  const { data: estimate } = await supabase
    .from('estimates')
    .select('*, estimate_line_items(*)')
    .eq('id', params.estimateId)
    .maybeSingle()

  if (!estimate) return { ok: false, error: 'Estimate not found.' }

  const settings = await getSettings(supabase)
  const type = params.invoiceType ?? 'standard'
  const lines = (estimate.estimate_line_items ?? []) as {
    id: string; description: string; quantity: number; unit: string;
    unit_price_cents: number; sort_order: number
  }[]

  let items: InvoiceItemInput[]

  if (type === 'deposit') {
    const percent = Math.min(100, Math.max(1, params.depositPercent ?? 50))
    // A deposit is one line for a share of the job, not a copy of every line —
    // itemising a partial payment invites arguments about which line is paid.
    items = [{
      sort_order: 0,
      description: `${percent}% deposit — ${estimate.title}`,
      quantity: 1,
      unit: 'LS',
      unit_price_cents: Math.round((estimate.total_cents as number) * (percent / 100)),
    }]
  } else {
    items = lines
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line, index) => ({
        sort_order: index,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price_cents: line.unit_price_cents,
        estimate_line_item_id: line.id,
      }))
    if (items.length === 0) {
      return { ok: false, error: 'That estimate has no line items to invoice.' }
    }
  }

  return saveInvoice(
    supabase,
    {
      project_id: params.projectId,
      contact_id: estimate.contact_id as string | null,
      estimate_id: params.estimateId,
      invoice_type: type,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + settings.invoice_due_days * 86_400_000).toISOString().slice(0, 10),
      // The deposit line is already the discounted share; applying the
      // estimate's discount again would double-count it.
      discount_cents: type === 'deposit' ? 0 : (estimate.discount_cents as number),
      tax_percent: estimate.tax_percent as number,
      customer_message: estimate.customer_notes as string | null,
      items,
    },
    params.actorUserId,
  )
}

export async function sendInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  actorUserId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: invoice } = await supabase
    .from('invoices').select('id, status, invoice_number, total_cents').eq('id', invoiceId).maybeSingle()

  if (!invoice) return { ok: false, error: 'Invoice not found.' }
  if (invoice.status !== 'draft') return { ok: false, error: 'This invoice has already been sent.' }
  if ((invoice.total_cents as number) <= 0) {
    return { ok: false, error: 'An invoice needs a total greater than zero before it can be sent.' }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) return { ok: false, error: 'The invoice could not be marked as sent.' }

  await supabase.rpc('recalculate_invoice_totals', { p_invoice_id: invoiceId })
  await logActivity(supabase, {
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: invoiceId,
    actorUserId,
    metadata: { invoice_number: invoice.invoice_number },
  })
  return { ok: true }
}

export async function voidInvoice(
  supabase: SupabaseClient,
  params: { invoiceId: string; reason: string; actorUserId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data: invoice } = await supabase
    .from('invoices').select('id, status, invoice_number, amount_paid_cents').eq('id', params.invoiceId).maybeSingle()

  if (!invoice) return { ok: false, error: 'Invoice not found.' }
  if (invoice.status === 'void') return { ok: true }

  // Voiding an invoice with money against it would orphan the payment.
  if ((invoice.amount_paid_cents as number) > 0) {
    return {
      ok: false,
      error: 'This invoice has payments recorded against it. Refund or void those payments first, then void the invoice.',
    }
  }

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: params.reason })
    .eq('id', params.invoiceId)
  if (error) return { ok: false, error: 'The invoice could not be voided.' }

  await logActivity(supabase, {
    action: 'invoice.voided',
    entityType: 'invoice',
    entityId: params.invoiceId,
    actorUserId: params.actorUserId,
    metadata: { invoice_number: invoice.invoice_number, reason: params.reason },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export async function recordManualPayment(
  supabase: SupabaseClient,
  params: {
    invoiceId: string
    amountCents: number
    method: PaymentMethod
    checkNumber?: string | null
    referenceNumber?: string | null
    receivedDate: string
    notes?: string | null
    allowOverpayment: boolean
    actorUserId: string
  },
): Promise<{ ok: boolean; error?: string; paymentId?: string }> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, project_id, invoice_number, status, balance_due_cents')
    .eq('id', params.invoiceId)
    .maybeSingle<Invoice>()

  if (!invoice) return { ok: false, error: 'Invoice not found.' }
  if (invoice.status === 'void') {
    return { ok: false, error: 'This invoice is void. Payments cannot be recorded against it.' }
  }
  if (invoice.status === 'draft') {
    return { ok: false, error: 'Send the invoice before recording a payment against it.' }
  }

  const check = validatePaymentAmount(params.amountCents, invoice.balance_due_cents, params.allowOverpayment)
  if (!check.ok) return { ok: false, error: check.error }

  const { data, error } = await supabase
    .from('payments')
    .insert({
      invoice_id: params.invoiceId,
      project_id: invoice.project_id,
      amount_cents: params.amountCents,
      method: params.method,
      status: 'succeeded',   // a check in hand is money received
      provider: 'manual',
      check_number: params.checkNumber ?? null,
      reference_number: params.referenceNumber ?? null,
      received_date: params.receivedDate,
      recorded_by: params.actorUserId,
      notes: params.notes ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[payments] manual record failed', error)
    return { ok: false, error: 'The payment could not be recorded.' }
  }

  await logActivity(supabase, {
    action: 'payment.manual_recorded',
    entityType: 'invoice',
    entityId: params.invoiceId,
    actorUserId: params.actorUserId,
    metadata: {
      payment_id: data.id,
      amount_cents: params.amountCents,
      method: params.method,
      invoice_number: invoice.invoice_number,
      overpaid_by: check.wouldOverpayBy ?? 0,
    },
  })

  return { ok: true, paymentId: data.id as string }
}

export async function voidPayment(
  supabase: SupabaseClient,
  params: { paymentId: string; reason: string; actorUserId: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data: payment } = await supabase
    .from('payments').select('id, invoice_id, amount_cents, provider, status').eq('id', params.paymentId).maybeSingle()

  if (!payment) return { ok: false, error: 'Payment not found.' }
  if (payment.provider === 'stripe') {
    return {
      ok: false,
      error: 'This payment came through Stripe. Refund it in the Stripe dashboard — the refund webhook will update Vertical Ops automatically.',
    }
  }

  // The trigger recalculates the invoice from this status change.
  const { error } = await supabase
    .from('payments')
    .update({ status: 'void', notes: params.reason })
    .eq('id', params.paymentId)
  if (error) return { ok: false, error: 'The payment could not be voided.' }

  await logActivity(supabase, {
    action: 'payment.refunded',
    entityType: 'invoice',
    entityId: payment.invoice_id as string,
    actorUserId: params.actorUserId,
    metadata: { payment_id: params.paymentId, amount_cents: payment.amount_cents, reason: params.reason },
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Job costs
// ---------------------------------------------------------------------------

export async function recordJobCost(
  supabase: SupabaseClient,
  input: {
    project_id: string
    category: string
    vendor_id?: string | null
    description: string
    amount_cents: number
    cost_date: string
    document_id?: string | null
    notes?: string | null
  },
  actorUserId: string,
  costId?: string | null,
): Promise<{ ok: boolean; costId?: string; error?: string }> {
  const row = {
    project_id: input.project_id,
    category: input.category,
    vendor_id: input.vendor_id ?? null,
    description: input.description,
    amount_cents: input.amount_cents,
    cost_date: input.cost_date,
    document_id: input.document_id ?? null,
    notes: input.notes ?? null,
  }

  if (costId) {
    const { error } = await supabase.from('job_costs').update(row).eq('id', costId)
    if (error) return { ok: false, error: 'The cost could not be saved.' }
    await logActivity(supabase, {
      action: 'job_cost.updated', entityType: 'project', entityId: input.project_id,
      actorUserId, metadata: { cost_id: costId, amount_cents: input.amount_cents, category: input.category },
    })
    return { ok: true, costId }
  }

  const { data, error } = await supabase
    .from('job_costs').insert({ ...row, entered_by: actorUserId }).select('id').single()
  if (error || !data) {
    console.error('[costs] insert failed', error)
    return { ok: false, error: 'The cost could not be recorded.' }
  }

  await logActivity(supabase, {
    action: 'job_cost.created', entityType: 'project', entityId: input.project_id,
    actorUserId, metadata: { cost_id: data.id, amount_cents: input.amount_cents, category: input.category },
  })
  return { ok: true, costId: data.id as string }
}

// ---------------------------------------------------------------------------
// Project financial roll-up
// ---------------------------------------------------------------------------

export interface ProjectFinancials {
  contractAmountCents: number | null
  estimateAmountCents: number | null
  invoices: Invoice[]
  invoicedCents: number
  paidCents: number
  outstandingCents: number
  costs: { id: string; category: string; description: string; amount_cents: number; cost_date: string; vendor_id: string | null; document_id: string | null }[]
  totalCostCents: number
}

export async function loadProjectFinancials(
  supabase: SupabaseClient,
  projectId: string,
  opts: { includeCosts?: boolean } = {},
): Promise<ProjectFinancials> {
  const [{ data: project }, { data: invoices }, { data: costs }] = await Promise.all([
    supabase.from('projects').select('contract_amount_cents, estimate_amount_cents').eq('id', projectId).maybeSingle(),
    supabase.from('invoices').select('*').eq('project_id', projectId).order('issue_date', { ascending: false }),
    opts.includeCosts === false
      ? Promise.resolve({ data: [] })
      : supabase.from('job_costs')
          .select('id, category, description, amount_cents, cost_date, vendor_id, document_id')
          .eq('project_id', projectId).order('cost_date', { ascending: false }),
  ])

  const invoiceRows = (invoices ?? []) as Invoice[]
  // A voided invoice is not money owed and must not inflate "invoiced".
  const live = invoiceRows.filter(i => i.status !== 'void' && i.status !== 'draft')

  const invoicedCents = live.reduce((sum, i) => sum + i.total_cents, 0)
  const paidCents = live.reduce((sum, i) => sum + i.amount_paid_cents, 0)
  const costRows = (costs ?? []) as ProjectFinancials['costs']

  return {
    contractAmountCents: (project?.contract_amount_cents as number | null) ?? null,
    estimateAmountCents: (project?.estimate_amount_cents as number | null) ?? null,
    invoices: invoiceRows,
    invoicedCents,
    paidCents,
    outstandingCents: invoicedCents - paidCents,
    costs: costRows,
    totalCostCents: costRows.reduce((sum, c) => sum + c.amount_cents, 0),
  }
}
