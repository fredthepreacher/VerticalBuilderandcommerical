'use server'

import { revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { logActivity } from '@/lib/ops/services/activity'
import { refreshAllVendors } from '@/lib/ops/services/compliance'
import { COVERAGE_TYPES, UNITS, type CoverageType } from '@/lib/ops/types'
import { dollarsToCents, parseLimit } from '@/lib/ops/utils/money'
import { failure, handleUnexpected, str, success, type ActionState } from '@/lib/ops/actions-shared'

export async function saveSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()

    const warningWindow = Number(str(form, 'warning_window_days') ?? 30)
    if (!Number.isInteger(warningWindow) || warningWindow < 1 || warningWindow > 365) {
      return failure('The warning window must be a whole number of days between 1 and 365.')
    }

    const thresholds = (str(form, 'reminder_thresholds') ?? '60,30,7,0')
      .split(',')
      .map(v => Number(v.trim()))
      .filter(v => Number.isInteger(v) && v >= 0 && v <= 365)
      .sort((a, b) => b - a)
    if (thresholds.length === 0) {
      return failure('Enter at least one reminder threshold, for example 60,30,7,0.')
    }

    const maxUpload = Number(str(form, 'max_upload_mb') ?? 10)
    const tokenTtl = Number(str(form, 'upload_token_ttl_days') ?? 14)

    const { error } = await supabase.from('app_settings').update({
      warning_window_days: warningWindow,
      reminder_thresholds: thresholds,
      company_name: str(form, 'company_name') ?? 'Vertical Builders & Commercial',
      company_email: str(form, 'company_email') ?? 'Office@verticalbc.com',
      company_phone: str(form, 'company_phone') ?? '941-877-2009',
      max_upload_mb: Number.isInteger(maxUpload) && maxUpload > 0 && maxUpload <= 50 ? maxUpload : 10,
      upload_token_ttl_days: Number.isInteger(tokenTtl) && tokenTtl > 0 && tokenTtl <= 90 ? tokenTtl : 14,
    }).eq('id', 'default')

    if (error) return failure('Settings could not be saved.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { warning_window_days: warningWindow, reminder_thresholds: thresholds },
    })

    // The warning window changes what counts as "expiring soon" everywhere.
    await refreshAllVendors(supabase)

    revalidatePath('/ops/settings')
    revalidatePath('/ops/compliance')
    revalidatePath('/ops/dashboard')
    return success('Settings saved and compliance recalculated.')
  } catch (error) {
    return handleUnexpected('saveSettings', error)
  }
}

/**
 * Saves a whole requirement template in one submit: one row per coverage type,
 * each either required or not.
 */
export async function saveRequirementTemplate(
  templateId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('manageRequirements')
    const supabase = createSupabaseServerClient()

    const name = str(form, 'name')
    if (!name) return failure('Give the template a name.')

    await supabase.from('insurance_requirement_templates')
      .update({ name, disclaimer: str(form, 'disclaimer') ?? null })
      .eq('id', templateId)

    for (const coverage of COVERAGE_TYPES) {
      const required = form.get(`req[${coverage}][required]`) === 'on'
      const row = {
        template_id: templateId,
        coverage_type: coverage as CoverageType,
        required,
        min_limit_each_occurrence: parseLimit(str(form, `req[${coverage}][each_occurrence]`)),
        min_limit_aggregate: parseLimit(str(form, `req[${coverage}][aggregate]`)),
        min_combined_single_limit: parseLimit(str(form, `req[${coverage}][csl]`)),
        min_workers_comp_el: parseLimit(str(form, `req[${coverage}][el]`)),
        additional_insured_required: form.get(`req[${coverage}][ai]`) === 'on',
        waiver_of_subrogation_required: form.get(`req[${coverage}][wos]`) === 'on',
        primary_noncontributory_required: form.get(`req[${coverage}][pnc]`) === 'on',
        endorsement_required: form.get(`req[${coverage}][endorsement]`) === 'on',
        notes: str(form, `req[${coverage}][notes]`) ?? null,
      }

      const { error } = await supabase
        .from('insurance_requirements')
        .upsert(row, { onConflict: 'template_id,coverage_type' })
      if (error) {
        console.error('[settings] requirement upsert failed', coverage, error)
        return failure(`The ${coverage.replace(/_/g, ' ')} rule could not be saved.`)
      }
    }

    await logActivity(supabase, {
      action: 'requirements.updated', entityType: 'requirement_template', entityId: templateId,
      actorUserId: user.id, metadata: { name },
    })

    await refreshAllVendors(supabase)

    revalidatePath('/ops/settings')
    revalidatePath('/ops/compliance')
    return success('Requirements saved. Every subcontractor has been re-evaluated against them.')
  } catch (error) {
    return handleUnexpected('saveRequirementTemplate', error)
  }
}

