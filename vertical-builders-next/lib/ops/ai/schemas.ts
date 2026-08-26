import { z } from 'zod'
import { AI_LIMITS } from './guardrails'

/**
 * ============================================================================
 * MODEL OUTPUT SCHEMAS
 * ----------------------------------------------------------------------------
 * Every response from the model passes through one of these before any other
 * code touches it. Model output is untrusted input — the same posture as a
 * request body from the internet.
 *
 * All objects are `.strict()`: an unexpected key is a rejection, not a silent
 * pass-through. That is what stops a model smuggling an extra field into a
 * write proposal.
 * ============================================================================
 */

const shortText = (max: number) => z.string().trim().max(max)

/** `YYYY-MM-DD`, or null. Empty string and "unknown" both become null. */
const nullableDate = z.preprocess(
  v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null),
  z.string().nullable(),
)

const nullableDollars = z.preprocess(v => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? Math.round(n) : null
}, z.number().int().nonnegative().nullable())

const confidence = z.preprocess(v => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
}, z.number().min(0).max(1).nullable())

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------

/**
 * The model picks a tool by NAME ONLY, from a fixed list, with typed arguments.
 * It never emits SQL, a table name, a URL or a storage path. `.strict()` plus
 * the enum in `tools.ts` means an invented tool name fails validation before
 * anything is executed.
 */
export const toolCallSchema = z.object({
  tool: shortText(60),
  args: z.record(z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).default({}),
}).strict()

export const copilotPlanSchema = z.object({
  /** Empty when the model can answer without data. */
  toolCalls: z.array(toolCallSchema).max(AI_LIMITS.maxToolCallsPerRequest).default([]),
  reply: shortText(4_000).default(''),
}).strict()

export type CopilotPlan = z.infer<typeof copilotPlanSchema>

/** A write the model wants to happen. It is data; a human executes it. */
export const leadProposalSchema = z.object({
  first_name: shortText(120).default(''),
  last_name: shortText(120).default(''),
  company_name: shortText(160).default(''),
  email: shortText(160).default(''),
  phone: shortText(40).default(''),
  customer_type: z.enum(['residential', 'commercial']).nullable().default(null),
  service_type: shortText(80).default(''),
  property_address: shortText(200).default(''),
  city: shortText(80).default(''),
  state: shortText(2).default(''),
  zip: shortText(12).default(''),
  project_description: shortText(4_000).default(''),
  timeline: shortText(60).default(''),
}).strict()

export type LeadProposal = z.infer<typeof leadProposalSchema>

export const proposalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_lead'),
    fields: leadProposalSchema,
    warnings: z.array(shortText(300)).max(10).default([]),
  }).strict(),
  z.object({
    type: z.literal('draft_message'),
    subject: shortText(200).default(''),
    body: shortText(4_000),
    audience: z.enum(['customer', 'lead', 'subcontractor']).default('customer'),
    warnings: z.array(shortText(300)).max(10).default([]),
  }).strict(),
  z.object({
    type: z.literal('create_task'),
    title: shortText(200),
    due_date: nullableDate.default(null),
    priority: z.enum(['low', 'normal', 'high']).default('normal'),
    notes: shortText(2_000).default(''),
    warnings: z.array(shortText(300)).max(10).default([]),
  }).strict(),
])

export type AiProposal = z.infer<typeof proposalSchema>

export const copilotAnswerSchema = z.object({
  reply: shortText(4_000),
  /** Ids the model referenced, so the UI can render real links. */
  citedRecords: z.array(z.object({
    kind: z.enum(['lead', 'contact', 'project', 'vendor', 'invoice', 'estimate', 'task']),
    id: shortText(64),
    label: shortText(160),
  }).strict()).max(20).default([]),
  proposal: proposalSchema.nullable().default(null),
  /** Set when the model could not answer from permitted data. */
  limitation: shortText(400).nullable().default(null),
}).strict()

export type CopilotAnswer = z.infer<typeof copilotAnswerSchema>

// ---------------------------------------------------------------------------
// Lead assistant
// ---------------------------------------------------------------------------

export const leadStructureSchema = z.object({
  fields: leadProposalSchema,
  summary: shortText(600).default(''),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),
  suggestedNextAction: shortText(300).default(''),
  warnings: z.array(shortText(300)).max(10).default([]),
}).strict()

export type LeadStructure = z.infer<typeof leadStructureSchema>

