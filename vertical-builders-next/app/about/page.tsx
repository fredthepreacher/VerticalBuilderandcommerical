import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { BIZ } from '@/lib/data'
import TrustBar from '@/components/TrustBar'
import ReviewsSection from '@/components/ReviewsSection'
import AreasSection from '@/components/AreasSection'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = {
  title: 'About — Licensed Florida General & Roofing Contractor',
  description:
    'Vertical Builders & Commercial is a licensed and insured Florida general contractor (CGC1528626) and roofing contractor (CCC1333649) based in Nokomis, serving Southwest Florida.',
}

export default function AboutPage() {
  return (
    <>
      <section className="page-hero">
        <div className="hero-media">
          <Image src="/images/new-construction.webp" alt="Newly constructed home in Southwest Florida" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
        </div>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <span className="kicker">Who We Are</span>
          <h1>A Licensed Contractor You Can Actually Reach</h1>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              <h2>Built on Licenses, Permits &amp; Follow-Through</h2>
              <p style={{ marginTop: 18 }}>
                Vertical Builders &amp; Commercial is a Nokomis-based construction company serving
                homeowners and property owners across Sarasota and Charlotte Counties. We hold both a
                Florida Certified General Contractor license and a Certified Roofing Contractor
                license — which means one accountable company can handle your roof, the interior
                repairs under it, and the outdoor living space behind the house.
              </p>
              <p>
                A lot of our work starts where other contractors left off: storm damage that needs
                more than a patch, unpermitted work that needs to be made right with the county, or a
                remodel that stalled. We pull the permits, manage the inspections, and walk the
                finished job with you.
              </p>
              <p>
                You deal with a real local office on S Tamiami Trail — not a call center. Call{' '}
                <a href={BIZ.phoneHref} style={{ color: 'var(--accent)', fontWeight: 600 }}>{BIZ.phone}</a> and ask for Eddie.
              </p>
              <Link className="btn btn-accent" href="/contact" style={{ marginTop: 10 }}>Request a Free Estimate</Link>
            </div>
            <div className="license-card">
              <h3>Licensed &amp; Insured</h3>
              <ul>
                <li><b>General Contractor:</b> {BIZ.licenseGC}</li>
                <li><b>Roofing Contractor:</b> {BIZ.licenseRoof}</li>
                <li><b>Office:</b> {BIZ.address}, {BIZ.cityStateZip}</li>
                <li><b>Phone:</b> <a href={BIZ.phoneHref}>{BIZ.phone}</a></li>
                <li><b>Email:</b> <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></li>
                <li>
                  <b>Verify our licenses:</b>{' '}
                  <a href="https://www.myfloridalicense.com/wl11.asp" target="_blank" rel="noopener noreferrer">
                    Florida DBPR license search
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
      <ReviewsSection />
      <AreasSection />
      <CtaBand
        title="Have a Project in Mind?"
        text="Roof, repair, remodel, or outdoor living — get a clear scope and estimate from a licensed contractor."
        cta="Get Started"
      />
    </>
  )
}
