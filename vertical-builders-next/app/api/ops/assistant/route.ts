import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getOptionalUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { getSettings } from '@/lib/ops/services/settings'
import { logAiRun } from '@/lib/ops/services/ai-runs'
import { logActivity } from '@/lib/ops/services/activity'
import { describeAiError, isOpsAiConfigured } from '@/lib/ops/ai/provider'
import { runCopilot } from '@/lib/ops/ai/copilot'
import { AI_LIMITS } from '@/lib/ops/ai/guardrails'
import { helpResponse, runSmartOps, type SmartOpsContext } from '@/lib/ops/smart/router'

/**
 * ============================================================================
 * THE ASSISTANT ENDPOINT — one door, two modes
 * ----------------------------------------------------------------------------
 * Deterministic first, generative second:
 *
 *   1. Authenticate. The session comes from the cookie; the body carries no
 *      role, no user id and no permission claim, because anything a browser
 *      says about who it is would be a lie waiting to happen.
 *   2. Try Smart Ops. If the question is one of the defined operational
 *      commands, it is answered from the CRM with no provider call at all.
 *   3. Only if Smart Ops does not recognise it, and AI Enhanced is activated,
 *      hand it to the generative Copilot.
 *   4. Otherwise return the built-in help, which lists what is supported.
 *
 * Ordering it this way is not only about cost, though it does mean the company
 * never pays a token for "what expires in 30 days". It is also about
 * correctness: a count that comes from a SQL aggregate cannot be hallucinated.
 *
 * Every read in both modes uses the user-scoped client created here, under RLS.
 * ============================================================================
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  message: z.string().trim().min(1).max(AI_LIMITS.maxUserMessageChars),
  pageContext: z.string().max(200).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4_000),
  })).max(AI_LIMITS.maxConversationTurns * 2).default([]),
  /** "Ask AI instead" — skips the deterministic path for this one question. */
  preferAi: z.boolean().default(false),
}).strict()

export async function POST(request: Request) {
  const user = await getOptionalUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to use the assistant.' }, { status: 401 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'That request could not be read.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  const smartCtx: SmartOpsContext = {
    supabase,
    userId: user.id,
    userName: user.profile.full_name || user.email,
    // Resolved from the database, never from the request body.
    role: user.role,
    settings: {
      costs_visible_to_pm: settings.costs_visible_to_pm,
      profit_visible_to_pm: settings.profit_visible_to_pm,
    },
  }

  const aiActivated = isOpsAiConfigured() && settings.ai_copilot_enabled

  // -------------------------------------------------------------------------
  // 1. Deterministic Smart Ops
  // -------------------------------------------------------------------------
  const smart = body.preferAi && aiActivated
    ? { response: null, match: null }
    : await runSmartOps(smartCtx, body.message)

  if (smart.response) {
    await logAiRun(supabase, {
      userId: user.id,
      feature: 'smart_ops',
      // No provider was contacted, no tokens were spent, and the row says so.
      mode: 'smart_ops',
      inputRefs: { intent: smart.match?.intent ?? null, page: body.pageContext ?? null, messageChars: body.message.length },
      outputSummary: { items: smart.response.items?.length ?? 0, facts: smart.response.facts?.length ?? 0 },
    })
    return NextResponse.json({ mode: 'smart_ops', smart: smart.response, aiAvailable: aiActivated })
  }

  // -------------------------------------------------------------------------
  // 2. Generative fallback, only when AI Enhanced is activated
  // -------------------------------------------------------------------------
  if (!aiActivated) {
    const reason = !isOpsAiConfigured() ? 'not_configured' : 'disabled'
    return NextResponse.json({
      mode: 'smart_ops',
      smart: helpResponse(smartCtx,
        reason === 'not_configured'
          ? 'I do not handle that one yet. Free-form questions need AI Enhanced, which is not activated — here is everything I can answer without it.'
          : 'I do not handle that one yet, and the AI assistant is switched off in Settings → AI. Here is everything I can answer without it.'),
      aiAvailable: false,
      unmatched: true,
    })
  }

  const started = Date.now()
  try {
    const result = await runCopilot({
      supabase,
      userId: user.id,
      userName: smartCtx.userName,
      role: user.role,
      settings: smartCtx.settings,
      message: body.message,
      history: body.history,
      pageContext: body.pageContext,
    })

    await logAiRun(supabase, {
      userId: user.id,
      feature: 'copilot',
      mode: 'ai_enhanced',
      model: result.model,
      promptVersion: result.promptVersion,
      // Tool names and lengths only. The question itself is not stored.
      inputRefs: { messageChars: body.message.length, tools: result.toolsUsed, page: body.pageContext ?? null },
      outputSummary: {
        toolsUsed: result.toolsUsed.length,
        cited: result.answer.citedRecords.length,
        hasProposal: Boolean(result.answer.proposal),
        limited: Boolean(result.answer.limitation),
      },
      tokenUsage: result.usage,
      latencyMs: result.latencyMs,
    })
    await logActivity(supabase, {
      action: 'ai.copilot_query', entityType: 'settings', actorUserId: user.id,
      metadata: { tools: result.toolsUsed.slice(0, 5) },
    })

    return NextResponse.json({
      mode: 'ai_enhanced',
      reply: result.answer.reply,
      citedRecords: result.answer.citedRecords,
      proposal: result.answer.proposal,
      limitation: result.answer.limitation,
      toolsUsed: result.toolsUsed,
      aiAvailable: true,
    })
  } catch (error) {
    const described = describeAiError(error)
    await logAiRun(supabase, {
      userId: user.id, feature: 'copilot', mode: 'ai_enhanced', status: 'failed',
      errorCode: described.reason, latencyMs: Date.now() - started,
    })

    // The provider is down. If this question was one Smart Ops could have
    // handled — which is the case whenever "Ask AI instead" was used — answer
    // it deterministically rather than reporting an outage.
    if (body.preferAi) {
      const retry = await runSmartOps(smartCtx, body.message)
      if (retry.response) {
        return NextResponse.json({
          mode: 'smart_ops',
          smart: {
            ...retry.response,
            notices: [
              ...(retry.response.notices ?? []),
              'The AI service is unavailable, so this was answered from your CRM data directly.',
            ],
          },
          aiAvailable: true,
          providerFailed: true,
        })
      }
    }

    return NextResponse.json({
      mode: 'smart_ops',
      smart: helpResponse(smartCtx, `${described.message} Everything below still works — it does not use the AI service.`),
      aiAvailable: true,
      providerFailed: true,
      reason: described.reason,
    })
  }
}
