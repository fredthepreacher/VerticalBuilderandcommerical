import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { getSettings } from '@/lib/ops/services/settings'
import { COMPLIANCE_DISCLAIMER, type InsuranceRequirement, type RequirementTemplate } from '@/lib/ops/types'
import { isEmailConfigured } from '@/lib/ops/services/notifications'
import { EmptyState } from '@/components/ops/EmptyState'
import { GeneralSettingsForm, RequirementTemplateForm, UserRow } from '@/components/ops/SettingsForms'
import {
  EstimatingSettingsForm, FinancialPermissionsForm, MeasurementSettingsForm,
  PaymentSettingsForm, PricebookManager, type PricebookItemRow,
} from '@/components/ops/OperationsSettingsForms'
import { describePaymentConfig } from '@/lib/ops/finance/payment-provider'
import { Badge } from '@/components/ops/StatusBadge'

export const dynamic = 'force-dynamic'

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'requirements', label: 'Insurance requirements' },
  { key: 'estimating', label: 'Estimating' },
  { key: 'pricebook', label: 'Pricebook' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'payments', label: 'Payments' },
  { key: 'permissions', label: 'Financial access' },
  { key: 'users', label: 'Users' },
  { key: 'system', label: 'System' },
] as const

export default async function SettingsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const user = await requireUser()
  const supabase = createSupabaseServerClient()
  const tab = TABS.find(t => t.key === searchParams.tab)?.key ?? 'general'

  const [settings, { data: templates }, { data: profiles }, { data: pricebook }] = await Promise.all([
    getSettings(supabase),
    supabase.from('insurance_requirement_templates')
      .select('*, insurance_requirements(*)').eq('active', true).order('scope').order('name'),
    supabase.from('profiles').select('id, full_name, email, role, active').order('full_name'),
    supabase.from('pricebook_items').select('*').order('active', { ascending: false })
      .order('category').order('name'),
  ])

  const payments = describePaymentConfig(settings.online_payments_enabled)
  const readOnly = (
    <EmptyState title="Read-only" message="Only an owner/admin or office user can change these settings." />
  )

  const href = (t: string) => `/ops/settings?tab=${t}`

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Workspace</div>
          <h1>Settings</h1>
          <p className="ops-sub">
            Reminder timing, insurance requirements, pricing, payments, and who can do what.
          </p>
        </div>
      </div>

      <nav className="ops-tabs" aria-label="Settings sections">
        {TABS.map(t => (
          <a key={t.key} href={href(t.key)} aria-current={tab === t.key ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>

      {tab === 'general' && (
        user.can('manageSettings')
          ? <div style={{ maxWidth: 820 }}><GeneralSettingsForm settings={settings} /></div>
          : <EmptyState title="Read-only" message="Only an owner/admin or office user can change settings." />
      )}

      {tab === 'requirements' && (
        <div style={{ maxWidth: 900 }}>
          {!user.can('manageRequirements') && (
            <div className="ops-banner info">
              <div>You can read these rules but not change them. Project managers and auditors cannot edit system-wide insurance requirements.</div>
            </div>
          )}
          {(templates ?? []).length === 0 ? (
            <EmptyState
              title="No requirement templates"
              message="Run migration 0004 to install the starter global template, then edit it here."
            />
          ) : (
            <div className="ops-stack">
              {((templates ?? []) as unknown as RequirementTemplate[]).map(t =>
                user.can('manageRequirements') ? (
                  <RequirementTemplateForm
                    key={t.id}
                    template={{ id: t.id, name: t.name, scope: t.scope, trade: t.trade, disclaimer: t.disclaimer }}
                    requirements={(t.insurance_requirements ?? []) as InsuranceRequirement[]}
                  />
                ) : (
                  <ReadOnlyTemplate key={t.id} template={t} />
                ),
              )}
              <p className="ops-disclaimer">{COMPLIANCE_DISCLAIMER}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'estimating' && (
        user.can('manageSettings')
          ? <div style={{ maxWidth: 820 }}><EstimatingSettingsForm settings={settings} /></div>
          : readOnly
      )}

      {tab === 'pricebook' && (
        <PricebookManager
          items={(pricebook ?? []) as unknown as PricebookItemRow[]}
          canManage={user.can('pricebookManage')}
        />
      )}

      {tab === 'measurements' && (
        user.can('manageSettings')
          ? (
            <div style={{ maxWidth: 820 }}>
              <MeasurementSettingsForm
                provider={settings.roof_measurement_provider}
                configured={{
                  eagleview: Boolean(process.env.EAGLEVIEW_CLIENT_ID && process.env.EAGLEVIEW_CLIENT_SECRET),
                  nearmap: Boolean(process.env.NEARMAP_API_KEY),
                  maps: Boolean(process.env.GOOGLE_MAPS_API_KEY),
                }}
              />
            </div>
          )
          : readOnly
      )}

      {tab === 'payments' && (
        user.can('manageSettings')
          ? (
            <div style={{ maxWidth: 820 }}>
              <div className="ops-banner info" style={{ marginBottom: 16 }}>
                <div>{payments.message}</div>
              </div>
              <PaymentSettingsForm
                settings={settings}
                stripe={{
                  secretKey: payments.stripeConfigured,
                  publishableKey: payments.publishableKeyPresent,
                  webhookSecret: payments.webhookConfigured,
                  mode: stripeMode(),
                }}
              />
            </div>
          )
          : readOnly
      )}

      {tab === 'permissions' && (
        user.can('manageSettings')
          ? <div style={{ maxWidth: 820 }}><FinancialPermissionsForm settings={settings} /></div>
          : readOnly
      )}

      {tab === 'users' && (
        <div className="ops-card" style={{ maxWidth: 900 }}>
          <div className="ops-card-head">
            <h2>Users</h2>
            <div className="ops-card-actions">
              <span className="ops-hint">Invite people from the Supabase dashboard — a profile is created automatically on first sign-in.</span>
            </div>
          </div>
          {!user.can('manageUsers') ? (
            <div className="ops-card-body">
              <p className="ops-hint">Only an owner/admin can manage roles.</p>
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Account</th></tr></thead>
                <tbody>
                  {(profiles ?? []).map(p => (
                    <UserRow
                      key={p.id}
                      profile={p as { id: string; full_name: string | null; email: string | null; role: string; active: boolean }}
                      isSelf={p.id === user.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'system' && (
        <div className="ops-card" style={{ maxWidth: 720 }}>
          <div className="ops-card-head"><h2>System status</h2></div>
          <div className="ops-card-body">
            <dl className="ops-deflist">
              <dt>Supabase</dt>
              <dd><Badge tone="ok">Connected</Badge></dd>
              <dt>Email (Resend)</dt>
              <dd>
                {isEmailConfigured()
                  ? <Badge tone="ok">Configured</Badge>
                  : <Badge tone="warn">Not configured — links must be copied manually</Badge>}
              </dd>
              <dt>Expiry reminders</dt>
              <dd>
                {process.env.CRON_SECRET
                  ? <Badge tone="ok">CRON_SECRET set</Badge>
                  : <Badge tone="warn">CRON_SECRET missing — the daily job will refuse to run</Badge>}
              </dd>
              <dt>Public lead intake</dt>
              <dd><code style={{ fontSize: '.78rem' }}>POST /api/public/leads</code></dd>
              <dt>Daily reminder job</dt>
              <dd><code style={{ fontSize: '.78rem' }}>GET /api/cron/compliance-reminders</code></dd>
              <dt>Private bucket</dt>
              <dd><code style={{ fontSize: '.78rem' }}>vertical-private-documents</code></dd>
            </dl>
            <p className="ops-hint" style={{ marginTop: 14 }}>
              Environment variables are set in Vercel, not here. See <code>docs/DEPLOYMENT.md</code>.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function ReadOnlyTemplate({ template }: { template: RequirementTemplate }) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>{template.name}</h2></div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead><tr><th>Coverage</th><th>Required</th><th>Minimums</th><th>AI</th><th>WOS</th><th>P/NC</th></tr></thead>
          <tbody>
            {(template.insurance_requirements ?? []).map(r => (
              <tr key={r.id}>
                <td>{r.coverage_type.replace(/_/g, ' ')}</td>
                <td>{r.required ? 'Yes' : 'No'}</td>
                <td style={{ fontSize: '.78rem' }}>
                  {[
                    r.min_limit_each_occurrence && `Each occ. ${r.min_limit_each_occurrence.toLocaleString()}`,
                    r.min_limit_aggregate && `Agg. ${r.min_limit_aggregate.toLocaleString()}`,
                    r.min_combined_single_limit && `CSL ${r.min_combined_single_limit.toLocaleString()}`,
                    r.min_workers_comp_el && `EL ${r.min_workers_comp_el.toLocaleString()}`,
                  ].filter(Boolean).join(' · ') || '—'}
                </td>
                <td>{r.additional_insured_required ? '✓' : '—'}</td>
                <td>{r.waiver_of_subrogation_required ? '✓' : '—'}</td>
                <td>{r.primary_noncontributory_required ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Reported so nobody discovers after the fact that a month of "payments" were
 * test-mode. Only the key's prefix is read — the key itself is never rendered.
 */
function stripeMode(): 'live' | 'test' | 'none' {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return 'none'
  return key.startsWith('sk_live_') ? 'live' : 'test'
}
