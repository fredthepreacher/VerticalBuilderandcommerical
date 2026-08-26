/**
 * Context-aware starter prompts.
 *
 * Pure and client-safe on purpose: the Copilot drawer is a client component, so
 * this cannot live in `copilot.ts`, which is `server-only`. Keeping it separate
 * also means the chips render instantly without a round trip.
 */
export function suggestedPrompts(
  pathname: string,
  opts: { canSeeFinancials: boolean; canWrite: boolean },
): string[] {
  const p = pathname || ''
  if (p.startsWith('/ops/subcontractors') || p.startsWith('/ops/compliance')) {
    return [
      'Who is missing paperwork?',
      'What expires in the next 60 days?',
      'Which subcontractors are not compliant?',
    ]
  }
  if (p.startsWith('/ops/audits')) {
    return ['What will block my next audit?', 'Summarise audit readiness.', 'What needs human review?']
  }
  if (p.startsWith('/ops/leads')) {
    return [
      'Which leads need follow-up?',
      'Summarise my newest leads.',
      ...(opts.canWrite ? ['Help me create a lead from notes.'] : []),
    ]
  }
  if (p.startsWith('/ops/invoices') && opts.canSeeFinancials) {
    return ['What invoices are unpaid?', 'Summarise outstanding receivables.']
  }
  if (p.startsWith('/ops/projects') || p.startsWith('/ops/schedule')) {
    return ['What jobs are active this week?', 'What is starting in the next 7 days?']
  }
  return [
    'What needs my attention today?',
    'Show compliance problems.',
    'What is expiring soon?',
    'What work is active?',
  ]
}
