import { z } from 'zod'
import { WASTE_RULE_TYPES } from '../prospecting/constants'

/**
 * ============================================================================
 * PROSPECTING CAMPAIGN VALIDATION
 * ----------------------------------------------------------------------------
 * A campaign is reusable per-county/source configuration. It is deliberately
 * forgiving: the only hard requirement is a name. Roof-type filter, permit date
 * window, min roof age, waste rule and templates are all optional so an operator
 * can spin up a campaign for a fresh county in seconds and refine it later.
 * ============================================================================
 */

const optionalText = (max: number) =>
  z.preprocess(v => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional())

const optionalDate = z.preprocess(
  v => (v === '' || v === null || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.').nullable().optional(),
)

const optionalNumber = (max: number) => z.preprocess(
  v => {
    if (v === '' || v === null || v === undefined) return null
    const n = typeof v === 'string' ? Number(v) : v
    return Number.isFinite(n as number) ? n : v
  },
  z.number().min(0).max(max).nullable().optional(),
)

const nullableUuid = z.preprocess(v => (v === '' || v === undefined ? null : v),
  z.string().uuid().nullable().optional())

/** Roof-type families a campaign may filter on. Matches classifyRoofType(). */
export const ROOF_TYPE_OPTIONS = ['shingle', 'tile', 'metal', 'flat', 'slate', 'wood', 'other'] as const

export const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Give the campaign a name.').max(120),
  county: optionalText(80),
  data_source: optionalText(120),
  roof_types: z.array(z.enum(ROOF_TYPE_OPTIONS)).max(7).default([]),
  permit_date_from: optionalDate,
  permit_date_to: optionalDate,
  min_roof_age_years: optionalNumber(200),
  waste_rule_type: z.enum(WASTE_RULE_TYPES).default('percent'),
  waste_rule_value: optionalNumber(100_000),
  waste_min_squares: optionalNumber(100_000),
  pricebook_service_type: optionalText(80),
  proposal_template_id: nullableUuid,
  default_batch_size: z.preprocess(
    v => {
      if (v === '' || v === null || v === undefined) return 60
      const n = typeof v === 'string' ? Number(v) : v
      return Number.isFinite(n as number) ? n : v
    },
    z.number().int().min(1).max(500).default(60),
  ),
  mail_tag: optionalText(80),
  active: z.boolean().default(true),
}).strict()

export type CampaignInput = z.infer<typeof campaignSchema>
