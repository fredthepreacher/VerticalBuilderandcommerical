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

/**
 * Copilot endpoint.
 *
 * Not public. The session is resolved server-side from the cookie; the request
 * body carries no role, no user id and no permission claim, because anything a
 * browser sends about who it is would be a lie waiting to happen.
 *
 * Every database read the Copilot performs goes through the client created
 * here — the user-scoped one, under RLS. The service-role client is not
 * imported by this route or by anything under `lib/ops/ai/`.
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
}).strict()

export async function POST(request: Request) {
  const user = await getOptionalUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to use the assistant.' }, { status: 401 })
  }

  if (!isOpsAiConfigured()) {
    return NextResponse.json(
      { error: 'AI is not configured. Set OPENAI_API_KEY to enable the assistant.', reason: 'not_configured' },
      { status: 503 },
    )
  }

  let parsedBody: z.infer<typeof bodySchema>
  try {
    parsedBody = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'That request could not be read.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const settings = await getSettings(supabase)

  if (!settings.ai_copilot_enabled) {
    return NextResponse.json(
      { error: 'The assistant is switched off in Settings → AI.', reason: 'disabled' },
      { status: 503 },
    )
  }

  const started = Date.now()
  try {
    const result = await runCopilot({
      supabase,
      userId: user.id,
      userName: user.profile.full_name || user.email,
      // Resolved from the database, never from the request body.
      role: user.role,
      settings: {
        costs_visible_to_pm: settings.costs_visible_to_pm,
        profit_visible_to_pm: settings.profit_visible_to_pm,
      },
      message: parsedBody.message,
      history: parsedBody.history,
      pageContext: parsedBody.pageContext,
    })

    await logAiRun(supabase, {
      userId: user.id,
      feature: 'copilot',
      model: result.model,
      promptVersion: result.promptVersion,
      // Tool names and lengths only. The question itself is not stored.
      inputRefs: { messageChars: parsedBody.message.length, tools: result.toolsUsed, page: parsedBody.pageContext ?? null },
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
      reply: result.answer.reply,
      citedRecords: result.answer.citedRecords,
      proposal: result.answer.proposal,
      limitation: result.answer.limitation,
      toolsUsed: result.toolsUsed,
    })
  } catch (error) {
    const described = describeAiError(error)
    await logAiRun(supabase, {
      userId: user.id, feature: 'copilot', status: 'failed',
      errorCode: described.reason, latencyMs: Date.now() - started,
    })
    return NextResponse.json({ error: described.message, reason: described.reason }, { status: 503 })
  }
}
