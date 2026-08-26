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

// Every AI server action. None is invoked by a render; they are mocked so that
// importing the components does not pull the server-only action module in.
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

import AiBriefCard from '@/components/ops/AiBriefCard'
import AiSettingsForm from '@/components/ops/AiSettingsForm'
import AuditBriefPanel from '@/components/ops/AuditBriefPanel'
import CoiExtractionReview, { AnalyzeCoiButton, type CoiDraftRow } from '@/components/ops/CoiExtraction'
import CopilotDrawer from '@/components/ops/CopilotDrawer'
import { LeadStructurePanel } from '@/components/ops/LeadAiAssist'
import { coiExtractionSchema } from '@/lib/ops/ai/schemas'

afterEach(cleanup)

const ON = { configured: true, enabled: true }
const OFF = { configured: false, enabled: false }

describe('the Copilot drawer', () => {
  it('renders its trigger when AI is available', () => {
    render(<CopilotDrawer {...ON} canSeeFinancials canWrite />)
    const trigger = screen.getByRole('button', { name: /ask vertical ai/i })
    expect(trigger).toBeDefined()
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
  })

  it('starts closed — no dialog until someone opens it', () => {
    render(<CopilotDrawer {...ON} canSeeFinancials canWrite />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('disables the trigger and explains why when no key is set', () => {
    render(<CopilotDrawer {...OFF} canSeeFinancials={false} canWrite={false} />)
    const trigger = screen.getByRole('button', { name: /ask vertical ai/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    expect(trigger.getAttribute('title')).toMatch(/not configured/i)
  })

  it('explains the switched-off state differently from the unconfigured one', () => {
    render(<CopilotDrawer configured enabled={false} canSeeFinancials canWrite />)
    const trigger = screen.getByRole('button', { name: /ask vertical ai/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    expect(trigger.getAttribute('title')).toMatch(/switched off in Settings/i)
  })
})

describe('the dashboard brief card', () => {
  it('renders with a generate button and does not call anything on mount', async () => {
    const { generateDashboardBriefAction } = await import('@/app/ops/actions/ai')
    render(<AiBriefCard {...ON} />)
    expect(screen.getByRole('heading', { name: /Vertical AI Brief/i })).toBeDefined()
    // An AI call on every dashboard visit would be a recurring bill for a
    // summary most visits do not need.
    expect(generateDashboardBriefAction).not.toHaveBeenCalled()
  })

  it('renders the no-key state as an explanation, not an error', () => {
    render(<AiBriefCard configured={false} enabled />)
    expect(screen.getByText(/AI is not configured/i)).toBeDefined()
    expect(screen.getByText(/works without it/i)).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('distinguishes switched-off from unconfigured', () => {
    render(<AiBriefCard configured enabled={false} />)
    expect(screen.getByText(/switched off in Settings/i)).toBeDefined()
  })
})

describe('the lead AI assist panel', () => {
  it('renders the notes panel when configured', () => {
    render(<LeadStructurePanel configured onDraft={() => undefined} />)
    expect(screen.getByRole('heading', { name: /Structure with AI/i })).toBeDefined()
  })

  it('says the form still works without a key', () => {
    render(<LeadStructurePanel configured={false} onDraft={() => undefined} />)
    expect(screen.getByText(/Not configured/i)).toBeDefined()
    expect(screen.getByText(/works exactly as usual without it/i)).toBeDefined()
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
    expect(button.getAttribute('title')).toMatch(/not configured/i)
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
    render(<AuditBriefPanel configured period={{ start: '2026-01-01', end: '2026-08-21' }} />)
    expect(screen.getByRole('heading', { name: /AI Audit Brief/i })).toBeDefined()
  })

  it('says the audit package still works without a key', () => {
    render(<AuditBriefPanel configured={false} period={null} />)
    expect(screen.getByText(/does not need it and works exactly as before/i)).toBeDefined()
  })
})

describe('Settings → AI', () => {
  const settings = {
    ai_copilot_enabled: true,
    ai_coi_extraction_enabled: true,
    ai_dashboard_brief_enabled: false,
  }

  it('renders the three feature switches and the model in use', () => {
    render(<AiSettingsForm settings={settings} status={{
      openaiConfigured: true, opsModel: 'gpt-4o-mini', estimateModel: 'gpt-4o-mini',
    }} />)
    expect(screen.getByText(/AI configuration/i)).toBeDefined()
    expect(screen.getAllByText(/gpt-4o-mini/).length).toBeGreaterThan(0)
  })

  it('never renders the key, only whether one is present', () => {
    const { container } = render(<AiSettingsForm settings={settings} status={{
      openaiConfigured: true, opsModel: 'gpt-4o-mini', estimateModel: 'gpt-4o-mini',
    }} />)
    expect(container.textContent).toMatch(/Configured/)
    expect(container.textContent).toMatch(/never sent to the browser/i)
    expect(container.textContent).not.toMatch(/sk-/)
  })

  it('tells an operator exactly which variable to set when nothing is configured', () => {
    render(<AiSettingsForm settings={settings} status={{
      openaiConfigured: false, opsModel: 'gpt-4o-mini', estimateModel: 'gpt-4o-mini',
    }} />)
    expect(screen.getByText(/OPENAI_API_KEY/)).toBeDefined()
    expect(screen.getByText(/fully usable\s+without it/i)).toBeDefined()
  })
})
