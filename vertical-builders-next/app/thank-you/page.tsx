import type { Metadata } from 'next'
import Link from 'next/link'
import { BIZ } from '@/lib/data'

export const metadata: Metadata = {
  title: 'Thank You',
  robots: { index: false },
}

export default function ThankYouPage() {
  return (
    <section className="section contact" style={{ minHeight: '80vh', display: 'flex', alignItems: 'center' }}>
      <div className="container" style={{ textAlign: 'center', maxWidth: 620 }}>
        <h2>Request Received!</h2>
        <p style={{ color: '#c9d3dc', margin: '18px 0 30px' }}>
          Thanks for reaching out to {BIZ.name}. We&apos;ll get back to you shortly — usually the same business day.
        </p>
        <a className="btn btn-accent" href={BIZ.phoneHref} style={{ margin: 6 }}>Call {BIZ.phone}</a>
        <Link className="btn btn-outline" href="/" style={{ margin: 6 }}>Back to Home</Link>
      </div>
    </section>
  )
}
