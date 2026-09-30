/**
 * ============================================================================
 * PROVIDER COST PREVIEW — pure, and honest about the unknown
 * ----------------------------------------------------------------------------
 * Given the shape of a batch, works out how many PAID measurement lookups it
 * would need and what that would cost. The hard rule: when provider pricing is
 * not configured, the dollar cost is UNAVAILABLE — never $0. Showing $0 because
 * a rate is missing would invite someone to run a paid batch thinking it's free.
 * Pricing, when it exists, comes from configuration (MEASUREMENT_UNIT_COST_CENTS)
 * — never invented here.
 * ============================================================================
 */

export interface CostPreviewInput {
  totalProspects: number
  alreadyEnriched: number
  cachedMeasurements: number
  manualMeasurementRecords: number
  /** Prospects that would need a fresh paid measurement lookup. */
  measurementsRequired: number
  /** Cents per paid measurement, from configuration. undefined/null = not configured. */
  unitCostCents?: number | null
  /** Caps, if the campaign/batch set them. */
  perBatchCap?: number | null
}

export interface CostPreview {
  totalProspects: number
  alreadyEnriched: number
  cachedMeasurements: number
  manualMeasurementRecords: number
  providerCallsRequired: number
  cappedProviderCalls: number
  pricingConfigured: boolean
  estimatedCostCents: number | null
  /** Human-readable, safe to show verbatim. Never implies free when it is not. */
  message: string
  /** Whether a paid run is even possible right now. */
  paidEnrichmentBlocked: boolean
  blockedReason?: string
}

export function computeCostPreview(input: CostPreviewInput, providerReady: boolean): CostPreview {
  const providerCallsRequired = Math.max(0, input.measurementsRequired)
  const cappedProviderCalls = input.perBatchCap != null
    ? Math.min(providerCallsRequired, input.perBatchCap)
    : providerCallsRequired

  const pricingConfigured = input.unitCostCents != null && Number.isFinite(input.unitCostCents) && input.unitCostCents >= 0
  const estimatedCostCents = pricingConfigured ? cappedProviderCalls * (input.unitCostCents as number) : null

  let paidEnrichmentBlocked = false
  let blockedReason: string | undefined
  if (!providerReady) {
    paidEnrichmentBlocked = true
    blockedReason = 'No measurement provider is configured.'
  } else if (!pricingConfigured) {
    paidEnrichmentBlocked = true
    blockedReason = 'Provider pricing has not been configured.'
  }

  let message: string
  if (providerCallsRequired === 0) {
    message = 'No paid measurement lookups are required for this batch.'
  } else if (!pricingConfigured) {
    message =
      `${providerCallsRequired.toLocaleString()} properties require a paid measurement lookup. ` +
      'Provider pricing has not been configured. Estimated dollar cost unavailable. ' +
      'Paid enrichment cannot begin until pricing/authorization is configured.'
  } else {
    const dollars = ((estimatedCostCents as number) / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
    message =
      `${cappedProviderCalls.toLocaleString()} paid measurement lookups` +
      (cappedProviderCalls !== providerCallsRequired ? ` (capped from ${providerCallsRequired.toLocaleString()})` : '') +
      ` · estimated ${dollars}.`
  }

  return {
    totalProspects: input.totalProspects,
    alreadyEnriched: input.alreadyEnriched,
    cachedMeasurements: input.cachedMeasurements,
    manualMeasurementRecords: input.manualMeasurementRecords,
    providerCallsRequired,
    cappedProviderCalls,
    pricingConfigured,
    estimatedCostCents,
    message,
    paidEnrichmentBlocked,
    blockedReason,
  }
}

/** Reads the configured per-measurement unit cost, or null if unset. Never a default. */
export function configuredUnitCostCents(): number | null {
  const raw = process.env.MEASUREMENT_UNIT_COST_CENTS
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}
