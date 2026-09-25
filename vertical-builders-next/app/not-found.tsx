import Link from 'next/link'
import { BIZ } from '@/lib/data'

// Old links from the previous website still arrive here; give people the
// likely destinations instead of a dead end.
const POPULAR = [
  ['/roofing', 'Roofing & storm repair'],
  ['/pools-lanais', 'Pools, lanais & pool cages'],
  ['/permitting-help', 'Permit help'],
  ['/services', 'All services'],
  ['/service-areas', 'Service areas'],
  ['/gallery', 'Project gallery'],
] as const

export default function NotFound() {
  return (
    <section className="section contact contact-top" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center' }}>
      <div className="container" style={{ textAlign: 'center', maxWidth: 680 }}>
        <p className="nf-code">404</p>
        <h1>That page has moved</h1>
        <p style={{ color: '#c9d3dc', margin: '18px 0 26px' }}>
          Our website was rebuilt, so some old links no longer work. One of these is probably what you were after:
        </p>
        <ul className="nf-links">
          {POPULAR.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}
        </ul>
        <div style={{ marginTop: 28 }}>
          <Link className="btn btn-accent" href="/contact" style={{ margin: 6 }}>Get a Free Estimate</Link>
          <a className="btn btn-outline" href={BIZ.phoneHref} style={{ margin: 6 }}>Call {BIZ.phone}</a>
        </div>
      </div>
    </section>
  )
}
