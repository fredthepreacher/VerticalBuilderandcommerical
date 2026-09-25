import Link from 'next/link'
import { AREAS_ALL, BIZ } from '@/lib/data'
import { areaSlugByName } from '@/lib/serviceAreas'

export default function AreasSection() {
  return (
    <section className="section areas">
      <div className="container">
        <span className="kicker">Service area</span>
        <h2>Serving homeowners and businesses across Southwest Florida</h2>
        <p className="section-intro">
          Our office is on S Tamiami Trail in Nokomis. From there we work from Bradenton and Lakewood Ranch
          down through Venice, North Port and Charlotte County to Fort Myers, Cape Coral and Naples. Each city
          page below covers who issues permits there and what we&rsquo;re most often asked to do.
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
