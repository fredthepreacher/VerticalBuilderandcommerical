import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta, BUSINESS_ID, absUrl } from '@/lib/seo'
import { BIZ } from '@/lib/data'
import TrustBar from '@/components/TrustBar'
import Breadcrumbs from '@/components/Breadcrumbs'
import ReviewsSection from '@/components/ReviewsSection'
import ProcessSection from '@/components/ProcessSection'
import CtaBand from '@/components/CtaBand'
import JsonLd from '@/components/JsonLd'

export const metadata: Metadata = pageMeta({
  title: 'About Us — Licensed Contractor in Nokomis, FL',
  description:
    'A Nokomis, FL contractor holding both a Florida Certified General Contractor (CGC1528626) and Certified Roofing Contractor (CCC1333649) license. Owned and run by Eddie Ramon.',
  path: '/about',
  image: '/images/new-construction.webp',
})

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  url: absUrl('/about'),
  name: `About ${BIZ.name}`,
  about: { '@id': BUSINESS_ID },
  mainEntity: { '@id': BUSINESS_ID },
}

export default function AboutPage() {
  return (
    <>
      <JsonLd data={aboutJsonLd} />
      <section className="page-hero">
        <div className="hero-media">
          <Image src="/images/new-construction.webp" alt="Newly constructed home in Southwest Florida" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
        </div>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'About', path: '/about' }]} />
          <span className="kicker kicker-light">Who we are</span>
          <h1>A licensed contractor you can actually reach</h1>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              <h2 className="h-md">Built on licenses, permits &amp; follow-through</h2>
              <p style={{ marginTop: 18 }}>
                Vertical Builders &amp; Commercial is a construction company based in Nokomis, Florida, serving
                homeowners and businesses across Southwest Florida — from Bradenton and Sarasota down to Fort Myers,
                Cape Coral and Naples. We hold two state certifications: a Florida Certified General Contractor license
                and a Certified Roofing Contractor license. That means one accountable company can handle your roof,
                the interior repairs under it, and the outdoor living space behind the house.
              </p>
              <p>
                A lot of our work starts where someone else left off: storm damage that needs more than a patch,
                unpermitted work that needs to be made right with the county, or a remodel that stalled. We pull the
                permits, manage the inspections, and walk the finished job with you.
              </p>
              <h3 className="h-xs">Owned and run locally</h3>
              <p>
                The company is owned and managed by <b>{BIZ.ownerName}</b>. Customers mention Eddie by name in their
                reviews — often for the part of the job most contractors avoid: working through the permit process
                with the county until it&rsquo;s closed.
              </p>
              <p>
                You deal with a real local office on S Tamiami Trail — not a call center. Call{' '}
                <a href={BIZ.phoneHref} className="text-link">{BIZ.phone}</a> and ask for Eddie.
              </p>
              <div className="inline-ctas">
                <Link className="btn btn-accent" href="/contact">Get a Free Estimate</Link>
                <Link className="btn btn-ghost" href="/gallery">See our work</Link>
              </div>
            </div>
            <aside className="placard" aria-labelledby="placard-title" data-reveal>
              <p className="placard-eyebrow">State of Florida certifications</p>
              <h2 id="placard-title" className="placard-title">Licensed &amp; insured</h2>
              <dl className="placard-rows">
                <div><dt>Certified General Contractor</dt><dd>{BIZ.licenseGC}</dd></div>
                <div><dt>Certified Roofing Contractor</dt><dd>{BIZ.licenseRoof}</dd></div>
                <div><dt>Office</dt><dd>{BIZ.address}<br />{BIZ.cityStateZip}</dd></div>
                <div><dt>Phone</dt><dd><a href={BIZ.phoneHref}>{BIZ.phone}</a></dd></div>
                <div><dt>Email</dt><dd><a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></dd></div>
              </dl>
              <a className="placard-verify" href={BIZ.licenseLookup} target="_blank" rel="noopener noreferrer">
                Verify on the Florida DBPR license search →
              </a>
            </aside>
          </div>
        </div>
      </section>
      <ProcessSection />
      <ReviewsSection />
      <CtaBand
        title="Have a project in mind?"
        text="Roof, repair, remodel, or outdoor living — get a clear scope and estimate from a licensed contractor."
        cta="Get a Free Estimate"
      />
    </>
  )
}
