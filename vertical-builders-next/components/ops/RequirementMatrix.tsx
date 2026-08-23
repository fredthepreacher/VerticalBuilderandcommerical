import { COMPLIANCE_DISCLAIMER } from '@/lib/ops/types'
import type { ComplianceCheck } from '@/lib/ops/compliance/evaluator'
import { formatDate } from '@/lib/ops/utils/dates'
import { Badge } from './StatusBadge'

/**
 * The requirement matrix — the screen that answers "why is this vendor red?".
 *
 * One row per required coverage, one column per condition, with the reasons
 * spelled out underneath rather than hidden behind a colour.
 *
 *   AI   = Additional Insured
 *   WOS  = Waiver of Subrogation
 *   P/NC = Primary / Non-Contributory
 */
export default function RequirementMatrix({
  checks,
  sources,
}: {
  checks: ComplianceCheck[]
  sources?: Record<string, string>
}) {
  if (checks.length === 0) {
    return (
      <div className="ops-card-body">
        <div className="ops-banner warn">
          <div>
            <strong>No insurance requirements are configured</strong>
            Nothing can be verified until a requirement template applies to this vendor.
            Set one up in Settings → Insurance requirements.
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="ops-table-wrap">
        <table className="ops-matrix">
          <caption className="sr-only-inline" style={{ position: 'absolute', left: -9999 }}>
            Insurance requirement results by coverage type
          </caption>
          <thead>
            <tr>
              <th scope="col">Coverage</th>
              <th scope="col">Current policy</th>
              <th scope="col">Limits</th>
              <th scope="col">Expiration</th>
              <th scope="col" title="Additional Insured">AI</th>
              <th scope="col" title="Waiver of Subrogation">WOS</th>
              <th scope="col" title="Primary / Non-Contributory">P/NC</th>
              <th scope="col">Review</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {checks.map(check => (
              <tr key={check.requirementId}>
                <th scope="row" style={{ textAlign: 'left', background: 'transparent', textTransform: 'none', fontSize: '.83rem', color: 'var(--ops-ink)', letterSpacing: 0, borderBottom: '1px solid var(--ops-line)', position: 'static' }}>
                  {check.coverageLabel}
                  {sources?.[check.coverageType] && (
                    <span className="ops-sub2" style={{ fontWeight: 400 }}>
                      Rule: {sources[check.coverageType]}
                    </span>
                  )}
                  {check.reasons.length > 0 && (
                    <ul className="ops-reasons">
                      {check.reasons.map((reason, i) => <li key={i}>{reason}</li>)}
                    </ul>
                  )}
                  {check.waiver && (
                    <div className="ops-banner neutral" style={{ marginTop: 8, marginBottom: 0, padding: '8px 10px', fontSize: '.78rem' }}>
                      <div>
                        <strong>Exception on file</strong>
                        {check.waiver.reason}
                        {check.waiver.expiresAt && ` (expires ${formatDate(check.waiver.expiresAt)})`}
                        <br />
                        <span style={{ color: 'var(--ops-muted)' }}>
                          Underlying finding is preserved: {check.waiver.underlyingReasons.join(' ')}
                        </span>
                      </div>
                    </div>
                  )}
                </th>
                <td>
                  {check.policyId ? (
                    <>
                      <span style={{ display: 'block', fontWeight: 550, color: 'var(--ops-ink)' }}>
                        {check.carrier ?? 'Carrier not recorded'}
                      </span>
                      <span className="ops-sub2">{check.policyNumber ?? 'No policy number'}</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--ops-muted)' }}>None on file</span>
                  )}
                </td>
                <td><Mark state={check.detail.limits} /></td>
                <td className="nowrap">
                  {check.expirationDate ? (
                    <>
                      <span style={{ display: 'block' }}>{formatDate(check.expirationDate)}</span>
                      {check.daysToExpiration !== null && check.daysToExpiration !== undefined && (
                        <span className="ops-sub2">
                          {check.daysToExpiration < 0
                            ? `${Math.abs(check.daysToExpiration)}d ago`
                            : `in ${check.daysToExpiration}d`}
                        </span>
                      )}
                    </>
                  ) : '—'}
                </td>
                <td><Mark state={check.detail.additionalInsured} /></td>
                <td><Mark state={check.detail.waiverOfSubrogation} /></td>
                <td><Mark state={check.detail.primaryNoncontributory} /></td>
                <td><ReviewMark state={check.detail.review} /></td>
                <td><ResultBadge status={check.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ops-card-body" style={{ paddingTop: 0 }}>
        <p className="ops-disclaimer">{COMPLIANCE_DISCLAIMER}</p>
      </div>
    </>
  )
}

function Mark({ state }: { state: 'pass' | 'fail' | 'n/a' }) {
  if (state === 'pass') return <span className="ops-mark pass" title="Meets the requirement">✓</span>
  if (state === 'fail') return <span className="ops-mark fail" title="Does not meet the requirement">✕</span>
  return <span className="ops-mark na" title="Not required">–</span>
}

function ReviewMark({ state }: { state: 'pass' | 'pending' | 'rejected' | 'n/a' }) {
  if (state === 'pass') return <span className="ops-mark pass" title="Reviewed and approved">✓</span>
  if (state === 'pending') return <span className="ops-mark pend" title="Awaiting human review">…</span>
  if (state === 'rejected') return <span className="ops-mark fail" title="Certificate rejected">✕</span>
  return <span className="ops-mark na" title="No certificate">–</span>
}

function ResultBadge({ status }: { status: ComplianceCheck['status'] }) {
  switch (status) {
    case 'pass': return <Badge tone="ok">Pass</Badge>
    case 'warning': return <Badge tone="warn">Warning</Badge>
    case 'fail': return <Badge tone="bad">Fail</Badge>
    case 'missing': return <Badge tone="bad">Missing</Badge>
    case 'waived': return <Badge tone="neutral">Waived</Badge>
  }
}