export async function setUserRole(profileId: string, role: string): Promise<ActionState> {
  try {
    const user = await requireCapability('manageUsers')
    if (profileId === user.id) return failure('You cannot change your own role.')

    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('profiles').update({ role }).eq('id', profileId)
    if (error) return failure('The role could not be changed.')

    await logActivity(supabase, {
      action: 'record.updated', entityType: 'profile', entityId: profileId,
      actorUserId: user.id, metadata: { role },
    })
    revalidatePath('/ops/settings')
    return success('Role updated.')
  } catch (error) {
    return handleUnexpected('setUserRole', error)
  }
}

export async function setUserActive(profileId: string, active: boolean): Promise<ActionState> {
  try {
    const user = await requireCapability('manageUsers')
    if (profileId === user.id) return failure('You cannot deactivate your own account.')

    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('profiles').update({ active }).eq('id', profileId)
    if (error) return failure('The account could not be updated.')

    await logActivity(supabase, {
      action: 'record.updated', entityType: 'profile', entityId: profileId,
      actorUserId: user.id, metadata: { active },
    })
    revalidatePath('/ops/settings')
    return success(active ? 'Account reactivated.' : 'Account deactivated.')
  } catch (error) {
    return handleUnexpected('setUserActive', error)
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — operations, financial and estimating settings
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ['card', 'ach', 'check', 'cash', 'other'] as const
const MEASUREMENT_PROVIDERS = ['manual', 'eagleview', 'nearmap'] as const

function intInRange(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

/**
 * Estimating and invoicing defaults.
 *
 * Numbering prefixes only affect documents created from now on — existing
 * estimate and invoice numbers are never rewritten, because a number that has
 * already been sent to a customer is a reference they hold.
 */
export async function saveEstimatingSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()

    const taxPercentRaw = Number(str(form, 'estimate_default_tax_percent') ?? 0)
    if (!Number.isFinite(taxPercentRaw) || taxPercentRaw < 0 || taxPercentRaw > 25) {
      return failure('The default tax rate must be between 0 and 25 percent.')
    }

    const prefix = (str(form, 'estimate_number_prefix') ?? 'EST').toUpperCase()
    const invoicePrefix = (str(form, 'invoice_number_prefix') ?? 'INV').toUpperCase()
    if (!/^[A-Z]{2,6}$/.test(prefix) || !/^[A-Z]{2,6}$/.test(invoicePrefix)) {
      return failure('Number prefixes must be 2–6 letters, for example EST and INV.')
    }

    const { error } = await supabase.from('app_settings').update({
      estimate_number_prefix: prefix,
      estimate_valid_days: intInRange(str(form, 'estimate_valid_days'), 30, 1, 365),
      estimate_default_notes: str(form, 'estimate_default_notes') ?? null,
      estimate_tax_enabled: form.get('estimate_tax_enabled') === 'on',
      estimate_default_tax_percent: Math.round(taxPercentRaw * 1000) / 1000,
      invoice_number_prefix: invoicePrefix,
      invoice_due_days: intInRange(str(form, 'invoice_due_days'), 14, 0, 180),
    }).eq('id', 'default')

    if (error) {
      console.error('[settings] estimating save failed', error)
      return failure('Those settings could not be saved.')
    }

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'estimating' },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/estimates')
    return success('Estimating and invoicing defaults saved.')
  } catch (error) {
    return handleUnexpected('saveEstimatingSettings', error)
  }
}

/**
 * Which roof measurement source the Order button uses.
 *
 * The API keys themselves live in environment variables, never in this table
 * and never in the browser — this only records which of the configured
 * providers to call.
 */
export async function saveMeasurementSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()

    const provider = str(form, 'roof_measurement_provider') ?? 'manual'
    if (!(MEASUREMENT_PROVIDERS as readonly string[]).includes(provider)) {
      return failure('Choose one of the supported measurement providers.')
    }

    const { error } = await supabase.from('app_settings')
      .update({ roof_measurement_provider: provider }).eq('id', 'default')
    if (error) return failure('The measurement provider could not be saved.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'measurements', provider },
    })
    revalidatePath('/ops/settings')
    return success('Measurement provider saved.')
  } catch (error) {
    return handleUnexpected('saveMeasurementSettings', error)
  }
}

/**
 * Payment acceptance. Turning online payments on does not by itself make them
 * work — the Stripe keys must also be present in the environment, which the
 * settings screen reports separately so nobody switches this on and wonders why
 * the Pay button is missing.
 */
