import { describe, expect, it } from 'vitest'
import { can, canViewCosts, canViewProfit, CAPABILITIES } from '../lib/ops/auth/permissions'
import { USER_ROLES, type UserRole } from '../lib/ops/types'

const ALL: UserRole[] = [...USER_ROLES]

const settings = (costs: boolean, profit: boolean) => ({
  costs_visible_to_pm: costs,
  profit_visible_to_pm: profit,
})

describe('the role list itself', () => {
  it('has exactly the four roles the database CHECK constraint allows', () => {
    expect(ALL).toEqual(['admin', 'office', 'project_manager', 'read_only'])
  })

  it('never grants a capability to a role that does not exist', () => {
    for (const [capability, roles] of Object.entries(CAPABILITIES)) {
      for (const role of roles as readonly string[]) {
        expect(ALL, `${capability} grants unknown role "${role}"`).toContain(role)
      }
    }
  })
})

describe('auditor (read_only) is blind to money the company makes', () => {
  it('cannot view job costs under any settings combination', () => {
    for (const [c, p] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      expect(canViewCosts('read_only', settings(c, p))).toBe(false)
    }
  })

  it('cannot view profit or margin under any settings combination', () => {
    for (const [c, p] of [[true, true], [true, false], [false, true], [false, false]] as const) {
      expect(canViewProfit('read_only', settings(c, p))).toBe(false)
    }
  })

  it('does not hold the underlying capabilities either', () => {
    expect(can('read_only', 'costsView')).toBe(false)
    expect(can('read_only', 'profitabilityView')).toBe(false)
    expect(can('read_only', 'costsEdit')).toBe(false)
  })

  it('keeps the compliance access the role exists for', () => {
    for (const capability of ['readRecords', 'downloadDocuments', 'agreementsView'] as const) {
      expect(can('read_only', capability), capability).toBe(true)
    }
  })

  it('still cannot write anything', () => {
    expect(can('read_only', 'writeRecords')).toBe(false)
    expect(can('read_only', 'invoicesCreate')).toBe(false)
  })
})

describe('admin and office keep full financial access', () => {
  for (const role of ['admin', 'office'] as const) {
    it(`${role} sees costs and profit regardless of the PM switches`, () => {
      expect(canViewCosts(role, settings(false, false))).toBe(true)
      expect(canViewProfit(role, settings(false, false))).toBe(true)
    })
  }
})

describe('project manager visibility stays configurable', () => {
  it('follows costs_visible_to_pm', () => {
    expect(canViewCosts('project_manager', settings(true, false))).toBe(true)
    expect(canViewCosts('project_manager', settings(false, false))).toBe(false)
  })

  it('follows profit_visible_to_pm, independently of costs', () => {
    expect(canViewProfit('project_manager', settings(true, true))).toBe(true)
    expect(canViewProfit('project_manager', settings(true, false))).toBe(false)
  })

  it('can still enter costs', () => {
    expect(can('project_manager', 'costsEdit')).toBe(true)
  })
})

describe('no role at all', () => {
  it('sees nothing', () => {
    expect(canViewCosts(null, settings(true, true))).toBe(false)
    expect(canViewProfit(undefined, settings(true, true))).toBe(false)
  })
})

describe('exhaustive matrix — who can see costs and profit', () => {
  it('matches the documented table', () => {
    const matrix = ALL.map(role => ({
      role,
      costsDefault: canViewCosts(role, settings(true, false)),
      profitDefault: canViewProfit(role, settings(true, false)),
    }))
    expect(matrix).toEqual([
      { role: 'admin', costsDefault: true, profitDefault: true },
      { role: 'office', costsDefault: true, profitDefault: true },
      { role: 'project_manager', costsDefault: true, profitDefault: false },
      { role: 'read_only', costsDefault: false, profitDefault: false },
    ])
  })
})
