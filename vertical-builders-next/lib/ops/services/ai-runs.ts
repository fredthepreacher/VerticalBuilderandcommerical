import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { safeMetadata } from '../ai/guardrails'

/**
 * AI telemetry.
 *
 * Same philosophy as `logActivity`: a broken log must never break the thing it
 * is logging, so every failure here is swallowed after being printed.
 *
 * What is stored is deliberately thin — ids, counts, tool names, model,
 * outcome. Never a prompt, never document text, never the model's prose. The
 * question this table answers is "who ran AI against what, and did it work",
 * not "what did it say". Anything richer would quietly become a second copy of
 * the customer's insurance paperwork living in a log.
 */

export type AiFeature =
  | 'copilot'
  | 'lead_structure'
  | 'lead_enrichment'
  | 'lead_message'
  | 'coi_extraction'
  | 'audit_brief'
  | 'dashboard_brief'
  // Deterministic Smart Ops. Logged so usage is visible, always with
  // mode 'smart_ops' so it is never mistaken for AI-provider spend.
  | 'smart_ops'
  | 'smart_brief'
  | 'smart_audit_brief'
  | 'smart_lead_parse'

/**
 * Which half of the assistant ran.
 *
 * This is the column that answers "what is the AI actually costing us". A
 * `smart_ops` row contacted no provider and consumed no tokens; counting the
 * two together would misrepresent the bill in the direction that loses the
 * client's trust.
 */
export type AiMode = 'smart_ops' | 'ai_enhanced'

/** Everything under lib/ops/smart is deterministic; nothing else is. */
export const SMART_FEATURES: AiFeature[] = ['smart_ops', 'smart_brief', 'smart_audit_brief', 'smart_lead_parse']

export function modeForFeature(feature: AiFeature): AiMode {
  return SMART_FEATURES.includes(feature) ? 'smart_ops' : 'ai_enhanced'
}

export interface AiRunInput {
  userId: string
  feature: AiFeature
  /** Defaults from the feature, so a caller cannot mislabel a deterministic run. */
  mode?: AiMode
  status?: 'succeeded' | 'failed' | 'refused'
  model?: string | null
  promptVersion?: string | null
  entityType?: string | null
  entityId?: string | null
  inputRefs?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
  latencyMs?: number | null
  errorCode?: string | null
}

export async function logAiRun(supabase: SupabaseClient, input: AiRunInput): Promise<void> {
  try {
    await supabase.from('ai_runs').insert({
      user_id: input.userId,
      feature: input.feature,
      mode: input.mode ?? modeForFeature(input.feature),
      status: input.status ?? 'succeeded',
      model: input.model ?? null,
      prompt_version: input.promptVersion ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      input_refs: safeMetadata(input.inputRefs ?? {}),
      output_summary: safeMetadata(input.outputSummary ?? {}),
      token_usage: input.tokenUsage ?? null,
      latency_ms: input.latencyMs ?? null,
      error_code: input.errorCode ?? null,
    })
  } catch (error) {
    console.error('[ai-runs] failed to log', input.feature, error instanceof Error ? error.message : 'unknown')
  }
}

/** Same-day brief reuse, so a dashboard visit does not spend money every time. */
export async function findTodaysBrief(
  supabase: SupabaseClient,
  userId: string,
  feature: AiFeature,
): Promise<{ createdAt: string; summary: Record<string, unknown> } | null> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data } = await supabase
    .from('ai_runs')
    .select('created_at, output_summary')
    .eq('user_id', userId)
    .eq('feature', feature)
    .eq('status', 'succeeded')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
  const row = data?.[0]
  if (!row) return null
  return {
    createdAt: row.created_at as string,
    summary: (row.output_summary ?? {}) as Record<string, unknown>,
  }
}
