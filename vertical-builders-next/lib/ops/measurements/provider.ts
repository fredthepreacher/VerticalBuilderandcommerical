import 'server-only'
import type { MeasurementProviderName } from '../types'

/**
 * ============================================================================
 * ROOF MEASUREMENT PROVIDERS
 * ----------------------------------------------------------------------------
 * The client asked for "remote roof measurements from aerial or satellite
 * imagery". That is a real service sold by EagleView and Nearmap: an operator
 * or a trained model traces the roof from licensed stereo imagery and returns
 * geometry with a stated accuracy.
 *
 * What it is NOT, and what this module will not pretend it is:
 *   - scraping Google Earth
 *   - looking at a satellite JPEG and guessing an area
 *
 * A wrong roof area is not a cosmetic bug. It is 30 squares of shingle ordered
 * for a 24-square roof, or a bid that loses money. So the only numbers that
 * ever land in `roof_measurements` come from one of four honest sources:
 *
 *   1. a real provider API (adapter below, credentials required)
 *   2. a third-party report the office uploads (EagleView PDF, adjuster report)
 *   3. manual entry by someone who measured it
 *   4. nothing — and the estimate says so
 *
 * Source 4 is a supported outcome, not a failure state. An estimate built
 * without a measurement is clearly marked as such and is still perfectly
 * usable; it just carries a warning onto the AI draft and the PDF.
 * ============================================================================
 */

export interface MeasurementRequestInput {
  address: string
  latitude?: number | null
  longitude?: number | null
  reference?: string
}

export interface MeasurementRequestResult {
  externalRequestId: string
  status: 'requested' | 'processing' | 'complete'
  estimatedReadyAt?: string | null
}

export interface RoofMeasurementResult {
  roofAreaSqft?: number | null
  roofAreaSquares?: number | null
  primaryPitch?: string | null
  facetCount?: number | null
  ridgeLf?: number | null
  hipLf?: number | null
  valleyLf?: number | null
  eaveLf?: number | null
  rakeLf?: number | null
  wasteFactorPercent?: number | null
  externalReportId?: string | null
  reportUrl?: string | null
  capturedAt?: string | null
  raw?: Record<string, unknown>
}

export interface ProviderStatus {
  status: 'requested' | 'processing' | 'complete' | 'failed' | 'cancelled'
  message?: string
}

export interface RoofMeasurementProvider {
  readonly name: MeasurementProviderName
  readonly displayName: string
  isConfigured(): boolean
  createMeasurementRequest(input: MeasurementRequestInput): Promise<MeasurementRequestResult>
  getMeasurementStatus(externalId: string): Promise<ProviderStatus>
  getMeasurementResult(externalId: string): Promise<RoofMeasurementResult>
}

export class ProviderNotConfiguredError extends Error {
  readonly provider: string
  constructor(provider: string, detail: string) {
    super(detail)
    this.name = 'ProviderNotConfiguredError'
    this.provider = provider
  }
}

// ---------------------------------------------------------------------------
// Manual — always available, always the fallback
// ---------------------------------------------------------------------------

/**
 * Not really a provider: it exists so the rest of the app has one code path.
 * Ordering a "manual measurement" just creates the record for someone to fill in.
 */
export const manualProvider: RoofMeasurementProvider = {
  name: 'manual',
  displayName: 'Manual entry',
  isConfigured: () => true,
  async createMeasurementRequest() {
    return { externalRequestId: '', status: 'complete' as const }
  },
  async getMeasurementStatus() {
    return { status: 'complete' as const }
  },
  async getMeasurementResult() {
    return {}
  },
}

// ---------------------------------------------------------------------------
// EagleView
// ---------------------------------------------------------------------------

/**
 * EagleView adapter.
 *
 * EagleView's Measurement Orders API is OAuth2 client-credentials, and the
 * exact endpoint paths and report field names depend on the product tier in the
 * customer's contract. The request/response mapping below reflects the public
 * shape of the v3 Measurement Orders API, but it has NOT been exercised against
 * a live account — Vertical Builders has not supplied credentials.
 *
 * When credentials arrive, the work is: confirm the two endpoint paths, confirm
 * the report field names in `mapReport`, and run one live order. Nothing else
 * in the application changes, because everything upstream talks to the
 * RoofMeasurementProvider interface.
 */
class EagleViewProvider implements RoofMeasurementProvider {
  readonly name = 'eagleview' as const
  readonly displayName = 'EagleView'

  private readonly baseUrl = process.env.EAGLEVIEW_API_BASE || 'https://webservices.eagleview.com'

