import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import {
  COMPLIANCE_STATUSES, COMPLIANCE_LABELS, TRADES, VENDOR_STATUSES,
  type ComplianceStatus, type VendorStatus,
} from '@/lib/ops/types'
import { formatDate, toUtcDate, daysBetween } from '@/lib/ops/utils/dates'
import { Badge, ComplianceBadge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export default async function SubcontractorsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; trade?: string; compliance?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()

  const { q, status, trade, compliance } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('vendors')
    .select(
      'id, legal_name, dba, primary_trade, status, contact_first_name, contact_last_name, email, phone,' +
      'city, license_number, license_expiration_date, w9_status, compliance_status, earliest_expiration_date,' +
      'last_reviewed_at',
      { count: 'exact' },
    )
    .is('archived_at', null)
    .order('legal_name')

  if (status) query = query.eq('status', status)
  if (trade) query = query.eq('primary_trade', trade)
  if (compliance) query = query.eq('compliance_status', compliance)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(`legal_name.ilike.${p},dba.ilike.${p},email.ilike.${p},license_number.ilike.${p},city.ilike.${p}`)
  }

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const vendors = (data ?? []) as unknown as VendorRow[]
  const today = new Date()

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Compliance</div>
          <h1>Subcontractors &amp; vendors</h1>
          <p className="ops-sub">
            Every company that works on a Vertical Builders job, with the state of their paperwork
            visible before anyone gets scheduled.
          </p>
        </div>
        <div className="ops-page-actions">
          <Link href="/ops/compliance" className="ops-btn">Compliance register</Link>
          <Link href="/ops/subcontractors/new" className="ops-btn ops-btn-primary">
            <Plus aria-hidden="true" /> New subcontractor
          </Link>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar
          action="/ops/subcontractors" q={q}
          placeholder="Company, contact, license number…"
          count={count !== null ? `${count} vendor${count === 1 ? '' : 's'}` : undefined}
        >
          <FilterSelect name="status" value={status} label="Status"
            options={VENDOR_STATUSES.map(s => ({ value: s, label: cap(s) }))} />
          <FilterSelect name="trade" value={trade} label="Trade"
            options={TRADES.map(t => ({ value: t, label: t }))} />
          <FilterSelect name="compliance" value={compliance} label="Compliance"
            options={COMPLIANCE_STATUSES.map(s => ({ value: s, label: COMPLIANCE_LABELS[s] }))} />
        </FilterBar>

        {vendors.length === 0 ? (
          <EmptyState
            title={q || status || trade || compliance ? 'No subcontractors match those filters' : 'No subcontractors yet'}
            message={
              q || status || trade || compliance
                ? 'Clear the filters to see everyone.'
                : 'Add the subcontractors you use most first — then upload their current certificates so compliance starts tracking.'
            }
            actionLabel="Add a subcontractor"
            actionHref="/ops/subcontractors/new"
          />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr>
                    <th>Company</th><th>Trade</th><th>Contact</th><th>Status</th>
                    <th>Compliance</th><th>Earliest expiration</th><th>License</th><th>W-9</th><th />
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => {
                    const licenseDate = toUtcDate(v.license_expiration_date)
                    const licenseDays = licenseDate ? daysBetween(toUtcDate(today)!, licenseDate) : null
                    return (
                      <tr key={v.id}>
                        <td data-label="Company" className="ops-cell-primary">
                          <Link className="ops-row-link" href={`/ops/subcontractors/${v.id}`}>{v.legal_name}</Link>
                          {v.dba && <span className="ops-sub2">DBA {v.dba}</span>}
                        </td>
                        <td data-label="Trade">{v.primary_trade ?? '—'}</td>
                        <td data-label="Contact">
                          {[v.contact_first_name, v.contact_last_name].filter(Boolean).join(' ') || '—'}
                          {v.phone && <span className="ops-sub2">{v.phone}</span>}
                        </td>
                        <td data-label="Status">
                          <Badge tone={v.status === 'active' ? 'info' : v.status === 'blocked' ? 'bad' : 'neutral'}>
                            {cap(v.status)}
                          </Badge>
                        </td>
                        <td data-label="Compliance"><ComplianceBadge status={v.compliance_status} /></td>
                        <td data-label="Earliest expiration" className="nowrap">
                          {v.earliest_expiration_date ? formatDate(v.earliest_expiration_date) : '—'}
                        </td>
                        <td data-label="License">
                          {v.license_number ?? '—'}
                          {licenseDays !== null && licenseDays < 60 && (
                            <span className="ops-sub2">
                              <Badge tone={licenseDays < 0 ? 'bad' : 'warn'}>
                                {licenseDays < 0 ? 'License expired' : `License in ${licenseDays}d`}
                              </Badge>
                            </span>
                          )}
                        </td>
                        <td data-label="W-9">
                          <Badge tone={v.w9_status === 'on_file' ? 'ok' : 'bad'}>
                            {v.w9_status === 'on_file' ? 'On file' : cap(v.w9_status)}
                          </Badge>
                        </td>
                        <td className="ops-actions">
                          <Link className="ops-btn ops-btn-sm" href={`/ops/subcontractors/${v.id}?tab=insurance`}>
                            Insurance
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page} pageSize={PAGE_SIZE} total={count ?? 0}
              basePath="/ops/subcontractors" params={{ q, status, trade, compliance }}
            />
          </>
        )}
      </div>
    </>
  )
}

interface VendorRow {
  id: string
  legal_name: string
  dba: string | null
  primary_trade: string | null
  status: VendorStatus
  contact_first_name: string | null
  contact_last_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  license_number: string | null
  license_expiration_date: string | null
  w9_status: string
  compliance_status: ComplianceStatus
  earliest_expiration_date: string | null
  last_reviewed_at: string | null
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ')
}
