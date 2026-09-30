import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeProviderConfig } from '../measurements/provider'
import { describeGeocoderConfig } from '../measurements/geocoder'
import type { MeasurementType } from './confidence'

/**
 * ============================================================================
 * MEASUREMENT ASSESSMENT + PROVIDER STATES
 * ----------------------------------------------------------------------------
 * Classifies HOW trustworthy an existing roof_measurements row is, and reports
 * which providers are configured — for the UI and the cost preview. No network
 * calls: measurement DATA is only ever read from what a provider previously
 * returned (or a person entered), never fetched here.
 * ============================================================================
 */

export interface MeasurementRow {
  provider: string | null
  roof_area_squares: number | null
  roof_area_sqft: number | null
  building_footprint_sqft?: number | null
  completed_at?: string | null
  captured_at?: string | null
}

/** Map a stored measurement to its trust type — never promotes footprint to surface. */
export function assessMeasurementType(row: MeasurementRow | null | undefined): MeasurementType {
  if (!row) return null
  const hasSurface = row.roof_area_squares != null || row.roof_area_sqft != null
  const provider = (row.provider ?? '').toLowerCase()

  if (provider === 'manual' || provider === 'uploaded_report') return hasSurface ? 'manual' : null
  if (hasSurface) {
    if (provider === 'eagleview') return 'verified_roof_surface'
    if (provider === 'nearmap') return 'provider_estimate'
    return 'provider_estimate'
  }
  if (row.building_footprint_sqft != null) return 'building_footprint'
  return null
}

export interface EnrichmentProviderStates {
  measurement: {
    selected: string
    displayName: string
    configured: boolean
    action: string
    availableProviders: { name: string; displayName: string; configured: boolean }[]
  }
  geocoder: { selected: string; displayName: string; configured: boolean; action: string }
  /** True only if at least one PAID measurement provider is ready — gates paid enrichment. */
  paidMeasurementReady: boolean
}

/** Drives the enrichment panel's provider badges. Never reveals a secret value. */
export function describeEnrichmentProviders(measurementProvider?: string | null, geocoder?: string | null): EnrichmentProviderStates {
  const m = describeProviderConfig(measurementProvider)
  const g = describeGeocoderConfig(geocoder)
  const paidMeasurementReady = m.availableProviders.some(
    p => (p.name === 'eagleview' || p.name === 'nearmap') && p.configured,
  )
  return { measurement: m, geocoder: g, paidMeasurementReady }
}

/** Look up a cached provider result. Reads only — never triggers a lookup. */
export async function getCachedLookup(
  supabase: SupabaseClient,
  provider: string, lookupType: string, lookupKey: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('provider_lookup_cache')
    .select('result, expires_at')
    .eq('provider', provider).eq('lookup_type', lookupType).eq('lookup_key', lookupKey)
    .maybeSingle()
  if (!data) return null
  if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) return null
  return (data.result as Record<string, unknown>) ?? null
}
