import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { formatDate } from '@/lib/ops/utils/dates'
import { Badge } from '@/components/ops/StatusBadge'
import { EmptyState } from '@/components/ops/EmptyState'
import { FilterBar, FilterSelect, Pagination } from '@/components/ops/FilterBar'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

const TYPES = [
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'business', label: 'Business' },
  { value: 'property_manager', label: 'Property manager' },
  { value: 'other', label: 'Other' },
]

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: { q?: string; type?: string; page?: string }
}) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const { q, type } = searchParams
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1)

  let query = supabase
    .from('contacts')
    .select('id, contact_type, first_name, last_name, company_name, email, phone, city, created_at', { count: 'exact' })
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (type) query = query.eq('contact_type', type)
  if (q) {
    const p = `%${q.replace(/[%_,()]/g, ' ')}%`
    query = query.or(`first_name.ilike.${p},last_name.ilike.${p},company_name.ilike.${p},email.ilike.${p},phone.ilike.${p},city.ilike.${p}`)
  }

  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await query.range(from, from + PAGE_SIZE - 1)
  const contacts = data ?? []

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow">Sales</div>
          <h1>Contacts &amp; customers</h1>
          <p className="ops-sub">Homeowners, businesses and property managers, with their projects and documents attached.</p>
        </div>
        <div className="ops-page-actions">
          <Link href="/ops/contacts/new" className="ops-btn ops-btn-primary"><Plus aria-hidden="true" /> New contact</Link>
        </div>
      </div>

      <div className="ops-card">
        <FilterBar action="/ops/contacts" q={q} placeholder="Name, company, email, phone…"
          count={count !== null ? `${count} contact${count === 1 ? '' : 's'}` : undefined}>
          <FilterSelect name="type" value={type} label="Type" options={TYPES} />
        </FilterBar>

        {contacts.length === 0 ? (
          <EmptyState
            title={q || type ? 'No contacts match' : 'No contacts yet'}
            message={
              q || type
                ? 'Clear the filters to see everyone.'
                : 'Contacts are created automatically when you convert a lead, or you can add one directly.'
            }
            actionLabel="Add a contact"
            actionHref="/ops/contacts/new"
          />
        ) : (
          <>
            <div className="ops-table-wrap">
              <table className="ops-table ops-table-cards">
                <thead>
                  <tr><th>Name</th><th>Company</th><th>Type</th><th>Email</th><th>Phone</th><th>City</th><th>Added</th></tr>
                </thead>
                <tbody>
                  {contacts.map(c => (
                    <tr key={c.id}>
                      <td data-label="Name" className="ops-cell-primary">
                        <Link className="ops-row-link" href={`/ops/contacts/${c.id}`}>
                          {[c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Unnamed'}
                        </Link>
                      </td>
                      <td data-label="Company">{c.company_name ?? '—'}</td>
                      <td data-label="Type">
                        <Badge tone="neutral">{TYPES.find(t => t.value === c.contact_type)?.label ?? c.contact_type}</Badge>
                      </td>
                      <td data-label="Email">{c.email ?? '—'}</td>
                      <td data-label="Phone" className="nowrap">{c.phone ?? '—'}</td>
                      <td data-label="City">{c.city ?? '—'}</td>
                      <td data-label="Added" className="nowrap">{formatDate(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/ops/contacts" params={{ q, type }} />
          </>
        )}
      </div>
    </>
  )
}
