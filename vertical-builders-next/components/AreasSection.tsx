import Link from 'next/link'
import { AREAS_ALL, BIZ } from '@/lib/data'
import { areaSlugByName } from '@/lib/serviceAreas'

export default function AreasSection() {
  return (
    <section className="section areas">
      <div className="container">
        <span className="kicker">Serving All of Southwest Florida</span>
        <h2>Serving Homeowners and Businesses Across Southwest Florida</h2>
        <p className="section-intro">
          Vertical Builders and Commercial provides licensed roofing, general contracting, interior
          repair, pool, lanai, and outdoor living services throughout Southwest Florida. From coastal
          homes to commercial properties, our team helps property owners protect, repair, and improve
          their spaces with professional craftsmanship and dependable project management.
        </p>
        <div className="area-list">
          {AREAS_ALL.map(a => {
            const slug = areaSlugByName(a)
            if (!slug) return null // minor areas live in the sentence below, not as dead pills
            return <Link className="area area-link" key={a} href={`/service-areas/${slug}`}>{a}</Link>
          })}
        </div>
        <p className="note">
          <Link href="/service-areas" style={{ color: 'var(--accent)', fontWeight: 600 }}>Explore all service areas →</Link>
          {' '}We also serve LaBelle, Immokalee, and surrounding Southwest Florida communities —
          <a href={BIZ.phoneHref}> call {BIZ.phone}</a> to confirm availability for your property.
        </p>
      </div>
    </section>
  )
}
