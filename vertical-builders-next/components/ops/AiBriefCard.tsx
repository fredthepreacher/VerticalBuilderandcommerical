'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Sparkles, RefreshCw, AlertTriangle } from 'lucide-react'
import { generateDashboardBriefAction } from '@/app/ops/actions/ai'
import type { DashboardBrief } from '@/lib/ops/ai/schemas'
import { formatDateTime } from '@/lib/ops/utils/dates'

/**
 * The dashboard brief.
 *
 * Nothing happens on page load — the card sits there until someone presses the
 * button. An AI call on every dashboard visit would be a slow, recurring bill
 * for a summary most visits do not need. Once generated, the same brief is
 * reused for the rest of the day unless the user asks for a refresh.
 */
export default function AiBriefCard({
  configured,
  enabled,
}: {
  configured: boolean
  enabled: boolean
}) {
  const [brief, setBrief] = useState<DashboardBrief | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function generate(force: boolean) {
    setError(null)
    start(async () => {
      const result = await generateDashboardBriefAction(force)
      if (result.ok === false) { setError(result.error ?? 'The brief could not be generated.'); return }
      const raw = result.data?.brief
      if (typeof raw === 'string') {
        try { setBrief(JSON.parse(raw) as DashboardBrief) } catch { setError('The brief could not be read.') }
      }
      setGeneratedAt(typeof result.data?.generatedAt === 'string' ? result.data.generatedAt : new Date().toISOString())
      setCached(result.data?.cached === 'true')
    })
  }

  if (!configured || !enabled) {
    return (
      <section className="ops-card">
        <div className="ops-card-head">
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
          <h2>Vertical AI Brief</h2>
        </div>
        <div className="ops-card-body">
          <p className="ops-hint">
            {!configured
              ? 'AI is not configured. Add an OpenAI key to get a prioritised daily summary — everything on this dashboard works without it.'
              : 'The AI brief is switched off in Settings → AI.'}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
        <h2>Vertical AI Brief</h2>
        <div className="ops-card-actions">
          {brief && (
            <button type="button" className="ops-btn ops-btn-sm" onClick={() => generate(true)} disabled={pending}>
              <RefreshCw aria-hidden="true" /> Refresh
            </button>
          )}
        </div>
      </div>

      <div className="ops-card-body">
        {!brief && !pending && (
          <>
            <p className="ops-hint" style={{ marginBottom: 12 }}>
              A short, prioritised summary of what needs attention. The counts come from your
              records; the AI only decides what matters most.
            </p>
            <button type="button" className="ops-btn ops-btn-sm ops-btn-primary" onClick={() => generate(false)}>
              <Sparkles aria-hidden="true" /> Generate brief
            </button>
          </>
        )}

        {pending && <p className="ops-hint">Reading your records…</p>}

        {error && (
          <div className="ops-banner bad" style={{ marginTop: 8 }}>
            <AlertTriangle aria-hidden="true" />
            <div>{error}</div>
          </div>
        )}

        {brief && !pending && (
          <div className="ops-ai-brief">
            <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated</span>
            <p className="ops-ai-brief-headline">{brief.headline}</p>
            {brief.bullets.length > 0 && (
              <ul>{brief.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
            )}
            {brief.topPriority && (
              <div className="ops-ai-brief-priority"><strong>Start here:</strong> {brief.topPriority}</div>
            )}
            <div className="ops-ai-cites">
              <Link href="/ops/compliance?status=expiring_soon" className="ops-chip ops-chip-link">Expiring coverage</Link>
              <Link href="/ops/compliance?status=non_compliant" className="ops-chip ops-chip-link">Compliance problems</Link>
              <Link href="/ops/leads" className="ops-chip ops-chip-link">Leads</Link>
            </div>
            <p className="ops-ai-brief-meta">
              {cached ? 'Generated earlier today' : 'Generated'}
              {generatedAt ? ` · ${formatDateTime(generatedAt)}` : ''}
              {' · figures come from your records, wording from AI'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