  isConfigured(): boolean {
    return Boolean(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET)
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError(
        'eagleview',
        'EagleView is selected but EAGLEVIEW_CLIENT_ID / EAGLEVIEW_CLIENT_SECRET are not set. Enter the measurement by hand, or upload the report.',
      )
    }
  }

  private async token(): Promise<string> {
    this.assertConfigured()
    const response = await fetch(`${this.baseUrl}/v2/Token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.EAGLEVIEW_CLIENT_ID!,
        client_secret: process.env.EAGLEVIEW_CLIENT_SECRET!,
      }),
    })
    if (!response.ok) {
      throw new Error(`EagleView authentication failed (${response.status}).`)
    }
    const body = (await response.json()) as { access_token?: string }
    if (!body.access_token) throw new Error('EagleView returned no access token.')
    return body.access_token
  }

  async createMeasurementRequest(input: MeasurementRequestInput): Promise<MeasurementRequestResult> {
    const token = await this.token()
    const response = await fetch(`${this.baseUrl}/v3/Order/PlaceOrder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ReportType: Number(process.env.EAGLEVIEW_REPORT_TYPE || 1),
        Address: input.address,
        Latitude: input.latitude ?? undefined,
        Longitude: input.longitude ?? undefined,
        ClaimInfo: input.reference ? { ClaimNumber: input.reference } : undefined,
      }),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`EagleView rejected the order (${response.status}). ${detail.slice(0, 200)}`)
    }
    const body = (await response.json()) as { ReportId?: number | string }
    if (!body.ReportId) throw new Error('EagleView accepted the order but returned no report id.')
    return { externalRequestId: String(body.ReportId), status: 'processing' }
  }

  async getMeasurementStatus(externalId: string): Promise<ProviderStatus> {
    const token = await this.token()
    const response = await fetch(`${this.baseUrl}/v3/Report/GetReport?reportId=${encodeURIComponent(externalId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return { status: 'failed', message: `EagleView returned ${response.status}.` }
    const body = (await response.json()) as { StatusId?: number; Status?: string }
    // EagleView status 6 is "Completed"; anything else is still in flight.
    if (body.StatusId === 6 || /complete/i.test(body.Status ?? '')) return { status: 'complete' }
    if (/cancel/i.test(body.Status ?? '')) return { status: 'cancelled', message: body.Status }
    return { status: 'processing', message: body.Status }
  }

  async getMeasurementResult(externalId: string): Promise<RoofMeasurementResult> {
    const token = await this.token()
    const response = await fetch(
      `${this.baseUrl}/v3/Report/GetReportMeasurements?reportId=${encodeURIComponent(externalId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!response.ok) throw new Error(`EagleView measurement fetch failed (${response.status}).`)
    return mapReport(await response.json(), externalId)
  }
}

// ---------------------------------------------------------------------------
// Nearmap
// ---------------------------------------------------------------------------

/**
 * Nearmap AI "Roof" feature adapter.
 *
 * Same caveat as EagleView: the shape below follows Nearmap's published AI
 * Feature API, but it has not been run against a live key. Nearmap returns
 * results synchronously for a coordinate, which is why `createMeasurementRequest`
 * reports `complete` immediately and the result is fetched by address key.
 */
class NearmapProvider implements RoofMeasurementProvider {
  readonly name = 'nearmap' as const
  readonly displayName = 'Nearmap'

  private readonly baseUrl = process.env.NEARMAP_API_BASE || 'https://api.nearmap.com'

  isConfigured(): boolean {
    return Boolean(process.env.NEARMAP_API_KEY)
  }

  async createMeasurementRequest(input: MeasurementRequestInput): Promise<MeasurementRequestResult> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError(
        'nearmap',
        'Nearmap is selected but NEARMAP_API_KEY is not set. Enter the measurement by hand, or upload a report.',
      )
    }
    if (input.latitude == null || input.longitude == null) {
      throw new Error('Nearmap needs coordinates for this address. Enter the measurement by hand instead.')
    }
    return { externalRequestId: `${input.latitude},${input.longitude}`, status: 'complete' }
  }

  async getMeasurementStatus(): Promise<ProviderStatus> {
    return { status: 'complete' }
  }

  async getMeasurementResult(externalId: string): Promise<RoofMeasurementResult> {
    const [lat, lon] = externalId.split(',')
    const response = await fetch(
      `${this.baseUrl}/ai/features/v4/point.json?point=${lon},${lat}&packs=roof_char&apikey=${process.env.NEARMAP_API_KEY}`,
    )
    if (!response.ok) throw new Error(`Nearmap request failed (${response.status}).`)
    return mapReport(await response.json(), externalId)
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Normalises a provider payload into our shape.
 *
 * Every provider names these fields differently and changes them between API
 * versions, so this reads defensively: it looks for several plausible keys and
 * leaves a value null rather than guessing. A null measurement shows as "not
 * recorded" in the UI, which is honest. A wrong one would not be.
 */
export function mapReport(payload: unknown, externalId: string): RoofMeasurementResult {
  const p = (payload ?? {}) as Record<string, unknown>
  const num = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = deepGet(p, key)
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value)
      }
    }
    return null
  }

  const sqft = num('TotalRoofArea', 'totalArea', 'roof.areaSqft', 'areaSqft', 'total_area_sqft')
  const squares = num('TotalSquares', 'squares', 'roof.squares')

  return {
    roofAreaSqft: sqft ?? (squares !== null ? Math.round(squares * 100) : null),
    roofAreaSquares: squares ?? (sqft !== null ? Math.round((sqft / 100) * 10) / 10 : null),
    primaryPitch: stringOf(deepGet(p, 'PredominantPitch') ?? deepGet(p, 'roof.pitch') ?? deepGet(p, 'primaryPitch')),
    facetCount: num('NumberOfFacets', 'facets', 'roof.facetCount'),
    ridgeLf: num('RidgeLength', 'ridge', 'roof.ridgeLf'),
    hipLf: num('HipLength', 'hip', 'roof.hipLf'),
    valleyLf: num('ValleyLength', 'valley', 'roof.valleyLf'),
    eaveLf: num('EaveLength', 'eave', 'roof.eaveLf'),
    rakeLf: num('RakeLength', 'rake', 'roof.rakeLf'),
    wasteFactorPercent: num('SuggestedWaste', 'wasteFactor'),
    externalReportId: externalId,
    capturedAt: stringOf(deepGet(p, 'CapturedDate') ?? deepGet(p, 'captureDate')),
    raw: p,
  }
}