export async function savePaymentSettings(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()

    const methods = PAYMENT_METHODS.filter(m => form.get(`method_${m}`) === 'on')
    if (methods.length === 0) {
      return failure('Leave at least one payment method enabled — check is always an option.')
    }

    const online = form.get('online_payments_enabled') === 'on'
    if (online && !methods.includes('card') && !methods.includes('ach')) {
      return failure('Online payments need card or ACH enabled.')
    }

    const { error } = await supabase.from('app_settings').update({
      online_payments_enabled: online,
      allowed_payment_methods: methods,
    }).eq('id', 'default')
    if (error) return failure('Payment settings could not be saved.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'payments', online, methods },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/invoices')
    return success('Payment settings saved.')
  } catch (error) {
    return handleUnexpected('savePaymentSettings', error)
  }
}

/**
 * Who is allowed to see money.
 *
 * Owner/admin and office always see costs and profit; these two switches only
 * decide what a project manager sees. Field and auditor roles never see either.
 */
export async function saveFinancialPermissions(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const user = await requireCapability('manageSettings')
    const supabase = createSupabaseServerClient()

    const days = [0, 1, 2, 3, 4, 5, 6].filter(d => form.get(`workday_${d}`) === 'on')

    const { error } = await supabase.from('app_settings').update({
      costs_visible_to_pm: form.get('costs_visible_to_pm') === 'on',
      profit_visible_to_pm: form.get('profit_visible_to_pm') === 'on',
      schedule_work_days: days.length ? days : [1, 2, 3, 4, 5],
    }).eq('id', 'default')
    if (error) return failure('Those settings could not be saved.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'financial_permissions' },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/projects')
    revalidatePath('/ops/schedule')
    return success('Visibility settings saved.')
  } catch (error) {
    return handleUnexpected('saveFinancialPermissions', error)
  }
}

// ---------------------------------------------------------------------------
// Pricebook
// ---------------------------------------------------------------------------

export async function savePricebookItem(
  itemId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const supabase = createSupabaseServerClient()

    const name = str(form, 'name')
    if (!name) return failure('Give the item a name.')

    const unit = str(form, 'unit') ?? 'EA'
    if (!(UNITS as readonly string[]).includes(unit)) return failure('Choose a unit.')

    const price = dollarsToCents(str(form, 'default_unit_price'))
    if (price === null || price < 0) return failure('Enter a unit price — use 0 if it is always quoted per job.')

    const material = dollarsToCents(str(form, 'default_material_cost'))
    const labor = dollarsToCents(str(form, 'default_labor_cost'))
    if ((material !== null && material < 0) || (labor !== null && labor < 0)) {
      return failure('Costs cannot be negative.')
    }

    // The starter pricebook ships every item at $0 tagged needs-price. Once a
    // real price is entered the tag comes off, so the "unpriced" count on the
    // settings screen actually means something.
    const existingTags = (str(form, 'tags') ?? '')
      .split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    const tags = price > 0
      ? existingTags.filter(t => t !== 'needs-price')
      : Array.from(new Set([...existingTags, 'needs-price']))

    const row = {
      name,
      category: str(form, 'category') ?? null,
      service_type: str(form, 'service_type') ?? null,
      description: str(form, 'description') ?? null,
      unit,
      default_unit_price_cents: price,
      default_material_cost_cents: material,
      default_labor_cost_cents: labor,
      active: form.get('active') !== 'off',
      tags,
    }

    const { error } = itemId
      ? await supabase.from('pricebook_items').update(row).eq('id', itemId)
      : await supabase.from('pricebook_items').insert(row)

    if (error) {
      console.error('[settings] pricebook save failed', error)
      return failure('The item could not be saved.')
    }

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'pricebook', item: name },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/estimates')
    return success(itemId ? 'Item updated.' : 'Item added.')
  } catch (error) {
    return handleUnexpected('savePricebookItem', error)
  }
}

/**
 * Retire rather than delete. Estimate lines copy the price at the time they are
 * written, but they keep a reference to the item, and deleting the row would
 * break the trail from a quoted line back to the catalogue entry it came from.
 */
export async function setPricebookItemActive(itemId: string, active: boolean): Promise<ActionState> {
  try {
    const user = await requireCapability('pricebookManage')
    const supabase = createSupabaseServerClient()
    const { error } = await supabase.from('pricebook_items').update({ active }).eq('id', itemId)
    if (error) return failure('The item could not be updated.')

    await logActivity(supabase, {
      action: 'settings.updated', entityType: 'settings', actorUserId: user.id,
      metadata: { section: 'pricebook', item_id: itemId, active },
    })
    revalidatePath('/ops/settings')
    revalidatePath('/ops/estimates')
    return success(active ? 'Item restored.' : 'Item retired.')
  } catch (error) {
    return handleUnexpected('setPricebookItemActive', error)
  }
}
