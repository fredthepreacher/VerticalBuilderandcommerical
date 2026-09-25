import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMeta } from '@/lib/seo'
import { BIZ } from '@/lib/data'
import { SERVICE_AREAS, type ServiceArea } from '@/lib/serviceAreas'
import Breadcrumbs from '@/components/Breadcrumbs'
import FaqSection from '@/components/FaqSection'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = pageMeta({
  title: 'Service Areas in Southwest Florida',
  description:
    `Roofing and general contracting in ${SERVICE_AREAS.length} Southwest Florida communities from Bradenton to Naples. Find your city and who issues permits there.`,
  path: '/service-areas',
})

// Group by the first county named, in the order a Nokomis-based crew reaches them.
const COUNTY_ORDER = ['Sarasota County', 'Sarasota & Charlotte Counties', 'Charlotte County', 'Manatee County', 'Manatee & Sarasota Counties', 'DeSoto County', 'Lee County', 'Collier County']
const GROUP_LABEL: Record<string, string> = {
  'Sarasota County': 'Sarasota County',
  'Sarasota & Charlotte Counties': 'Sarasota County',
  'Charlotte County': 'Charlotte County',
  'Manatee County': 'Manatee County',
  'Manatee & Sarasota Counties': 'Manatee County',
  'DeSoto County': 'DeSoto County',
  'Lee County': 'Lee County',
  'Collier County': 'Collier County',
}

function grouped() {
  const map = new Map<string, ServiceArea[]>()
  for (const county of COUNTY_ORDER) {
    for (const a of SERVICE_AREAS.filter(x => x.county === county)) {
      const key = GROUP_LABEL[county]
      map.set(key, [...(map.get(key) ?? []), a])
    }
  }
  return Array.from(map.entries())
}

const AREA_FAQS = [
  { q: 'Where is Vertical Builders and Commercial located?', a: `The office is at ${BIZ.address}, ${BIZ.cityStateZip}, in Sarasota County. We serve Southwest Florida from there.` },
  { q: 'Are your licenses valid in every county you serve?', a: `Yes. Florida Certified General Contractor (${BIZ.licenseGC}) and Certified Roofing Contractor (${BIZ.licenseRoof}) licenses are state certifications, valid statewide.` },
  { q: 'My city isn’t listed. Do you still work there?', a: `Possibly — we also take projects in surrounding communities such as LaBelle and Immokalee. Call ${BIZ.phone} with the address and project and we’ll tell you straight away.` },
  { q: 'How do I know whether the city or the county issues my permit?', a: 'It depends on whether the property is inside city limits, not on the mailing address. Each city page below explains how it works there, and we confirm the jurisdiction before filing any permit.' },
]

export default function ServiceAreasPage() {
  const groups = grouped()
  return (
    <>
      <section className="page-hero page-hero-plain">
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Service Areas', path: '/service-areas' }]} />
          <span className="kicker kicker-light">From our Nokomis office</span>
          <h1>Where we work in Southwest Florida</h1>
          <p className="page-hero-sub">{SERVICE_AREAS.length} communities across six counties — pick yours to see local permitting and services.</p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          {groups.map(([county, areas]) => (
            <div className="county-group" key={county} data-reveal>
              <h2 className="h-sm">{county}</h2>
              <div className="area-cards">
                {areas.map(a => (
                  <Link className="area-card" key={a.slug} href={`/service-areas/${a.slug}`}>
                    <h3>{a.name}</h3>
                    <span>{a.county}</span>
                    <span className="area-card-cta">Services &amp; permits →</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <p className="note" style={{ marginTop: 26 }}>
            Don&apos;t see your city? We serve surrounding Southwest Florida communities too —{' '}
            <a href={BIZ.phoneHref} className="text-link">call {BIZ.phone}</a> to confirm availability.
          </p>
        </div>
      </section>
      <FaqSection faqs={AREA_FAQS} title="Service area questions" tone="tint" />
      <CtaBand
        title="Request a Southwest Florida estimate"
        text="Tell us where your property is and what you're planning — we'll take it from there."
        cta="Get a Free Estimate"
      />
    </>
  )
}
