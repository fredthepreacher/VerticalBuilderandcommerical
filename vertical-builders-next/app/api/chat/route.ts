import { NextResponse } from 'next/server'
import { BIZ, FAQS } from '@/lib/data'
import { SERVICE_AREAS } from '@/lib/serviceAreas'
import { SERVICES } from '@/lib/services'

/**
 * AI chat endpoint — OpenAI Responses API, server-side only.
 *
 *  - Reads OPENAI_API_KEY from Vercel env vars (never NEXT_PUBLIC_*,
 *    never shipped to the client).
 *  - Site knowledge is injected as structured instructions built from
 *    lib/data.ts, lib/services.ts, and lib/serviceAreas.ts — the same
 *    source of truth the pages render from.
 *  - If the key is missing or OpenAI errors, we return 503 and the
 *    widget falls back to the local rule engine (lib/assistant.ts),
 *    so the chat NEVER breaks for visitors.
 *
 * Optional upgrades (documented in README):
 *  - file_search: create a vector store of site content and add
 *    { type: 'file_search', vector_store_ids: [...] } to `tools`.
 *  - web_search: add { type: 'web_search' } to `tools` only if answers
 *    should ever use current outside information (not needed for a
 *    contractor knowledge bot; omitted by default).
 */

export const maxDuration = 30

interface ChatMessage { role: 'user' | 'assistant'; content: string }

function buildInstructions(): string {
  const services = SERVICES.map(s => `- ${s.title} (/${s.slug}): ${s.bullets.join('; ')}`).join('\n')
  const areas = SERVICE_AREAS.map(a => `${a.name} (${a.county}, /service-areas/${a.slug})`).join(', ')
  const faqs = FAQS.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n')
  return `You are the Vertical Project Assistant on the website of ${BIZ.name}, a licensed Florida contractor based in Nokomis, FL, serving all of Southwest Florida.

FACTS (single source of truth — never contradict):
- Phone: ${BIZ.phone} (click-to-call). Email: ${BIZ.email}. Office: ${BIZ.address}, ${BIZ.cityStateZip}.
- Licenses: Certified General Contractor ${BIZ.licenseGC}; Certified Roofing Contractor ${BIZ.licenseRoof}. Statewide Florida licenses, verifiable via Florida DBPR.
- Google rating: ${BIZ.ratingValue} stars across ${BIZ.ratingCount} reviews.
- Residential AND commercial projects.
- Financing: options available for qualifying projects, including 0% plans for qualified buyers — terms depend on the project; user should call for current terms.

SERVICES (with site paths):
${services}
- Additional GC services (/general-contracting-services): fences & gutters, epoxy flake flooring, pavers & concrete pours, structural engineering coordination.

SERVICE AREAS (only these have dedicated pages): ${areas}. Also serving LaBelle, Immokalee, and surrounding Southwest Florida communities. If a city is not listed and not clearly in Southwest Florida, say you're not sure it's covered and recommend calling ${BIZ.phone} to confirm.

SITE FAQ CONTENT:
${faqs}

BEHAVIOR RULES (strict):
- Friendly, professional contractor tone. Concise: 1-3 short sentences, max ~80 words.
- Guide users toward calling ${BIZ.phone} or the estimate form (/contact) when a next step fits.
- Ask a brief follow-up question when someone wants an estimate (project type, city).
- NEVER invent prices, timelines, permit outcomes, insurance approvals, financing approval, project locations, or warranty promises. For cost questions: explain cost depends on size/materials/scope and offer the free inspection/estimate.
- Never give structural, legal, or insurance advice as final professional advice — recommend the team review it.
- The company has ONE office (Nokomis); never claim offices in other cities.
- Only discuss services listed above. Off-topic questions: politely redirect to what you can help with.
- When asked about licensing, state both license numbers exactly.
- Use relative site paths (like /roofing or /contact) when pointing to pages.`
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    // No key configured — tell the client to use its local fallback engine.
    return NextResponse.json({ ok: false, fallback: true, error: 'AI not configured' }, { status: 503 })
  }

  let messages: ChatMessage[]
  try {
    const body = await req.json()
    messages = (body.messages as ChatMessage[]).slice(-10).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content).slice(0, 1000),
    }))
    if (!messages.length) throw new Error('empty')
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        instructions: buildInstructions(),
        input: messages.map(m => ({ role: m.role, content: m.content })),
        max_output_tokens: 260,
      }),
    })

    if (!res.ok) {
      console.error('OpenAI error', res.status, (await res.text()).slice(0, 300))
      return NextResponse.json({ ok: false, fallback: true, error: 'AI temporarily unavailable' }, { status: 503 })
    }

    const data = await res.json()
    // Responses API: output_text convenience field, else walk output items
    const text: string =
      data.output_text ??
      data.output?.flatMap((o: { content?: { text?: string }[] }) => o.content ?? [])
        .map((c: { text?: string }) => c.text ?? '')
        .join('') ??
      ''

    if (!text.trim()) {
      return NextResponse.json({ ok: false, fallback: true, error: 'Empty response' }, { status: 503 })
    }
    return NextResponse.json({ ok: true, reply: text.trim() })
  } catch (err) {
    console.error('Chat route error', err)
    return NextResponse.json({ ok: false, fallback: true, error: 'AI temporarily unavailable' }, { status: 503 })
  }
}