export const leadEnrichmentSchema = z.object({
  summary: shortText(600),
  serviceCategory: shortText(80).default(''),
  urgency: z.enum(['low', 'normal', 'high']).default('normal'),
  nextAction: shortText(300).default(''),
  followUpMessage: shortText(2_000).default(''),
}).strict()

export type LeadEnrichment = z.infer<typeof leadEnrichmentSchema>

// ---------------------------------------------------------------------------
// COI extraction
// ---------------------------------------------------------------------------

/**
 * Coverage lines as they appear on an ACORD form.
 *
 * Every field is nullable on purpose. "Missing means missing" is the rule from
 * the change order, and it is the right one: a guessed expiration date on an
 * insurance certificate produces a confident, wrong compliance verdict.
 */
export const coiCoverageSchema = z.object({
  // Exactly COVERAGE_TYPES from lib/ops/types.ts. An extraction that produced a
  // coverage the database cannot store would fail at apply time, so the enum is
  // aligned here and the prompt tells the model how to map ACORD wording onto it.
  coverageType: z.enum([
    'general_liability', 'workers_compensation', 'commercial_auto', 'umbrella',
    'professional_liability', 'pollution_liability', 'other',
  ]),
  carrier: shortText(160).nullable().default(null),
  policyNumber: shortText(80).nullable().default(null),
  effectiveDate: nullableDate.default(null),
  expirationDate: nullableDate.default(null),
  eachOccurrence: nullableDollars.default(null),
  generalAggregate: nullableDollars.default(null),
  combinedSingleLimit: nullableDollars.default(null),
  employersLiability: nullableDollars.default(null),
  additionalInsured: z.boolean().nullable().default(null),
  waiverOfSubrogation: z.boolean().nullable().default(null),
  primaryNoncontributory: z.boolean().nullable().default(null),
  confidence: confidence.default(null),
  sourceNote: shortText(200).nullable().default(null),
}).strict()

export type CoiCoverage = z.infer<typeof coiCoverageSchema>

export const coiExtractionSchema = z.object({
  namedInsured: shortText(200).nullable().default(null),
  certificateHolder: shortText(200).nullable().default(null),
  producer: shortText(200).nullable().default(null),
  issueDate: nullableDate.default(null),
  coverages: z.array(coiCoverageSchema).max(12).default([]),
  notes: shortText(1_500).default(''),
  warnings: z.array(shortText(300)).max(12).default([]),
  overallConfidence: confidence.default(null),
}).strict()

export type CoiExtraction = z.infer<typeof coiExtractionSchema>

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export const auditBriefSchema = z.object({
  executiveSummary: shortText(1_500),
  criticalBlockers: z.array(shortText(400)).max(15).default([]),
  expiringSoon: z.array(shortText(400)).max(15).default([]),
  missingPaperwork: z.array(shortText(400)).max(15).default([]),
  needsHumanReview: z.array(shortText(400)).max(15).default([]),
  recommendedActions: z.array(shortText(400)).max(15).default([]),
  readinessStatement: shortText(500).default(''),
}).strict()

export type AuditBrief = z.infer<typeof auditBriefSchema>

export const dashboardBriefSchema = z.object({
  headline: shortText(300),
  bullets: z.array(shortText(300)).max(8).default([]),
  topPriority: shortText(300).default(''),
}).strict()

export type DashboardBrief = z.infer<typeof dashboardBriefSchema>

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

export interface ParseOutcome<T> {
  ok: boolean
  data?: T
  error?: string
}

/**
 * Validate model output. Returns a result rather than throwing so that every
 * caller is forced to think about the invalid case — an unusable response is a
 * normal, expected outcome, not an exception.
 */
export function parseModelOutput<T>(
  // `ZodTypeDef, unknown` pins T to the schema's OUTPUT type. Without it, a
  // field with `.default()` types as optional here even though parsing always
  // fills it, and every caller ends up with spurious `| undefined`.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  raw: unknown,
): ParseOutcome<T> {
  const result = schema.safeParse(raw)
  if (result.success) return { ok: true, data: result.data }
  const first = result.error.issues[0]
  const where = first?.path.join('.') || 'response'
  // Log the shape of the failure, never the payload.
  console.error('[ops-ai] model output rejected', where, first?.code)
  return { ok: false, error: `The AI returned an unusable ${where}.` }
}
