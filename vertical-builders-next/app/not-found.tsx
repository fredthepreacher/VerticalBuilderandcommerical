import Link from 'next/link'
import { BIZ } from '@/lib/data'

export default function NotFound() {
  return (
    <section className="section contact" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center' }}>
      <div className="container" style={{ textAlign: 'center', maxWidth: 620 }}>
        <p style={{ fontFamily: 'var(--font-oswald)', fontSize: '5rem', color: 'var(--accent)', lineHeight: 1 }}>404</p>
        <h2>Page Not Found</h2>
        <p style={{ color: '#c9d3dc', margin: '18px 0 30px' }}>
          Looks like this page got blown off in the last storm. Let&apos;s get you back to solid ground.
        </p>
        <Link className="btn btn-accent" href="/" style={{ margin: 6 }}>Back to Home</Link>
        <a className="btn btn-outline" href={BIZ.phoneHref} style={{ margin: 6 }}>Call {BIZ.phone}</a>
      </div>
    </section>
  )
}