function deepGet(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, source)
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 60) : null
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const PROVIDERS: Record<string, RoofMeasurementProvider> = {
  manual: manualProvider,
  uploaded_report: manualProvider,
  eagleview: new EagleViewProvider(),
  nearmap: new NearmapProvider(),
}

export function getProvider(name?: string | null): RoofMeasurementProvider {
  const key = name || process.env.ROOF_MEASUREMENT_PROVIDER || 'manual'
  return PROVIDERS[key] ?? manualProvider
}

export interface ProviderConfigState {
  selected: string
  displayName: string
  configured: boolean
  /** What the office should do to make ordering work. */
  action: string
  availableProviders: { name: string; displayName: string; configured: boolean }[]
}

/** Drives the Settings → Measurements panel. Never reveals a secret value. */
export function describeProviderConfig(selected?: string | null): ProviderConfigState {
  const provider = getProvider(selected)
  const configured = provider.isConfigured()

  return {
    selected: provider.name,
    displayName: provider.displayName,
    configured,
    action: configured
      ? provider.name === 'manual'
        ? 'Measurements are entered by hand or uploaded as a report. No credentials needed.'
        : 'Ready — measurements can be ordered from the estimate screen.'
      : `${provider.displayName} is selected but its credentials are not set. Until they are, use manual entry or upload the report; nothing is blocked.`,
    availableProviders: Object.entries(PROVIDERS)
      .filter(([key]) => key !== 'uploaded_report')
      .map(([key, p]) => ({ name: key, displayName: p.displayName, configured: p.isConfigured() })),
  }
}

// ---------------------------------------------------------------------------
// Derived quantities
// ---------------------------------------------------------------------------

export interface MeasurementQuantities {
  squares: number | null
  squaresWithWaste: number | null
  ridgeAndHipLf: number | null
  perimeterLf: number | null
  starterLf: number | null
}

/**
 * Turns geometry into the numbers that actually go on an estimate line.
 *
 * Kept pure and separate from the providers so the arithmetic is testable and
 * identical whether the measurement came from EagleView or from a tape measure.
 */
export function deriveQuantities(
  measurement: {
    roof_area_sqft?: number | null
    roof_area_squares?: number | null
    ridge_lf?: number | null
    hip_lf?: number | null
    eave_lf?: number | null
    rake_lf?: number | null
    waste_factor_percent?: number | null
  },
  defaultWastePercent = 10,
): MeasurementQuantities {
  const squares =
    measurement.roof_area_squares ??
    (measurement.roof_area_sqft != null ? Math.round((measurement.roof_area_sqft / 100) * 10) / 10 : null)

  const waste = measurement.waste_factor_percent ?? defaultWastePercent

  const ridge = measurement.ridge_lf ?? 0
  const hip = measurement.hip_lf ?? 0
  const eave = measurement.eave_lf ?? 0
  const rake = measurement.rake_lf ?? 0

  return {
    squares,
    squaresWithWaste: squares !== null ? Math.round(squares * (1 + waste / 100) * 10) / 10 : null,
    ridgeAndHipLf: ridge + hip > 0 ? Math.round(ridge + hip) : null,
    perimeterLf: eave + rake > 0 ? Math.round(eave + rake) : null,
    starterLf: eave > 0 ? Math.round(eave) : null,
  }
}
