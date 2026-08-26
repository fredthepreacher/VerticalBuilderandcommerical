import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppSettings } from '../types'

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'default',
  warning_window_days: 30,
  reminder_thresholds: [60, 30, 7, 0],
  company_name: 'Vertical Builders & Commercial',
  company_email: 'Office@verticalbc.com',
  company_phone: '941-877-2009',
  max_upload_mb: 10,
  upload_token_ttl_days: 14,
  estimate_number_prefix: 'EST',
  estimate_valid_days: 30,
  estimate_default_notes: null,
  estimate_tax_enabled: false,
  estimate_default_tax_percent: 0,
  invoice_number_prefix: 'INV',
  invoice_due_days: 14,
  roof_measurement_provider: 'manual',
  online_payments_enabled: false,
  allowed_payment_methods: ['card', 'ach', 'check'],
  schedule_work_days: [1, 2, 3, 4, 5],
  costs_visible_to_pm: true,
  profit_visible_to_pm: false,
}

/**
 * Settings are a single row. If the row is missing (fresh database, migration
 * not run yet) the app falls back to sane defaults rather than erroring, so the
 * CRM is still usable while someone finishes setting up.
 */
export async function getSettings(supabase: SupabaseClient): Promise<AppSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  if (error || !data) return DEFAULT_SETTINGS
  return {
    ...DEFAULT_SETTINGS,
    ...data,
    reminder_thresholds:
      Array.isArray(data.reminder_thresholds) && data.reminder_thresholds.length
        ? data.reminder_thresholds
        : DEFAULT_SETTINGS.reminder_thresholds,
    allowed_payment_methods:
      Array.isArray(data.allowed_payment_methods) && data.allowed_payment_methods.length
        ? data.allowed_payment_methods
        : DEFAULT_SETTINGS.allowed_payment_methods,
    schedule_work_days:
      Array.isArray(data.schedule_work_days) && data.schedule_work_days.length
        ? data.schedule_work_days
        : DEFAULT_SETTINGS.schedule_work_days,
  } as AppSettings
}
