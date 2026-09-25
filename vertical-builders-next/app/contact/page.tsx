import type { Metadata } from 'next'
import { pageMeta, BUSINESS_ID, absUrl } from '@/lib/seo'
import { BIZ } from '@/lib/data'
import QuoteForm from '@/components/QuoteForm'
import FaqSection from '@/components/FaqSection'
import Breadcrumbs from '@/components/Breadcrumbs'
import JsonLd from '@/components/JsonLd'

export const metadata: Metadata = pageMeta({
  title: 'Get a Free Estimate — Contact Us',
  description:
    'Request a free roof inspection or project estimate from Vertical Builders & Commercial in Nokomis, FL. Call 941-877-2009 or send the form — we usually reply the same business day.',
  path: '/contact',
})

const NEXT_STEPS = [
  { t: 'We call you back', d: 'Usually the same business day, to ask a few questions about the project.' },
  { t: 'We see the property', d: 'A free inspection or on-site consultation at a time that suits you.' },
  { t: 'You get it in writing', d: 'A written scope and estimate. Nothing is scheduled until you approve it.' },
]

const contactJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ContactPage',
  url: absUrl('/contact'),
  name: `Contact ${BIZ.name}`,
  about: { '@id': BUSINESS_ID },
}

export default function ContactPage() {
  return (
    <>
      <JsonLd data={contactJsonLd} />
      <section className="section contact contact-top">
        <div className="container">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Contact', path: '/contact' }]} />
          <span className="kicker kicker-light">Free estimates &amp; inspections</span>
          <h1>Tell us about your project</h1>
          <div className="contact-grid">
            <div className="contact-info">
              <p className="big"><a href={BIZ.phoneHref} data-track="call_contact">{BIZ.phone}</a></p>
              <p><a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></p>
              <p>{BIZ.address}<br />{BIZ.cityStateZip}</p>
              <p className="contact-lic">GC License {BIZ.licenseGC} · Roofing License {BIZ.licenseRoof}</p>
              <h2 className="next-title">What happens next</h2>
              <ol className="next-steps">
                {NEXT_STEPS.map((s, i) => (
                  <li key={s.t}><span>{i + 1}</span><div><b>{s.t}</b><p>{s.d}</p></div></li>
                ))}
              </ol>
              <p className="contact-emergency">Water coming in right now? Call instead of using the form — it&rsquo;s faster.</p>
            </div>
            <QuoteForm />
          </div>
        </div>
      </section>
      <FaqSection />
    </>
  )
}
