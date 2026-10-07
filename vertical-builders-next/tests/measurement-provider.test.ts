import { afterEach, describe, expect, it, vi } from 'vitest'
import { getProvider, providerKillSwitchEngaged } from '../lib/ops/measurements/provider'

/**
 * Provider gating + the emergency kill switch (production-readiness §27).
 * These prove a paid provider can never be reached when the switch is engaged,
 * and that an unknown/blank selection always falls back to manual (no paid call).
 */
afterEach(() => { vi.unstubAllEnvs() })

describe('measurement provider gating', () => {
  it('defaults to manual when nothing is selected', () => {
    vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', '')
    vi.stubEnv('ROOF_MEASUREMENT_PROVIDER', '')
    expect(getProvider().name).toBe('manual')
  })

  it('selects a real provider by name when the switch is off', () => {
    vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', '')
    expect(getProvider('eagleview').name).toBe('eagleview')
    expect(getProvider('nearmap').name).toBe('nearmap')
  })

  it('an unknown provider name falls back to manual (never a paid call)', () => {
    vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', '')
    expect(getProvider('totally-unknown').name).toBe('manual')
  })

  it('the kill switch forces manual regardless of selection', () => {
    for (const v of ['1', 'true', 'on', 'YES']) {
      vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', v)
      expect(providerKillSwitchEngaged()).toBe(true)
      expect(getProvider('eagleview').name).toBe('manual')
      expect(getProvider('nearmap').name).toBe('manual')
    }
  })

  it('a blank/false kill switch does not engage', () => {
    for (const v of ['', 'false', '0', 'off']) {
      vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', v)
      expect(providerKillSwitchEngaged()).toBe(false)
    }
  })

  it('eagleview/nearmap report not-configured without credentials (no paid call possible)', () => {
    vi.stubEnv('MEASUREMENT_PROVIDER_KILL_SWITCH', '')
    vi.stubEnv('EAGLEVIEW_CLIENT_ID', '')
    vi.stubEnv('EAGLEVIEW_CLIENT_SECRET', '')
    vi.stubEnv('NEARMAP_API_KEY', '')
    expect(getProvider('eagleview').isConfigured()).toBe(false)
    expect(getProvider('nearmap').isConfigured()).toBe(false)
  })
})
