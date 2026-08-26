import { Search } from 'lucide-react'

/**
 * URL-driven filters as a plain GET form. No client JavaScript, no state to get
 * out of sync, and every filtered view is a shareable/bookmarkable link — which
 * matters when someone is asked "send me the list of expiring subs".
 */
export function FilterBar({
  action,
  q,
  placeholder = 'Search…',
  count,
  children,
}: {
  action: string
  q?: string
  placeholder?: string
  count?: string
  children?: React.ReactNode
}) {
  return (
    <form className="ops-toolbar" method="get" action={action} role="search">
      <div className="ops-search">
        <Search aria-hidden="true" />
        <input type="search" name="q" defaultValue={q ?? ''} placeholder={placeholder} aria-label={placeholder} />
      </div>
      {children}
      <button type="submit" className="ops-btn ops-btn-sm">Apply</button>
      {(q || count) && (
        <a href={action} className="ops-btn ops-btn-ghost ops-btn-sm">Clear</a>
      )}
      {count && <span className="ops-toolbar-count">{count}</span>}
    </form>
  )
}

export function FilterSelect({
  name, value, options, label,
}: {
  name: string
  value?: string
  options: { value: string; label: string }[]
  label: string
}) {
  return (
    <>
      <label className="sr-only-inline" htmlFor={`filter-${name}`} style={{ display: 'none' }}>{label}</label>
      <select id={`filter-${name}`} name={name} defaultValue={value ?? ''} aria-label={label}>
        <option value="">{label}: all</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </>
  )
}

export function Pagination({
  page, pageSize, total, basePath, params,
}: {
  page: number
  pageSize: number
  total: number
  basePath: string
  params: Record<string, string | undefined>
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null

  const link = (p: number) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
    sp.set('page', String(p))
    return `${basePath}?${sp.toString()}`
  }

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <nav className="ops-pagination" aria-label="Pagination">
      <span>{from}–{to} of {total}</span>
      {page > 1 && <a className="ops-btn ops-btn-sm" href={link(page - 1)}>Previous</a>}
      {page < pages && <a className="ops-btn ops-btn-sm" href={link(page + 1)}>Next</a>}
    </nav>
  )
}
