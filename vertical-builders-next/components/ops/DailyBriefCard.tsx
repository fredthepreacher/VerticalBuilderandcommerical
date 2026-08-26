'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Sparkles, Gauge, RefreshCw, AlertTriangle } from 'lucide-react'
import { generateDashboardBriefAction } from '@/app/ops/actions/ai'
import { generateSmartDashboardBriefAction } from '@/app/ops/actions/smart'
import type { DashboardBrief } from '@/lib/ops/ai/schemas'
import type { SmartBrief } from '@/lib/ops/smart/briefs'
import { formatDateTime } from '@/lib/ops/utils/dates'

/**
 * ============================================================================
 * THE DAILY BRIEF
 * ----------------------------------------------------------------------------
 * The built-in Smart Brief generates on mount and costs nothing — it is a
 * handful of counts the dashboard is already close to having. That is the whole
 * argument for the deterministic layer: the owner opens Vertical Ops and is
 * told what needs attention, with no API key and no bill.
 *
 * "Enhance with AI" is a separate, explicit button. It never fires on its own,
 * because an automatic AI call on every dashboard visit is a recurring charge
 * for a rewording of numbers the user can already read.
 * ============================================================================
 */
export default function DailyBriefCard({
  aiConfigured,
  aiEnabled,
}: {
  aiConfigured: boolean
  aiEnabled: boolean
}) {
  const [smart, setSmart] = useState<SmartBrief | null>(null)
  const [ai, setAi] = useState<DashboardBrief | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingSmart, startSmart] = useTransition()
  const [loadingAi, startAi] = useTransition()

  const aiActivated = aiConfigured && aiEnabled

  const loadSmart = () => {
    setError(null)
    startSmart(async () => {
      const result = await generateSmartDashboardBriefAction()
      if (result.ok === false) { setError(result.error ?? 'The brief could not be built.'); return }
      const raw = result.data?.brief
      if (typeof raw === 'string') {
        try { setSmart(JSON.parse(raw) as SmartBrief) } catch { setError('The brief could not be read.') }
      }
      setGeneratedAt(typeof result.data?.generatedAt === 'string' ? result.data.generatedAt : new Date().toISOString())
    })
  }

  // Deterministic and cheap, so it runs on arrival. Nothing leaves the server.
  useEffect(() => {
    loadSmart()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function enhance(force: boolean) {
    setError(null)
    startAi(async () => {
      const result = await generateDashboardBriefAction(force)
      if (result.ok === false) { setError(result.error ?? 'The AI summary could not be generated.'); return }
      const raw = result.data?.brief
      if (typeof raw === 'string') {
        try { setAi(JSON.parse(raw) as DashboardBrief) } catch { setError('The AI summary could not be read.') }
      }
      setCached(result.data?.cached === 'true')
    })
  }

  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Gauge aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
        <h2>Vertical Smart Brief</h2>
        <span className="ops-mode-badge">Built-in</span>
        <div className="ops-card-actions">
          <button type="button" className="ops-btn ops-btn-sm" onClick={loadSmart} disabled={loadingSmart}>
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      <div className="ops-card-body">
        {loadingSmart && !smart && <p className="ops-hint">Reading your records…</p>}

        {error && (
          <div className="ops-banner bad" style={{ marginBottom: 10 }}>
            <AlertTriangle aria-hidden="true" />
            <div>{error}</div>
          </div>
        )}

        {smart && (
          <div className="ops-ai-brief">
            <p className="ops-ai-brief-headline">{smart.headline}</p>

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

            {smart.bullets.length > 0 && <ul>{smart.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}

            {smart.topPriority && (
              <div className="ops-ai-brief-priority"><strong>Start here:</strong> {smart.topPriority}</div>
            )}

            {smart.actions.length > 0 && (
              <div className="ops-ai-cites">
                {smart.actions.map(action => (
                  action.href
                    ? <Link key={action.label} href={action.href} className="ops-chip ops-chip-link">{action.label}</Link>
                    : null
                ))}
              </div>
            )}

            <p className="ops-ai-brief-meta">
              Built from your records{generatedAt ? ` · ${formatDateTime(generatedAt)}` : ''} · no AI API usage
            </p>
          </div>
        )}

        {/* ---- Optional AI layer ------------------------------------------ */}
        {aiActivated && !ai && !loadingAi && (
          <button type="button" className="ops-btn ops-btn-sm" style={{ marginTop: 12 }} onClick={() => enhance(false)}>
            <Sparkles aria-hidden="true" /> Enhance summary with AI
          </button>
        )}

        {loadingAi && <p className="ops-hint" style={{ marginTop: 12 }}>Asking the AI service…</p>}

        {ai && !loadingAi && (
          <div className="ops-ai-brief" style={{ marginTop: 14 }}>
            <span className="ops-ai-label"><Sparkles aria-hidden="true" /> AI-generated</span>
            <p className="ops-ai-brief-headline">{ai.headline}</p>
            {ai.bullets.length > 0 && <ul>{ai.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
            {ai.topPriority && (
              <div className="ops-ai-brief-priority"><strong>Start here:</strong> {ai.topPriority}</div>
            )}
            <p className="ops-ai-brief-meta">
              {cached ? 'Generated earlier today' : 'Generated just now'} · figures come from your records, wording from AI
              {' · '}
              <button type="button" className="ops-linkish" onClick={() => enhance(true)}>refresh</button>
            </p>
          </div>
        )}

        {!aiConfigured && (
          <p className="ops-hint" style={{ marginTop: 12 }}>
            AI Enhanced is not activated. Everything above is built in and always available.
          </p>
        )}
      </div>
    </section>
  )
}
