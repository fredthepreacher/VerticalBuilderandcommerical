'use client'

import { Package } from 'lucide-react'
import { ActionForm, SubmitButton } from './Form'
import { generateAuditPackage } from '@/app/ops/actions/audits'
import { COMPLIANCE_LABELS, COMPLIANCE_STATUSES, COVERAGE_LABELS, COVERAGE_TYPES } from '@/lib/ops/types'

/**
 * Filters map 1:1 onto what gets written into the ZIP, and are stored on the
 * export record — so "how was this package built?" is always answerable.
 */
export default function GenerateAuditPackage({
  auditCycleId,
  projects,
  trades,
}: {
  auditCycleId: string
  projects: { id: string; label: string }[]
  trades: string[]
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head">
        <Package aria-hidden="true" style={{ width: 17, height: 17, color: 'var(--ops-accent)' }} />
        <h2>Generate audit package</h2>
      </div>
      <div className="ops-card-body">
        <ActionForm action={generateAuditPackage}>
          {state => (
            <>
              <input type="hidden" name="audit_cycle_id" value={auditCycleId} />

              <details>
                <summary style={{ cursor: 'pointer', fontSize: '.84rem', fontWeight: 600, marginBottom: 12 }}>
                  Narrow the package (optional)
                </summary>

                {projects.length > 0 && (
                  <div className="ops-field">
                    <span className="ops-label">Projects</span>
                    <div className="ops-chips">
                      {projects.map(p => (
                        <label key={p.id} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" name="project_ids" value={p.id} style={{ accentColor: 'var(--ops-accent)' }} />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {trades.length > 0 && (
                  <div className="ops-field">
                    <span className="ops-label">Trades</span>
                    <div className="ops-chips">
                      {trades.map(t => (
                        <label key={t} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <input type="checkbox" name="trades" value={t} style={{ accentColor: 'var(--ops-accent)' }} />
                          {t}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="ops-field">
                  <span className="ops-label">Compliance status at period end</span>
                  <div className="ops-chips">
                    {COMPLIANCE_STATUSES.map(s => (
                      <label key={s} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" name="compliance_statuses" value={s} style={{ accentColor: 'var(--ops-accent)' }} />
                        {COMPLIANCE_LABELS[s]}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="ops-field">
                  <span className="ops-label">Coverage types</span>
                  <div className="ops-chips">
                    {COVERAGE_TYPES.map(c => (
                      <label key={c} className="ops-chip" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" name="coverage_types" value={c} style={{ accentColor: 'var(--ops-accent)' }} />
                        {COVERAGE_LABELS[c]}
                      </label>
                    ))}
                  </div>
                </div>
              </details>

              <label className="ops-check" style={{ margin: '14px 0' }} htmlFor="include_documents">
                <input id="include_documents" name="include_documents" type="checkbox" defaultChecked />
                <span>
                  Include copies of the source documents
                  <span className="ops-hint" style={{ display: 'block' }}>
                    Certificates, W-9s, licenses and endorsements, filed one folder per subcontractor.
                    Originals are never modified.
                  </span>
                </span>
              </label>

              <SubmitButton pendingLabel="Building the package…">Generate audit package</SubmitButton>
              <p className="ops-hint" style={{ marginTop: 10 }}>
                Generating takes a moment for large periods. Previous packages are kept — this
                creates a new one rather than replacing anything.
              </p>

              {state.ok && state.data?.filename ? (
                <p className="ops-hint" style={{ marginTop: 8 }}>
                  Saved as <strong>{String(state.data.filename)}</strong>. It appears in the export
                  history below — reload if you do not see it yet.
                </p>
              ) : null}
            </>
          )}
        </ActionForm>
      </div>
    </section>
  )
}
