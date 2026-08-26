'use client'

import { Sparkles, Gauge } from 'lucide-react'
import { ActionForm, CheckField, SubmitButton } from './Form'
import { saveAiSettings } from '@/app/ops/actions/ai'
import { Badge } from './StatusBadge'

/**
 * ============================================================================
 * SETTINGS → ASSISTANT
 * ----------------------------------------------------------------------------
 * Two layers, stated separately, because the difference is a bill.
 *
 *   Smart Ops    — always available, no external provider, nothing to pay per
 *                  question. Cannot be switched off; it is the product.
 *   AI Enhanced  — free-form questions, messy-note understanding and COI
 *                  document extraction. Requires a key and is billed by the
 *                  provider.
 *
 * Reports configuration state without ever rendering a secret — the server
 * passes booleans and a model name, never the key. Model names are not secrets;
 * keys are, and they never leave the server.
 * ============================================================================
 */
export default function AssistantSettingsForm({
  settings,
  status,
}: {
  settings: {
    ai_copilot_enabled: boolean
    ai_coi_extraction_enabled: boolean
    ai_dashboard_brief_enabled: boolean
  }
  status: { openaiConfigured: boolean; opsModel: string; estimateModel: string }
}) {
  return (
    <div className="ops-stack">
      {/* ---- Layer 1: Smart Ops ------------------------------------------- */}
      <section className="ops-card">
        <div className="ops-card-head">
          <Gauge aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
          <h2>Smart Ops</h2>
          <span className="ops-mode-badge">Built-in</span>
        </div>
        <div className="ops-card-body">
          <dl className="ops-deflist">
            <dt>Status</dt>
            <dd><Badge tone="ok">Available — no external AI provider required</Badge></dd>
            <dt>Cost</dt>
            <dd>No AI API usage. Nothing is charged per question.</dd>
          </dl>

          <p className="ops-hint" style={{ marginTop: 12, marginBottom: 8 }}>
            Smart Ops answers a defined set of operational questions using live CRM data and the
            same business rules the rest of the product runs on. It is always on.
          </p>
          <ul className="ops-bullets">
            <li>Live summaries — what needs attention today</li>
            <li>Audit readiness, from the deterministic compliance evaluator</li>
            <li>Compliance and policy-expiration queries</li>
            <li>Leads, jobs, schedule, estimates and authorised invoice status</li>
            <li>Percentages, markup, margin and job-cost calculations</li>
            <li>Communication templates you copy, edit and send yourself</li>
            <li>Built-in extraction of labelled lead notes</li>
          </ul>
        </div>
      </section>

      {/* ---- Layer 2: AI Enhanced ------------------------------------------ */}
      <section className="ops-card">
        <div className="ops-card-head">
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
          <h2>AI Enhanced</h2>
          <span className={`ops-mode-badge${status.openaiConfigured ? ' is-ai' : ''}`}>
            {status.openaiConfigured ? 'Configured' : 'Not activated'}
          </span>
        </div>
        <div className="ops-card-body">
          {!status.openaiConfigured && (
            <div className="ops-banner warn" style={{ marginBottom: 14 }}>
              <div>
                No OpenAI key is set, so the AI Enhanced features below are unavailable. The CRM is
                fully usable without them — Smart Ops answers built-in questions, estimates are
                built from the pricebook, and COIs are keyed in. Set <code>OPENAI_API_KEY</code> to
                turn AI Enhanced on.
              </div>
            </div>
          )}

          <p className="ops-hint" style={{ marginBottom: 12 }}>
            AI Enhanced adds free-form questions, messy-note understanding, custom writing, and COI
            document extraction. <strong>Usage charges are billed by the configured AI provider.</strong>
          </p>

          <dl className="ops-deflist">
            <dt>OpenAI</dt>
            <dd>{status.openaiConfigured
              ? <Badge tone="ok">Configured</Badge>
              : <Badge tone="neutral">Not activated</Badge>}</dd>
            <dt>Assistant / operations model</dt>
            <dd><code style={{ fontSize: '.78rem' }}>{status.opsModel}</code>{' '}
              <span className="ops-hint">set with OPENAI_OPS_MODEL</span></dd>
            <dt>Estimate drafting model</dt>
            <dd><code style={{ fontSize: '.78rem' }}>{status.estimateModel}</code>{' '}
              <span className="ops-hint">set with OPENAI_ESTIMATE_MODEL, tuned separately</span></dd>
          </dl>

          <p className="ops-hint" style={{ marginTop: 12 }}>
            The API key is read on the server and is never sent to the browser or stored in the
            database. It is not displayed here at any time.
          </p>
        </div>
      </section>

      <section className="ops-card">
        <div className="ops-card-head"><h2>AI Enhanced features</h2></div>
        <div className="ops-card-body">
          <p className="ops-hint" style={{ marginBottom: 12 }}>
            These switches control the AI-billed layer only. Turning one off does not affect the
            equivalent Smart Ops feature, which keeps working either way.
          </p>
          <ActionForm action={saveAiSettings}>
            {state => (
              <>
                <CheckField
                  label="Free-form AI answers in the assistant" name="ai_copilot_enabled"
                  defaultChecked={settings.ai_copilot_enabled}
                  hint="When a question is not one of the built-in commands, hand it to the AI. With this off, the assistant answers built-in questions only and shows its command list for anything else."
                />
                <CheckField
                  label="COI extraction" name="ai_coi_extraction_enabled"
                  defaultChecked={settings.ai_coi_extraction_enabled}
                  hint="Adds an Analyze COI button to insurance documents. Always produces a draft for human review — it never records a certificate on its own. There is no built-in equivalent: reading a scanned certificate needs a vision model."
                />
                <CheckField
                  label="AI wording on the dashboard brief" name="ai_dashboard_brief_enabled"
                  defaultChecked={settings.ai_dashboard_brief_enabled}
                  hint="Adds an Enhance with AI button to the Smart Brief. The built-in brief is generated either way and stays on screen."
                />
                {state.error && <p className="ops-error">{state.error}</p>}
                <SubmitButton>Save assistant settings</SubmitButton>
              </>
            )}
          </ActionForm>
        </div>
      </section>

      <section className="ops-card">
        <div className="ops-card-head"><h2>What the assistant can and cannot do</h2></div>
        <div className="ops-card-body">
          <p className="ops-hint" style={{ marginBottom: 12 }}>
            These apply to both modes, and are enforced in code and in the database — not by asking
            a model nicely.
          </p>
          <dl className="ops-deflist">
            <dt>Writing records</dt>
            <dd>Never directly. It proposes; a person reviews and confirms; the normal server action does the write.</dd>
            <dt>Estimate prices</dt>
            <dd>Never set by AI. Unit prices come from the pricebook, and a line with no pricebook backing cannot be sent.</dd>
            <dt>Compliance status</dt>
            <dd>Never decided by AI. The deterministic evaluator is the only source of a verdict.</dd>
            <dt>Payments</dt>
            <dd>Never recorded, refunded or altered by the assistant.</dd>
            <dt>Permissions</dt>
            <dd>Never bypassed. Both modes read with your own database session, so they see exactly what you see and nothing more.</dd>
            <dt>Sending messages</dt>
            <dd>Never. Templates and drafts are copied by you and sent from your own email or phone.</dd>
            <dt>Documents</dt>
            <dd>Only the one certificate you ask it to analyse is sent for extraction, and only in AI Enhanced mode. No other CRM data goes with it.</dd>
          </dl>
        </div>
      </section>
    </div>
  )
}
