import type { Metadata } from 'next'
import Link from 'next/link'
import { BIZ, COUNTIES } from '@/lib/data'
import { SERVICE_AREAS } from '@/lib/serviceAreas'
import BreadcrumbJsonLd from '@/components/BreadcrumbJsonLd'
import FaqSection from '@/components/FaqSection'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = {
  title: 'Service Areas',
  description:
    'Vertical Builders and Commercial provides licensed roofing, general contracting, interior repair, pool, lanai, outdoor living, and commercial construction services across Southwest Florida. Explore the communities we serve.',
}

export default function ServiceAreasPage() {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Service Areas', path: '/service-areas' }]} />
      <section className="page-hero" style={{ minHeight: '34vh' }}>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <span className="kicker">Serving All of Southwest Florida</span>
          <h1>Licensed Contractor Serving Southwest Florida</h1>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <span className="kicker">Where We Work</span>
          <h2>Communities We Serve</h2>
          <p className="section-intro">
            Vertical Builders and Commercial provides licensed roofing, general contracting, interior
            repair, pool, lanai, outdoor living, and commercial construction services across Southwest
            Florida. Explore the communities we serve and request an estimate for your property.
          </p>
          <p className="section-intro" style={{ marginTop: 10 }}>
            We serve {COUNTIES.slice(0, 6).join(', ')}, and surrounding areas from our office in
            Nokomis — licensed GC {BIZ.licenseGC} and roofing contractor {BIZ.licenseRoof}.
          </p>
          <div className="area-cards">
            {SERVICE_AREAS.map(a => (
              <Link className="area-card" key={a.slug} href={`/service-areas/${a.slug}`}>
                <h3>{a.name}</h3>
                <span>{a.county}</span>
                <span className="area-card-cta">View services →</span>
              </Link>
            ))}
          </div>
          <p className="note" style={{ marginTop: 26 }}>
            Don&apos;t see your city? We serve surrounding Southwest Florida communities too —{' '}
            <a href={BIZ.phoneHref} style={{ color: 'var(--accent)', fontWeight: 600 }}>call {BIZ.phone}</a> to confirm availability.
          </p>
        </div>
      </section>
      <FaqSection />
      <CtaBand
        title="Request a Southwest Florida Estimate"
        text="Tell us where your property is and what you're planning — we'll take it from there."
        cta="Request an Estimate"
      />
    </>
  )
}
