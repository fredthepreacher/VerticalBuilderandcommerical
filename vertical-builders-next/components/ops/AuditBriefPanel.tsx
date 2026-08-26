'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Sparkles, Gauge, AlertTriangle, FileArchive } from 'lucide-react'
import { generateAuditBriefAction } from '@/app/ops/actions/ai'
import { generateSmartAuditBriefAction } from '@/app/ops/actions/smart'
import type { AuditBrief } from '@/lib/ops/ai/schemas'
import type { SmartAuditBrief } from '@/lib/ops/smart/briefs'

/**
 * ============================================================================
 * AUDIT BRIEF — built-in, with an optional AI rewording
 * ----------------------------------------------------------------------------
 * The Smart Audit Brief is the primary. It runs the same compliance evaluator
 * the register runs, and reports what it found. It needs no API key.
 *
 * "Enhance wording with AI" is exactly that — a rewording. The deterministic
 * facts above it remain on screen and remain authoritative. If the two ever
 * disagree, the built-in one is right, and the layout says so rather than
 * leaving the reader to guess.
 *
 * The audit package itself is untouched: the ZIP is still built by the same
 * deterministic code, and it is still the document of record.
 * ============================================================================
 */
export default function AuditBriefPanel({
  aiConfigured,
  period,
}: {
  aiConfigured: boolean
  period: { start: string; end: string } | null
}) {
  const [smart, setSmart] = useState<SmartAuditBrief | null>(null)
  const [ai, setAi] = useState<AuditBrief | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSmart, startSmart] = useTransition()
  const [loadingAi, startAi] = useTransition()

  function generateSmart() {
    setError(null)
    startSmart(async () => {
      const result = await generateSmartAuditBriefAction(period)
      if (result.ok === false) { setError(result.error ?? 'The brief could not be built.'); return }
      const raw = result.data?.brief
      if (typeof raw === 'string') {
        try { setSmart(JSON.parse(raw) as SmartAuditBrief) } catch { setError('The brief could not be read.') }
      }
    })
  }

  function enhance() {
    setError(null)
    startAi(async () => {
      const result = await generateAuditBriefAction(period)
      if (result.ok === false) { setError(result.error ?? 'The AI summary could not be generated.'); return }
      const raw = result.data?.brief
      if (typeof raw === 'string') {
        try { setAi(JSON.parse(raw) as AuditBrief) } catch { setError('The AI summary could not be read.') }
      }
    })
  }

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Gauge aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
        <h2>Smart Audit Brief</h2>
        <span className="ops-mode-badge">Built-in</span>
        <div className="ops-card-actions">
          <button
            type="button" className="ops-btn ops-btn-sm ops-btn-primary" disabled={loadingSmart}
            onClick={generateSmart}
          >
            <Gauge aria-hidden="true" />
            {loadingSmart ? 'Evaluating…' : smart ? 'Regenerate' : 'Generate Smart Audit Brief'}
          </button>
        </div>
      </div>

      <div className="ops-card-body">
        {!smart && !loadingSmart && !error && (
          <p className="ops-hint">
            Runs the compliance evaluator across every subcontractor and reports what would block
            an audit. Same numbers as the compliance register, no AI API usage.
          </p>
        )}

        {loadingSmart && <p className="ops-hint">Evaluating every subcontractor…</p>}

        {error && (
          <div className="ops-banner bad"><AlertTriangle aria-hidden="true" /><div>{error}</div></div>
        )}

        {smart && !loadingSmart && (
          <div className="ops-ai-brief">
            <p style={{ fontSize: '.87rem', lineHeight: 1.6, margin: 0 }}>{smart.executiveSummary}</p>

            <div className="ops-ai-brief-priority">{smart.readinessStatement}</div>

            {smart.facts.length > 0 && (
              <div className="ops-smart-facts">
                {smart.facts.map(fact => (
                  <div key={fact.label} className={`ops-smart-fact tone-${fact.tone ?? 'neutral'}`}>
                    <span className="ops-smart-fact-value">{fact.value}</span>
                    <span className="ops-smart-fact-label">{fact.label}</span>
                  </div>
                ))}
              </div>
            )}

            <Section title="Critical blockers" items={smart.criticalBlockers} tone="bad" />
            <Section title="Expiring soon" items={smart.expiringSoon} tone="warn" />
            <Section title="Missing paperwork" items={smart.missingPaperwork} tone="warn" />
            <Section title="Needs human review" items={smart.needsHumanReview} tone="info" />
            <Section title="Recommended actions" items={smart.recommendedActions} tone="neutral" />

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

        {/* ---- Optional AI rewording --------------------------------------- */}
        {aiConfigured && smart && !ai && !loadingAi && (
          <button type="button" className="ops-btn ops-btn-sm" style={{ marginTop: 12 }} onClick={enhance}>
            <Sparkles aria-hidden="true" /> Enhance wording with AI
          </button>
        )}

        {loadingAi && <p className="ops-hint" style={{ marginTop: 12 }}>Asking the AI service…</p>}

        {ai && !loadingAi && (
          <div className="ops-ai-brief" style={{ marginTop: 14 }}>
            <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated wording</span>
            <p style={{ fontSize: '.87rem', lineHeight: 1.6, margin: 0 }}>{ai.executiveSummary}</p>
            {ai.readinessStatement && <div className="ops-ai-brief-priority">{ai.readinessStatement}</div>}
            <Section title="Critical blockers" items={ai.criticalBlockers} tone="bad" />
            <Section title="Expiring soon" items={ai.expiringSoon} tone="warn" />
            <Section title="Missing paperwork" items={ai.missingPaperwork} tone="warn" />
            <Section title="Needs human review" items={ai.needsHumanReview} tone="info" />
            <Section title="Recommended actions" items={ai.recommendedActions} tone="neutral" />
            <p className="ops-hint">
              Rewording only. Where this differs from the built-in brief above, the built-in brief
              is the one to trust — its figures come straight from the evaluator.
            </p>
          </div>
        )}

        {!aiConfigured && smart && (
          <p className="ops-hint" style={{ marginTop: 12 }}>
            AI Enhanced is not activated. This brief is built in and always available.
          </p>
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
