import type { Metadata } from 'next'
import { BIZ } from '@/lib/data'
import QuoteForm from '@/components/QuoteForm'
import FaqSection from '@/components/FaqSection'

export const metadata: Metadata = {
  title: 'Contact — Request a Free Estimate',
  description:
    'Request a free roofing inspection or project estimate from Vertical Builders & Commercial. Call 941-877-2009 or send the form — Nokomis, Venice, Sarasota, North Port & Port Charlotte.',
}

export default function ContactPage() {
  return (
    <>
      <section className="section contact" style={{ paddingTop: 150 }}>
        <div className="container">
          <span className="kicker kicker-light">Get Started</span>
          <h2>Request Your Free Estimate</h2>
          <div className="contact-grid">
            <div className="contact-info">
              <p className="big"><a href={BIZ.phoneHref}>{BIZ.phone}</a></p>
              <p><a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></p>
              <p>{BIZ.address}<br />{BIZ.cityStateZip}</p>
              <p>GC License {BIZ.licenseGC}<br />Roofing License {BIZ.licenseRoof}</p>
              <p>Tell us about your project and we&apos;ll get back to you fast with next steps — usually the same business day.</p>
            </div>
            <QuoteForm />
          </div>
        </div>
      </section>
      <FaqSection />
    </>
  )
}
