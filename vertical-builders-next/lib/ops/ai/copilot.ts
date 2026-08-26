import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '../types'
import { requestJson, AiUnavailableError, OPS_PROMPT_VERSION, opsModel } from './provider'
import { copilotAnswerSchema, copilotPlanSchema, parseModelOutput, type CopilotAnswer } from './schemas'
import { AI_LIMITS, INJECTION_PREAMBLE, clampText, trimConversation } from './guardrails'
import { availableTools, executeTool, type ToolContext } from './tools'

/**
 * ============================================================================
 * COPILOT ORCHESTRATION
 * ----------------------------------------------------------------------------
 * Two model calls, deliberately:
 *
 *   1. PLAN  — given the question and the list of tools this user may call,
 *              which tools should run, with what arguments?
 *   2. ANSWER — given the tool results, write the reply.
 *
 * A single-call function-calling loop would work too. Two explicit calls were
 * chosen because the boundary between "decide what to fetch" and "write prose
 * about what came back" is then visible in the code and testable in isolation:
 * the planner's output is validated against a closed tool list before anything
 * executes, and the answerer never touches the database at all.
 * ============================================================================
 */

export interface CopilotTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface CopilotRequest {
  supabase: SupabaseClient
  userId: string
  userName: string
  role: UserRole
  settings: { costs_visible_to_pm: boolean; profit_visible_to_pm: boolean }
  message: string
  history: CopilotTurn[]
  /** e.g. "/ops/subcontractors" — used only to bias suggestions. */
  pageContext?: string
}

export interface CopilotResult {
  answer: CopilotAnswer
  toolsUsed: string[]
  model: string
  promptVersion: string
  latencyMs: number
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null
}

const ROLE_NOTE: Record<UserRole, string> = {
  admin: 'This user is an owner/admin and can see everything the system holds, including financial data.',
  office: 'This user is office/compliance staff and can see operational and financial data.',
  project_manager:
    'This user is a project manager. Their access to job costs and profit depends on company settings — if a financial tool is not in your list, they do not have it.',
  read_only:
    'This user is a read-only auditor. They can review compliance and records but CANNOT see job costs, gross profit or margin, and cannot create or change anything. Never offer to create records for them.',
}

function systemPrompt(req: CopilotRequest, tools: { name: string; description: string; args: string }[]): string {
  return [
    'You are Vertical Ops AI, the assistant inside the Vertical Builders & Commercial CRM.',
    '',
    INJECTION_PREAMBLE,
    '',
    'WHAT YOU ARE',
    'You help staff find and understand what is already in the CRM. Vertical Ops is',
    'the source of truth; you are an assistant, not an authority. If the data does',
    'not support an answer, say so plainly rather than filling the gap.',
    '',
    'HARD RULES',
    '- You cannot write to the database. For any request that would create or change',
    '  a record, return a proposal for a human to review and confirm.',
    '- You never decide compliance. The system computes compliance deterministically;',
    '  you may explain or summarise the result it gives you, never override it.',
    '- You never set or suggest a price on an estimate. Prices come from the pricebook.',
    '- You never state a number you were not given by a tool. No arithmetic on money',
    '  from memory, no estimated counts.',
    '- If a tool refuses on permission grounds, tell the user plainly that the',
    '  information is not available to their account. Do not speculate about the value.',
    '',
    `CURRENT USER: ${clampText(req.userName, 80)} (role: ${req.role})`,
    ROLE_NOTE[req.role],
    req.pageContext ? `They are currently on: ${clampText(req.pageContext, 120)}` : '',
    `TODAY: ${new Date().toISOString().slice(0, 10)}`,
    '',
    'TOOLS YOU MAY CALL (this list is complete; anything else does not exist):',
    ...tools.map(t => `- ${t.name} ${t.args} — ${t.description}`),
  ].filter(Boolean).join('\n')
}

const PLAN_INSTRUCTION = [
  'Decide which tools to call to answer the question.',
  '',
  'Respond with JSON only:',
  '{ "toolCalls": [ { "tool": "<exact tool name>", "args": { } } ], "reply": "" }',
  '',
  `Call at most ${AI_LIMITS.maxToolCallsPerRequest} tools. Call none if the question`,
  'needs no CRM data (a greeting, or a question about how the CRM works) and put',
  'your answer in "reply". Only use tool names from the list above.',
].join('\n')

