import { AREAS_ALL, BIZ } from '@/lib/data'

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
          {AREAS_ALL.map(a => <span className="area" key={a}>{a}</span>)}
        </div>
        <p className="note">
          Don&apos;t see your city listed? <a href={BIZ.phoneHref}>Call {BIZ.phone}</a> to confirm
          availability for your Southwest Florida property.
        </p>
      </div>
    </section>
  )
}
