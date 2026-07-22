import type { Metadata } from 'next'
import { BIZ } from '@/lib/data'
import BreadcrumbJsonLd from '@/components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: `Terms governing use of the ${BIZ.name} website.`,
  robots: { index: true, follow: true },
}

const updated = 'July 22, 2026'

export default function TermsPage() {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Terms of Use', path: '/terms' }]} />
      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <span className="kicker">Legal</span>
          <h1 style={{ marginTop: 10 }}>Terms of Use</h1>
          <p style={{ color: 'var(--slate)', marginTop: 6 }}>Last updated: {updated}</p>

          <p style={{ marginTop: 28 }}>
            These Terms of Use (&ldquo;Terms&rdquo;) govern your use of {BIZ.siteUrl} (the
            &ldquo;Site&rdquo;), operated by {BIZ.name}. By using the Site, you agree to these Terms.
            If you do not agree, please do not use the Site.
          </p>

          <h2 style={{ marginTop: 32 }}>Use of the Site</h2>
          <p>
            The Site is provided to give information about our construction, roofing, repair, and
            remodeling services and to let visitors request estimates or contact us. You agree to use
            the Site only for lawful purposes and not to submit false, misleading, or fraudulent
            information through our forms or chat assistant.
          </p>

          <h2 style={{ marginTop: 32 }}>No Guarantee of Estimates or Availability</h2>
          <p>
            Information on the Site — including service descriptions, financing language, and
            estimated response times — is provided for general informational purposes and does not
            constitute a binding quote, contract, or guarantee. Actual pricing, timelines, financing
            approval, and permit outcomes depend on an in-person assessment of your specific project
            and are confirmed separately in writing.
          </p>

          <h2 style={{ marginTop: 32 }}>AI Chat Assistant</h2>
          <p>
            The chat assistant on this Site is intended to answer general questions about our services
            and service areas. It is not a substitute for a licensed inspection, professional
            structural or legal advice, or a formal written estimate. Responses should not be relied
            upon as final pricing, permitting, insurance, or financing determinations.
          </p>

          <h2 style={{ marginTop: 32 }}>Licensing</h2>
          <p>
            {BIZ.name} is licensed in the State of Florida as a Certified General Contractor
            ({BIZ.licenseGC}) and Certified Roofing Contractor ({BIZ.licenseRoof}). License status can
            be independently verified through the Florida Department of Business and Professional
            Regulation (DBPR).
          </p>

          <h2 style={{ marginTop: 32 }}>Intellectual Property</h2>
          <p>
            The text, photos, videos, and branding on this Site are owned by {BIZ.name} or used with
            permission and may not be copied or reused without our written consent, except as needed
            for normal browser viewing.
          </p>

          <h2 style={{ marginTop: 32 }}>Third-Party Links</h2>
          <p>
            The Site may link to third-party sites (such as our Google or Facebook profiles). We are
            not responsible for the content or privacy practices of those sites.
          </p>

          <h2 style={{ marginTop: 32 }}>Limitation of Liability</h2>
          <p>
            The Site is provided &ldquo;as is&rdquo; without warranties of any kind. To the fullest
            extent permitted by law, {BIZ.name} is not liable for any indirect, incidental, or
            consequential damages arising from your use of the Site.
          </p>

          <h2 style={{ marginTop: 32 }}>Governing Law</h2>
          <p>These Terms are governed by the laws of the State of Florida, without regard to conflict-of-law principles.</p>

          <h2 style={{ marginTop: 32 }}>Changes to These Terms</h2>
          <p>We may revise these Terms from time to time. The &ldquo;Last updated&rdquo; date above reflects the most recent revision.</p>

          <h2 style={{ marginTop: 32 }}>Contact Us</h2>
          <p>
            {BIZ.name}
            <br />{BIZ.address}, {BIZ.cityStateZip}
            <br />Phone: <a href={BIZ.phoneHref}>{BIZ.phone}</a>
            <br />Email: <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a>
          </p>

          <p style={{ marginTop: 32, fontSize: '.85rem', color: 'var(--slate)' }}>
            This page is provided as a general terms-of-use template and does not constitute legal
            advice. Consider having an attorney review it for your specific business.
          </p>
        </div>
      </section>
    </>
  )
}
