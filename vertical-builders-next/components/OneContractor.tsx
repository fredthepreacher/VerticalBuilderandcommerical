import Link from 'next/link'
import { BIZ } from '@/lib/data'

/**
 * The client's real, verifiable differentiator: two state certifications
 * (roofing + general contracting) under one company, plus permit work. Most
 * local competitors hold one or the other.
 */
const COLS = [
  {
    tag: 'Roofing license',
    num: BIZ.licenseRoof,
    title: 'The roof',
    text: 'Inspections, storm tarps and dry-in, repairs and full replacement — shingle, metal, tile and flat.',
    href: '/roofing',
    link: 'Roofing & storm protection',
  },
  {
    tag: 'General contractor license',
    num: BIZ.licenseGC,
    title: 'Everything under it',
    text: 'Ceilings, drywall, insulation and flooring after a leak — plus kitchens, baths, additions, pools and lanais.',
    href: '/interior-repair',
    link: 'Interior & water-damage repair',
  },
  {
    tag: 'Both licenses, one contract',
    num: 'Permits',
    title: 'The paperwork',
    text: 'We pull the permits, schedule the inspections and fix work that was never permitted in the first place.',
    href: '/permitting-help',
    link: 'Permitting & unpermitted work',
  },
]

export default function OneContractor() {
  return (
    <section className="section one-gc" aria-labelledby="one-gc-title">
      <div className="container">
        <div className="one-gc-head" data-reveal>
          <span className="kicker">Why homeowners call us</span>
          <h2 id="one-gc-title">A roof leak is two jobs. We&rsquo;re licensed for both.</h2>
          <p className="section-intro">
            Water that gets through a roof ends up in a ceiling. Most companies can fix one or the other, so owners
            end up coordinating a roofer, a repair crew and the permits themselves. We hold a Florida
            Certified Roofing Contractor license <em>and</em> a Certified General Contractor license — one
            company, one schedule, one number to call.
          </p>
        </div>
        <ol className="one-gc-cols">
          {COLS.map((c, i) => (
            <li key={c.title} className="one-gc-col" data-reveal style={{ ['--d' as string]: `${i * 90}ms` }}>
              <span className="one-gc-tag">{c.tag}</span>
              <span className="one-gc-num">{c.num}</span>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <Link href={c.href}>{c.link} →</Link>
            </li>
          ))}
        </ol>
        <p className="one-gc-verify">
          Don&rsquo;t take our word for it —{' '}
          <a href={BIZ.licenseLookup} target="_blank" rel="noopener noreferrer">verify both licenses on the Florida DBPR license search</a>.
        </p>
      </div>
    </section>
  )
}
