import type { Metadata } from 'next'
import { BIZ } from '@/lib/data'
import BreadcrumbJsonLd from '@/components/BreadcrumbJsonLd'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${BIZ.name} collects, uses, and protects information submitted through this website.`,
  robots: { index: true, follow: true },
}

const updated = 'July 22, 2026'

export default function PrivacyPage() {
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: 'Privacy Policy', path: '/privacy' }]} />
      <section className="section">
        <div className="container" style={{ maxWidth: 760 }}>
          <span className="kicker">Legal</span>
          <h1 style={{ marginTop: 10 }}>Privacy Policy</h1>
          <p style={{ color: 'var(--slate)', marginTop: 6 }}>Last updated: {updated}</p>

          <p style={{ marginTop: 28 }}>
            {BIZ.name} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates {BIZ.siteUrl}
            (the &ldquo;Site&rdquo;). This Privacy Policy explains what information we collect when you
            use the Site, how we use it, and the choices you have.
          </p>

          <h2 style={{ marginTop: 32 }}>Information We Collect</h2>
          <p>
            <b>Information you provide directly.</b> When you submit our contact or estimate request
            form, we collect the information you enter — typically your name, phone number, email
            address, city, project type, and any message or project details you share.
          </p>
          <p>
            <b>Automatically collected information.</b> Like most websites, we and our service
            providers may automatically collect technical information such as your IP address,
            browser type, device type, pages viewed, and referring site, generally through cookies,
            log files, and analytics tools (for example, Google Analytics).
          </p>
          <p>
            <b>AI chat widget.</b> If you use the chat assistant on this Site, the messages you type are
            sent to our chat service (which may include a third-party AI provider) to generate a
            response. Avoid including sensitive personal information in chat messages.
          </p>

          <h2 style={{ marginTop: 32 }}>How We Use Information</h2>
          <p>We use the information collected to:</p>
          <ul style={{ margin: '10px 0 10px 20px', color: 'var(--slate)' }}>
            <li>Respond to estimate requests and contact inquiries</li>
            <li>Schedule inspections, consultations, and follow-up communication</li>
            <li>Operate, maintain, and improve the Site and the chat assistant</li>
            <li>Understand how visitors use the Site (via aggregated analytics)</li>
            <li>Comply with legal obligations and enforce our terms</li>
          </ul>
          <p>We do not sell your personal information.</p>

          <h2 style={{ marginTop: 32 }}>How We Share Information</h2>
          <p>We may share information with:</p>
          <ul style={{ margin: '10px 0 10px 20px', color: 'var(--slate)' }}>
            <li>
              Service providers who help us operate the Site and respond to leads — for example, our
              email delivery provider (Resend) and, if enabled, an AI chat provider
            </li>
            <li>Analytics providers (for example, Google Analytics), which may use cookies</li>
            <li>Government agencies or authorities, where required by law</li>
          </ul>

          <h2 style={{ marginTop: 32 }}>Cookies &amp; Analytics</h2>
          <p>
            We may use cookies and similar technologies to understand Site traffic and improve the
            visitor experience. You can disable cookies in your browser settings; some Site features
            may not function as intended if you do.
          </p>

          <h2 style={{ marginTop: 32 }}>Data Retention</h2>
          <p>
            We retain contact form submissions for as long as reasonably necessary to respond to your
            inquiry, provide services you request, and meet our business, accounting, and legal
            recordkeeping obligations.
          </p>

          <h2 style={{ marginTop: 32 }}>Your Choices</h2>
          <p>
            You may request that we delete personal information you submitted to us, or ask what
            information we hold about you, by contacting us using the details below. We will respond
            to reasonable requests consistent with applicable law.
          </p>

          <h2 style={{ marginTop: 32 }}>Children&rsquo;s Privacy</h2>
          <p>This Site is intended for adults seeking construction and home-improvement services and is not directed to children under 13.</p>

          <h2 style={{ marginTop: 32 }}>Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The &ldquo;Last updated&rdquo; date
            above reflects the most recent revision.
          </p>

          <h2 style={{ marginTop: 32 }}>Contact Us</h2>
          <p>
            {BIZ.name}
            <br />{BIZ.address}, {BIZ.cityStateZip}
            <br />Phone: <a href={BIZ.phoneHref}>{BIZ.phone}</a>
            <br />Email: <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a>
          </p>

          <p style={{ marginTop: 32, fontSize: '.85rem', color: 'var(--slate)' }}>
            This page is provided as a general privacy policy template and does not constitute legal
            advice. Consider having an attorney review it for your specific business and any
            advertising platforms you use.
          </p>
        </div>
      </section>
    </>
  )
}
