'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Sparkles, AlertTriangle, FileArchive } from 'lucide-react'
import { generateAuditBriefAction } from '@/app/ops/actions/ai'
import type { AuditBrief } from '@/lib/ops/ai/schemas'

/**
 * AI Audit Brief.
 *
 * Sits alongside the existing audit package, which is untouched — the ZIP is
 * still built by the same deterministic code and still contains the same
 * register, spreadsheets and per-vendor folders.
 *
 * Every figure in the brief comes from `collectAuditFacts`, which runs the real
 * compliance evaluator. The model orders and phrases; it does not count, and it
 * does not decide whether an audit is passed.
 */
export default function AuditBriefPanel({
  configured,
  period,
}: {
  configured: boolean
  period: { start: string; end: string } | null
}) {
  const [brief, setBrief] = useState<AuditBrief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!configured) {
    return (
      <section className="ops-card">
        <div className="ops-card-head">
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-muted)' }} />
          <h2>AI Audit Brief</h2>
        </div>
        <div className="ops-card-body">
          <p className="ops-hint">
            Not configured. With an OpenAI key this summarises what would block your next audit.
            The audit package itself does not need it and works exactly as before.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
        <h2>AI Audit Brief</h2>
        <div className="ops-card-actions">
          <button
            type="button" className="ops-btn ops-btn-sm ops-btn-primary" disabled={pending}
            onClick={() => {
              setError(null)
              start(async () => {
                const result = await generateAuditBriefAction(period)
                if (result.ok === false) { setError(result.error ?? 'The brief could not be generated.'); return }
                const raw = result.data?.brief
                if (typeof raw === 'string') {
                  try { setBrief(JSON.parse(raw) as AuditBrief) } catch { setError('The brief could not be read.') }
                }
              })
            }}
          >
            <Sparkles aria-hidden="true" /> {pending ? 'Reviewing…' : brief ? 'Regenerate' : 'Generate AI Audit Brief'}
          </button>
        </div>
      </div>

      <div className="ops-card-body">
        {!brief && !pending && !error && (
          <p className="ops-hint">
            Reads the current compliance state of every subcontractor and writes a plain-language
            summary of what needs fixing before an audit. The numbers come from the same evaluator
            that drives the compliance register.
          </p>
        )}

        {pending && <p className="ops-hint">Evaluating every subcontractor…</p>}

        {error && (
          <div className="ops-banner bad"><AlertTriangle aria-hidden="true" /><div>{error}</div></div>
        )}

        {brief && !pending && (
          <div className="ops-ai-brief">
            <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated</span>
            <p style={{ fontSize: '.87rem', lineHeight: 1.6, margin: 0 }}>{brief.executiveSummary}</p>

            {brief.readinessStatement && (
              <div className="ops-ai-brief-priority">{brief.readinessStatement}</div>
            )}

            <Section title="Critical blockers" items={brief.criticalBlockers} tone="bad" />
            <Section title="Expiring soon" items={brief.expiringSoon} tone="warn" />
            <Section title="Missing paperwork" items={brief.missingPaperwork} tone="warn" />
            <Section title="Needs human review" items={brief.needsHumanReview} tone="info" />
            <Section title="Recommended actions" items={brief.recommendedActions} tone="neutral" />

            <div className="ops-ai-cites">
              <Link href="/ops/compliance?status=non_compliant" className="ops-chip ops-chip-link">
                Non-compliant subcontractors
              </Link>
              <Link href="/ops/compliance?status=expiring_soon" className="ops-chip ops-chip-link">
                Expiring coverage
              </Link>
              <Link href="/ops/subcontractors" className="ops-chip ops-chip-link">All subcontractors</Link>
            </div>

            <p className="ops-hint" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <FileArchive aria-hidden="true" style={{ width: 13, height: 13, flex: 'none', marginTop: 2 }} />
              This is a summary of statuses the system calculated — not an audit result, and not a
              legal opinion. The audit package above is unchanged and remains the document of record.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (items.length === 0) return null
  return (
    <div className="ops-ai-section">
      <h4 style={tone === 'bad' ? { color: 'var(--ops-bad)' } : undefined}>{title}</h4>
      <ul>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div>
  )
}
