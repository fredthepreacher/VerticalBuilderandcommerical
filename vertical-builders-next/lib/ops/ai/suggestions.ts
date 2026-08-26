/**
 * Context-aware starter prompts.
 *
 * Pure and client-safe on purpose: the assistant drawer is a client component,
 * so this cannot live in a `server-only` module. Keeping it separate also means
 * the chips render instantly without a round trip.
 *
 * Every chip here is a phrase the DETERMINISTIC Smart Ops parser recognises.
 * That matters: the chips are the product's promise about what it can do, and
 * a chip that only works once someone pays for an API key would be a broken
 * promise. Free-form questions are still allowed by typing; they are simply not
 * advertised as built-in.
 */
export function suggestedPrompts(
  pathname: string,
  opts: { canSeeFinancials: boolean; canWrite: boolean },
): string[] {
  const p = pathname || ''

  if (p.startsWith('/ops/subcontractors') || p.startsWith('/ops/compliance')) {
    return [
      'Who is missing paperwork?',
      'Show insurance expiring in 60 days',
      'Give me a COI renewal template',
    ]
  }
  if (p.startsWith('/ops/audits')) {
    return ['What is my audit readiness?', 'Who is missing paperwork?', 'Show insurance expiring in 30 days']
  }
  if (p.startsWith('/ops/leads')) {
    return [
      'Which leads need follow-up?',
      ...(opts.canWrite ? ['Give me a lead follow-up template'] : []),
      'What needs my attention today?',
    ]
  }
  if (p.startsWith('/ops/invoices') && opts.canSeeFinancials) {
    return ['Show unpaid invoices', 'What needs my attention today?', 'What is 15% of 2500?']
  }
  if (p.startsWith('/ops/estimates')) {
    return ['Show open estimates', 'Add a 20% markup to 1800', 'What is my audit readiness?']
  }
  if (p.startsWith('/ops/projects') || p.startsWith('/ops/schedule')) {
    return [
      'What jobs are active this week?',
      ...(opts.canSeeFinancials ? ['Profit on the Miller residence'] : []),
      'What needs my attention today?',
    ]
  }
  return [
    'What needs my attention today?',
    'Show insurance expiring in 45 days',
    'Who is missing paperwork?',
    'What is my audit readiness?',
  ]
}
