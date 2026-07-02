import { AREAS, BIZ } from '@/lib/data'

export default function AreasSection() {
  return (
    <section className="section areas">
      <div className="container">
        <span className="kicker">Where We Work</span>
        <h2>Serving Sarasota &amp; Charlotte Counties</h2>
        <div className="area-list">
          {AREAS.map(a => <span className="area" key={a}>{a}</span>)}
        </div>
        <p className="note">
          …and surrounding Southwest Florida communities. Not sure if we cover your area?{' '}
          <a href={BIZ.phoneHref}>Call us</a> — we probably do.
        </p>
      </div>
    </section>
  )
}
