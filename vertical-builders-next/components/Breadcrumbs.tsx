import Link from 'next/link'
import BreadcrumbJsonLd from './BreadcrumbJsonLd'

interface Crumb { name: string; path: string }

/** Visible breadcrumb trail plus the matching BreadcrumbList JSON-LD. */
export default function Breadcrumbs({ crumbs, tone = 'light' }: { crumbs: Crumb[]; tone?: 'light' | 'dark' }) {
  return (
    <>
      <BreadcrumbJsonLd crumbs={crumbs} />
      <nav aria-label="Breadcrumb" className={`crumbs crumbs-${tone}`}>
        <ol>
          <li><Link href="/">Home</Link></li>
          {crumbs.map((c, i) => (
            <li key={c.path}>
              {i === crumbs.length - 1
                ? <span aria-current="page">{c.name}</span>
                : <Link href={c.path}>{c.name}</Link>}
            </li>
          ))}
        </ol>
      </nav>
    </>
  )
}