const ANSWER_INSTRUCTION = [
  'Write the answer using ONLY the tool results below.',
  '',
  'Respond with JSON only:',
  '{',
  '  "reply": "your answer in plain language",',
  '  "citedRecords": [ { "kind": "lead|contact|project|vendor|invoice|estimate|task", "id": "<id from a tool result>", "label": "short label" } ],',
  '  "proposal": null,',
  '  "limitation": null',
  '}',
  '',
  'Rules for the reply:',
  '- Use the real names, dates and counts from the tool results. Never invent one.',
  '- If a tool was refused, set "limitation" to a short explanation and do not guess.',
  '- If the results are empty, say so — that is a useful answer.',
  '- Keep it short. Lead with the answer. Bullets when there is a list.',
  '- Only cite ids that appear in the tool results.',
  '',
  'If the user asked you to CREATE something, set "proposal" instead of writing the',
  'record yourself. Shapes:',
  '  { "type": "create_lead", "fields": { ...lead fields... }, "warnings": [] }',
  '  { "type": "draft_message", "subject": "", "body": "", "audience": "customer|lead|subcontractor", "warnings": [] }',
  '  { "type": "create_task", "title": "", "due_date": null, "priority": "normal", "notes": "", "warnings": [] }',
  'A proposal is a suggestion. A human reviews and confirms it. Say so in the reply.',
].join('\n')

export async function runCopilot(req: CopilotRequest): Promise<CopilotResult> {
  const started = Date.now()

  const ctx: ToolContext = {
    supabase: req.supabase,
    userId: req.userId,
    role: req.role,
    settings: req.settings,
  }

  // The tool list is computed from the user's role BEFORE the model sees
  // anything. A financial tool is simply absent for an auditor — the model is
  // never in a position to call it, and if it invents the name the executor
  // refuses it anyway.
  const tools = availableTools(ctx)
  const system = systemPrompt(req, tools)
  const history = trimConversation(req.history, AI_LIMITS.maxConversationTurns)
  const message = clampText(req.message, AI_LIMITS.maxUserMessageChars)

  const conversation = history.map(t => ({
    role: t.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: clampText(t.content, 1_500),
  }))

  // ---- 1. plan -------------------------------------------------------------
  const planResponse = await requestJson({
    messages: [
      { role: 'system', content: system },
      ...conversation,
      { role: 'user', content: `${message}\n\n---\n${PLAN_INSTRUCTION}` },
    ],
    maxOutputTokens: 500,
    temperature: 0,
  })

  const plan = parseModelOutput(copilotPlanSchema, planResponse.data)
  if (!plan.ok || !plan.data) {
    throw new AiUnavailableError('invalid_shape', 'The AI returned an unusable plan. Nothing has been changed.')
  }

  // ---- 2. execute ----------------------------------------------------------
  const toolsUsed: string[] = []
  const results: { tool: string; result: unknown }[] = []

  for (const call of plan.data.toolCalls.slice(0, AI_LIMITS.maxToolCallsPerRequest)) {
    const outcome = await executeTool(ctx, call.tool, call.args)
    toolsUsed.push(call.tool)
    results.push({
      tool: call.tool,
      result: outcome.ok ? outcome.data : { refused: outcome.denied },
    })
  }

  // ---- 3. answer -----------------------------------------------------------
  const toolBlock = results.length
    ? results.map(r => `TOOL ${r.tool} RESULT:\n${JSON.stringify(r.result).slice(0, 6_000)}`).join('\n\n')
    : 'No tools were called.'

  const answerResponse = await requestJson({
    messages: [
      { role: 'system', content: system },
      ...conversation,
      { role: 'user', content: message },
      { role: 'user', content: `${toolBlock}\n\n---\n${ANSWER_INSTRUCTION}` },
    ],
    maxOutputTokens: AI_LIMITS.maxOutputTokens,
    temperature: 0.2,
  })

  const answer = parseModelOutput(copilotAnswerSchema, answerResponse.data)
  if (!answer.ok || !answer.data) {
    throw new AiUnavailableError('invalid_shape', 'The AI returned an unusable answer. Nothing has been changed.')
  }

  // A read-only account must never be handed a write proposal. The prompt says
  // so, but the prompt is not the control — this is.
  const finalAnswer: CopilotAnswer =
    req.role === 'read_only' && answer.data.proposal
      ? {
          ...answer.data,
          proposal: null,
          limitation:
            answer.data.limitation
            ?? 'Your account is read-only, so records cannot be created from here.',
        }
      : answer.data

  const usage = answerResponse.usage && planResponse.usage
    ? {
        promptTokens: (planResponse.usage.promptTokens ?? 0) + (answerResponse.usage.promptTokens ?? 0),
        completionTokens: (planResponse.usage.completionTokens ?? 0) + (answerResponse.usage.completionTokens ?? 0),
        totalTokens: (planResponse.usage.totalTokens ?? 0) + (answerResponse.usage.totalTokens ?? 0),
      }
    : answerResponse.usage

  return {
    answer: finalAnswer,
    toolsUsed,
    model: opsModel(),
    promptVersion: OPS_PROMPT_VERSION,
    latencyMs: Date.now() - started,
    usage,
  }
}

export { suggestedPrompts } from './suggestions'
