/**
 * @vitest-environment jsdom
 *
 * ============================================================================
 * COMPONENT SMOKE TESTS
 * ----------------------------------------------------------------------------
 * These are not interaction tests. They answer three questions that matter for
 * a change order which promises "additive, and the CRM keeps working without
 * AI":
 *
 *   1. Does each new surface render at all?
 *   2. Does the no-key state render as a calm explanation rather than an error,
 *      a crash, or a dead button?
 *   3. Does the AI-generated labelling and the "nothing has been saved"
 *      language actually appear on screen, rather than only in the spec?
 *
 * Server actions are mocked. Nothing here reaches Supabase, OpenAI or the
 * network.
 * ============================================================================
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ usePathname: () => '/ops/dashboard' }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

// `useFormState` ships with the React canary that Next vendors; the standalone
// react-dom 18.3.1 in node_modules does not export it. The wrapper is stubbed
// rather than the whole of react-dom, which testing-library needs intact.
vi.mock('@/components/ops/Form', () => ({
  ActionForm: ({ children }: { children: (state: unknown) => React.ReactNode }) => (
    <form>{children({ ok: false, error: null, message: null, data: undefined })}</form>
  ),
  SubmitButton: ({ children }: { children: React.ReactNode }) => <button type="submit">{children}</button>,
  CheckField: ({ label, name }: { label: string; name: string }) => (
    <label><input type="checkbox" name={name} /> {label}</label>
  ),
}))

// Every server action. None is invoked by a render; they are mocked so that
// importing the components does not pull a server-only module in.
vi.mock('@/app/ops/actions/smart', () => ({
  generateSmartDashboardBriefAction: vi.fn(async () => ({ ok: false, error: null })),
  generateSmartAuditBriefAction: vi.fn(async () => ({ ok: false, error: null })),
  structureLeadWithSmartOpsAction: vi.fn(),
}))

vi.mock('@/app/ops/actions/ai', () => ({
  structureLeadAction: vi.fn(),
  enrichLeadAction: vi.fn(),
  draftLeadMessageAction: vi.fn(),
  analyzeCoiAction: vi.fn(),
  applyCoiExtractionAction: vi.fn(),
  rejectCoiExtractionAction: vi.fn(),
  generateAuditBriefAction: vi.fn(),
  generateDashboardBriefAction: vi.fn(),
  saveAiSettings: vi.fn(),
}))

import AssistantDrawer from '@/components/ops/AssistantDrawer'
import AssistantSettingsForm from '@/components/ops/AssistantSettingsForm'
import AuditBriefPanel from '@/components/ops/AuditBriefPanel'
import CoiExtractionReview, { AnalyzeCoiButton, type CoiDraftRow } from '@/components/ops/CoiExtraction'
import DailyBriefCard from '@/components/ops/DailyBriefCard'
import { LeadStructurePanel } from '@/components/ops/LeadAiAssist'
import { coiExtractionSchema } from '@/lib/ops/ai/schemas'

afterEach(cleanup)

const ON = { configured: true, enabled: true }
const OFF = { configured: false, enabled: false }
const AI_ON = { aiConfigured: true, aiEnabled: true }
const AI_OFF = { aiConfigured: false, aiEnabled: false }

describe('the assistant drawer', () => {
  it('renders its trigger in AI Enhanced mode', () => {
    render(<AssistantDrawer {...AI_ON} canSeeFinancials canWrite />)
    const trigger = screen.getByRole('button', { name: /vertical assistant/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
  })

  it('is NEVER disabled without a key — Smart Ops still answers', () => {
    // This is the whole point of the hybrid design. Before this change the
    // button was greyed out with "AI is not configured"; now it works.
    render(<AssistantDrawer {...AI_OFF} canSeeFinancials={false} canWrite={false} />)
    const trigger = screen.getByRole('button', { name: /vertical assistant/i })
    expect(trigger.hasAttribute('disabled')).toBe(false)
  })

  it('is still usable when only the AI layer is switched off', () => {
    render(<AssistantDrawer aiConfigured aiEnabled={false} canSeeFinancials canWrite />)
    const trigger = screen.getByRole('button', { name: /vertical assistant/i })
    expect(trigger.hasAttribute('disabled')).toBe(false)
  })

  it('starts closed — no dialog until someone opens it', () => {
    render(<AssistantDrawer {...AI_ON} canSeeFinancials canWrite />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the Smart Ops badge and the no-API-usage note when there is no key', async () => {
    render(<AssistantDrawer {...AI_OFF} canSeeFinancials canWrite />)
    await userEvent.click(screen.getByRole('button', { name: /vertical assistant/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/Smart Ops/)
    expect(dialog.textContent).toMatch(/No AI API usage/i)
    expect(dialog.textContent).not.toMatch(/AI Enhanced/)
  })

  it('shows the AI Enhanced badge when a key is configured', async () => {
    render(<AssistantDrawer {...AI_ON} canSeeFinancials canWrite />)
    await userEvent.click(screen.getByRole('button', { name: /vertical assistant/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/AI Enhanced/)
    expect(dialog.textContent).toMatch(/grounded in permitted CRM data/i)
  })

  it('offers only built-in commands as starter chips', async () => {
    const { parseIntent } = await import('@/lib/ops/smart/intents')
    render(<AssistantDrawer {...AI_OFF} canSeeFinancials canWrite />)
    await userEvent.click(screen.getByRole('button', { name: /vertical assistant/i }))
    const chips = Array.from(screen.getByRole('dialog').querySelectorAll('.ops-ai-chips button'))
    expect(chips.length).toBeGreaterThan(2)
    for (const chip of chips) {
      // A chip that only worked with a paid key would be a broken promise.
      expect(parseIntent(chip.textContent ?? ''), `chip "${chip.textContent}" is not a built-in command`).not.toBeNull()
    }
  })
})

describe('the daily brief card', () => {
  it('renders as a built-in Smart Brief', () => {
    render(<DailyBriefCard {...AI_OFF} />)
    expect(screen.getByRole('heading', { name: /Vertical Smart Brief/i })).toBeDefined()
    expect(screen.getAllByText(/Built-in/i).length).toBeGreaterThan(0)
  })

  it('never calls the AI action on mount, with or without a key', async () => {
    const { generateDashboardBriefAction } = await import('@/app/ops/actions/ai')
    render(<DailyBriefCard {...AI_ON} />)
    // An AI call on every dashboard visit would be a recurring bill for a
    // rewording of numbers the user can already read.
    expect(generateDashboardBriefAction).not.toHaveBeenCalled()
  })

  it('tells the user AI Enhanced is not activated, without calling it an error', () => {
    render(<DailyBriefCard {...AI_OFF} />)
    expect(screen.getByText(/AI Enhanced is not activated/i)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the AI enhancement only when a key is configured', () => {
    const { unmount } = render(<DailyBriefCard {...AI_OFF} />)
    expect(screen.queryByRole('button', { name: /Enhance summary with AI/i })).toBeNull()
    unmount()
    render(<DailyBriefCard {...AI_ON} />)
    expect(screen.getByRole('button', { name: /Enhance summary with AI/i })).toBeDefined()
  })
})

describe('the lead structuring panel', () => {
  it('offers built-in extraction when there is no key', () => {
    render(<LeadStructurePanel aiConfigured={false} onDraft={() => undefined} onFields={() => undefined} />)
    expect(screen.getByRole('heading', { name: /Structure with Smart Ops/i })).toBeDefined()
    expect(screen.getByText(/It does not guess/i)).toBeDefined()
  })

  it('is honest about the limits of the built-in parser', () => {
    render(<LeadStructurePanel aiConfigured={false} onDraft={() => undefined} onFields={() => undefined} />)
    expect(screen.getByText(/reads labelled lines/i)).toBeDefined()
    expect(screen.getByText(/AI Enhanced reads messy prose/i)).toBeDefined()
  })

  it('switches to AI structuring when a key is configured', () => {
    render(<LeadStructurePanel aiConfigured onDraft={() => undefined} onFields={() => undefined} />)
    expect(screen.getByRole('heading', { name: /Structure with AI/i })).toBeDefined()
    expect(screen.queryByText(/AI Enhanced reads messy prose/i)).toBeNull()
  })
})

describe('the COI extraction surfaces', () => {
  const draft: CoiDraftRow = {
    id: '00000000-0000-4000-b000-000000000001',
    documentId: '00000000-0000-4000-c000-000000000001',
    filename: 'zz-roofing-coi.pdf',
    status: 'pending',
    // Built through the schema rather than by hand, so the fixture matches what
    // the application actually stores.
    extracted: coiExtractionSchema.parse({
      namedInsured: 'ZZ Roofing LLC',
      producer: 'Gulf Coast Insurance',
      coverages: [{
        coverageType: 'general_liability', carrier: 'Acme Mutual', policyNumber: 'GL-1',
        effectiveDate: '2026-01-01', expirationDate: null, eachOccurrence: 1_000_000,
        confidence: 0.5,
      }],
    }),
    lowConfidenceFields: ['coverages.0 — no expiration date was found'],
    createdAt: '2026-08-21T10:00:00.000Z',
  }

  it('renders the analyse button, disabled when AI is unavailable', () => {
    render(<AnalyzeCoiButton documentId={draft.documentId} {...OFF} />)
    const button = screen.getAllByRole('button')[0] as HTMLButtonElement
    expect(button.disabled).toBe(true)
    // No fake OCR stands in for it, and manual entry is named as the way through.
    expect(screen.getByText(/enter the coverage lines by hand/i)).toBeDefined()
    expect(button.getAttribute('title')).toMatch(/AI Enhanced — requires activation/i)
  })

  it('enables the analyse button once AI is on', () => {
    render(<AnalyzeCoiButton documentId={draft.documentId} {...ON} />)
    expect((screen.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders the review screen with an unverified label and editable fields', () => {
    render(<CoiExtractionReview draft={draft} />)
    expect(screen.getByText(/not yet verified/i)).toBeDefined()
    // Everything the model produced is an input the reviewer can correct.
    expect((screen.getByDisplayValue('Acme Mutual') as HTMLInputElement).tagName).toBe('INPUT')
    expect(screen.getByDisplayValue('GL-1')).toBeDefined()
  })

  it('surfaces what the model was unsure about rather than presenting it as fact', () => {
    render(<CoiExtractionReview draft={draft} />)
    expect(screen.getAllByText(/no expiration date was found/i).length).toBeGreaterThan(0)
  })

  it('renders nothing for a draft that has already been applied', () => {
    const { container } = render(<CoiExtractionReview draft={{ ...draft, status: 'applied' }} />)
    expect(container.textContent).toBe('')
  })
})

describe('the audit brief panel', () => {
  it('renders alongside the existing audit package', () => {
    render(<AuditBriefPanel aiConfigured period={{ start: '2026-01-01', end: '2026-08-21' }} />)
    expect(screen.getByRole('heading', { name: /Smart Audit Brief/i })).toBeDefined()
  })

  it('says the audit package still works without a key', () => {
    render(<AuditBriefPanel aiConfigured={false} period={null} />)
    expect(screen.getByText(/Same numbers as the compliance register, no AI API usage/i)).toBeDefined()
  })
})

describe('Settings → Assistant', () => {
  const settings = {
    ai_copilot_enabled: true,
    ai_coi_extraction_enabled: true,
    ai_dashboard_brief_enabled: false,
  }
  const status = (openaiConfigured: boolean) => ({
    openaiConfigured, opsModel: 'gpt-4o-mini', estimateModel: 'gpt-4o-mini',
  })

  it('presents the two layers separately, because the difference is a bill', () => {
    render(<AssistantSettingsForm settings={settings} status={status(true)} />)
    expect(screen.getByRole('heading', { name: /^Smart Ops$/ })).toBeDefined()
    expect(screen.getByRole('heading', { name: /^AI Enhanced$/ })).toBeDefined()
  })

  it('states that Smart Ops needs no provider and costs nothing per question', () => {
    render(<AssistantSettingsForm settings={settings} status={status(false)} />)
    expect(screen.getByText(/no external AI provider required/i)).toBeDefined()
    expect(screen.getByText(/No AI API usage/i)).toBeDefined()
  })

  it('lists the Smart Ops capabilities', () => {
    const { container } = render(<AssistantSettingsForm settings={settings} status={status(false)} />)
    for (const capability of [/audit readiness/i, /expiration/i, /calculation/i, /templates/i]) {
      expect(container.textContent, String(capability)).toMatch(capability)
    }
  })

  it('says AI Enhanced is not activated, and that the provider bills for it', () => {
    render(<AssistantSettingsForm settings={settings} status={status(false)} />)
    expect(screen.getAllByText(/Not activated/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/billed by the configured AI provider/i)).toBeDefined()
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeDefined()
  })

  it('reports the model in use once a key is configured', () => {
    render(<AssistantSettingsForm settings={settings} status={status(true)} />)
    expect(screen.getAllByText(/gpt-4o-mini/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Configured/).length).toBeGreaterThan(0)
  })

  it('never renders the key, only whether one is present', () => {
    const { container } = render(<AssistantSettingsForm settings={settings} status={status(true)} />)
    expect(container.textContent).toMatch(/never sent to the browser/i)
    expect(container.textContent).not.toMatch(/sk-/)
  })

  it('never implies Smart Ops carries an AI charge', () => {
    const { container } = render(<AssistantSettingsForm settings={settings} status={status(false)} />)
    const smartSection = container.textContent?.slice(0, container.textContent.indexOf('AI Enhanced')) ?? ''
    // "Nothing is charged per question" is the correct thing to say, so the
    // assertion is about a POSITIVE charge claim, not the word itself.
    expect(smartSection).not.toMatch(/usage charges|billed by|charged per (question|request|token)(?!\.)/i)
    expect(smartSection).toMatch(/No AI API usage/i)
  })
})
