import 'server-only'

/**
 * ============================================================================
 * GEOCODER — address → coordinates, behind an interface, nothing wired to a key
 * ----------------------------------------------------------------------------
 * A coordinate-based measurement provider (e.g. Nearmap) needs lat/lon; an
 * address-based one (e.g. EagleView) does not. So geocoding is an OPTIONAL stage,
 * not a mandatory prerequisite for the whole pipeline. This defines the boundary
 * and reports configuration state; it makes no network calls. When a key is
 * added later, only the `geocode()` body changes — nothing upstream does.
 * ============================================================================
 */

export interface GeocodeResult {
  latitude: number
  longitude: number
  canonicalAddress?: string | null
  matchQuality: 'exact' | 'partial' | 'approximate'
  provider: string
}

export interface GeocodeProvider {
  readonly name: string
  readonly displayName: string
  isConfigured(): boolean
  /** Not called anywhere yet. Throws GeocoderNotConfiguredError until a key exists. */
  geocode(address: string): Promise<GeocodeResult>
}

export class GeocoderNotConfiguredError extends Error {
  readonly provider: string
  constructor(provider: string, detail: string) {
    super(detail)
    this.name = 'GeocoderNotConfiguredError'
    this.provider = provider
  }
}

class GoogleGeocoder implements GeocodeProvider {
  readonly name = 'google'
  readonly displayName = 'Google Geocoding'
  isConfigured(): boolean {
    // A DEDICATED geocoding key — deliberately separate from GOOGLE_MAPS_API_KEY,
    // which the app documents as imagery-preview-only and never for geometry.
    return Boolean(process.env.GEOCODER_GOOGLE_API_KEY)
  }
  async geocode(): Promise<GeocodeResult> {
    throw new GeocoderNotConfiguredError('google',
      'Google Geocoding is not configured (GEOCODER_GOOGLE_API_KEY is unset). No geocoding request was made.')
  }
}

class CensusGeocoder implements GeocodeProvider {
  readonly name = 'census'
  readonly displayName = 'US Census Geocoder'
  isConfigured(): boolean {
    // The Census geocoder is free/keyless; treat it as opt-in via a flag so it is
    // never contacted implicitly. No call is made until Phase 2 execution is authorized.
    return process.env.GEOCODER_CENSUS_ENABLED === 'true'
  }
  async geocode(): Promise<GeocodeResult> {
    throw new GeocoderNotConfiguredError('census',
      'Census geocoding is not enabled (GEOCODER_CENSUS_ENABLED is not "true"). No geocoding request was made.')
  }
}

/** Always-available no-op: coordinates come from a person, not a service. */
const manualGeocoder: GeocodeProvider = {
  name: 'manual',
  displayName: 'Manual / none',
  isConfigured: () => true,
  async geocode() {
    throw new GeocoderNotConfiguredError('manual',
      'No geocoder is configured. Coordinates must be entered by hand, or use an address-based measurement provider.')
  },
}

const GEOCODERS: Record<string, GeocodeProvider> = {
  google: new GoogleGeocoder(),
  census: new CensusGeocoder(),
  manual: manualGeocoder,
}

export function getGeocoder(name?: string | null): GeocodeProvider {
  const key = name || process.env.GEOCODER_PROVIDER || 'manual'
  return GEOCODERS[key] ?? manualGeocoder
}

export interface GeocoderConfigState {
  selected: string
  displayName: string
  configured: boolean
  action: string
}

export function describeGeocoderConfig(selected?: string | null): GeocoderConfigState {
  const g = getGeocoder(selected)
  const configured = g.name !== 'manual' && g.isConfigured()
  return {
    selected: g.name,
    displayName: g.displayName,
    configured,
    action: configured
      ? 'Ready — coordinate-based measurement providers can resolve addresses.'
      : 'Not configured. Address-based providers (e.g. EagleView) work without it; coordinate-based ones (e.g. Nearmap) need it.',
  }
}
