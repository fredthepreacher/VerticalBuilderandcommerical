'use client'

import { Sparkles } from 'lucide-react'
import { ActionForm, CheckField, SubmitButton } from './Form'
import { saveAiSettings } from '@/app/ops/actions/ai'
import { Badge } from './StatusBadge'

/**
 * Settings → AI.
 *
 * Reports configuration state without ever rendering a secret — the server
 * passes booleans and a model name, never the key. Model names are not secrets;
 * keys are, and they never leave the server.
 */
export default function AiSettingsForm({
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
      <section className="ops-card">
        <div className="ops-card-head">
          <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: '#7a5cb0' }} />
          <h2>AI configuration</h2>
        </div>
        <div className="ops-card-body">
          {!status.openaiConfigured && (
            <div className="ops-banner warn" style={{ marginBottom: 14 }}>
              <div>
                No OpenAI key is set, so every AI feature is unavailable. The CRM is fully usable
                without it — estimates are built from the pricebook, COIs are keyed in, and the
                assistant button is simply disabled. Set <code>OPENAI_API_KEY</code> to turn it on.
              </div>
            </div>
          )}

          <dl className="ops-deflist">
            <dt>OpenAI</dt>
            <dd>{status.openaiConfigured
              ? <Badge tone="ok">Configured</Badge>
              : <Badge tone="neutral">Not configured</Badge>}</dd>
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
        <div className="ops-card-head"><h2>Features</h2></div>
        <div className="ops-card-body">
          <ActionForm action={saveAiSettings}>
            {state => (
              <>
                <CheckField
                  label="Vertical AI assistant" name="ai_copilot_enabled"
                  defaultChecked={settings.ai_copilot_enabled}
                  hint="The Ask Vertical AI button in the top bar. Answers questions about records the signed-in user can already see."
                />
                <CheckField
                  label="COI extraction" name="ai_coi_extraction_enabled"
                  defaultChecked={settings.ai_coi_extraction_enabled}
                  hint="Adds an Analyze COI button to insurance documents. Always produces a draft for human review — it never records a certificate on its own."
                />
                <CheckField
                  label="Dashboard AI brief" name="ai_dashboard_brief_enabled"
                  defaultChecked={settings.ai_dashboard_brief_enabled}
                  hint="A prioritised daily summary card. Generated on demand, then reused for the rest of the day."
                />
                {state.error && <p className="ops-error">{state.error}</p>}
                <SubmitButton>Save AI settings</SubmitButton>
              </>
            )}
          </ActionForm>
        </div>
      </section>

      <section className="ops-card">
        <div className="ops-card-head"><h2>What the AI can and cannot do</h2></div>
        <div className="ops-card-body">
          <p className="ops-hint" style={{ marginBottom: 12 }}>
            These are enforced in code and in the database, not by asking the model nicely.
          </p>
          <dl className="ops-deflist">
            <dt>Writing records</dt>
            <dd>Never directly. It proposes; a person reviews and confirms; the normal server action does the write.</dd>
            <dt>Estimate prices</dt>
            <dd>Never set by AI. Unit prices come from the pricebook, and a line with no pricebook backing cannot be sent.</dd>
            <dt>Compliance status</dt>
            <dd>Never decided by AI. The deterministic evaluator is the only source of a verdict.</dd>
            <dt>Payments</dt>
            <dd>Never recorded, refunded or altered by AI.</dd>
            <dt>Permissions</dt>
            <dd>Never bypassed. The assistant reads with your own database session, so it sees exactly what you see and nothing more.</dd>
            <dt>Documents</dt>
            <dd>Only the one certificate you ask it to analyse is sent for extraction. No other CRM data goes with it.</dd>
          </dl>
        </div>
      </section>
    </div>
  )
}
