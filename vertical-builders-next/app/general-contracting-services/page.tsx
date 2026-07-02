import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { BIZ } from '@/lib/data'
import BreadcrumbJsonLd from '@/components/BreadcrumbJsonLd'
import TrustBar from '@/components/TrustBar'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = {
  title: 'Additional General Contracting Services in Southwest Florida',
  description:
    'Fences and gutters, epoxy flake flooring, pavers and concrete pours, and structural engineering coordination — licensed general contracting services by Vertical Builders and Commercial across Southwest Florida.',
}

const ITEMS = [
  {
    id: 'fences-gutters',
    title: 'Fences & Gutters',
    img: '/images/roof-finished-aerial.webp',
    alt: 'Completed home exterior with new roofline and gutters',
    copy: 'New fence installation and repair, plus seamless gutter replacement that protects your roofline and foundation. Both are permitted where required — and if a previous installer skipped the permit, we can resolve that too.',
    links: [{ label: 'Permitting help', href: '/permitting-help' }, { label: 'Roofing services', href: '/roofing' }],
  },
  {
    id: 'epoxy-flooring',
    title: 'Epoxy Flake Flooring',
    img: '/gallery/pools-outdoor/full/epoxy-garage-floor.webp',
    alt: 'Epoxy flake garage floor coating installation',
    copy: 'Durable, decorative epoxy flake coatings for garages, lanais, and utility spaces. Properly prepped, moisture-tested, and finished — a floor that handles Florida humidity, tires, and tools.',
    links: [{ label: 'See finished floors in the gallery', href: '/gallery' }],
  },
  {
    id: 'pavers-concrete',
    title: 'Pavers & Concrete Pours',
    img: '/gallery/new-construction/full/concrete-driveway.webp',
    alt: 'New concrete driveway pour on a construction project',
    copy: 'Driveways, walkways, pool decks, and patio slabs — formed, poured, and finished by licensed crews. Paver installation with proper base prep and sealing for lasting results in Gulf Coast weather.',
    links: [{ label: 'Pools & outdoor living', href: '/pools-lanais' }],
  },
  {
    id: 'structural-engineering',
    title: 'Structural Engineering Services',
    img: '/gallery/new-construction/full/framing-stairs.webp',
    alt: 'Interior framing and structural work on a new build',
    copy: 'Engineering coordination with private inspections for structural repairs, openings, additions, and after-the-fact permit resolutions. We bring the engineer, the paperwork, and the licensed crew — one accountable process.',
    links: [{ label: 'Permitting & unpermitted work help', href: '/permitting-help' }, { label: 'New construction', href: '/new-construction' }],
  },
]

const FAQS = [
  { q: 'Do these smaller projects really need a licensed contractor?', a: 'Many of them legally require permits — fences, structural changes, and concrete work in certain zones. A licensed GC protects you at resale and with insurance, and we handle the paperwork.' },
  { q: 'Can you bundle these with a larger project?', a: 'Yes, and it usually saves money — gutters with a re-roof, epoxy floors with a remodel, pavers with a pool build. One permit package, one schedule, one crew mobilization.' },
  { q: 'Do you serve all of Southwest Florida for these services?', a: `Yes — the same coverage as our core services: Sarasota, Manatee, Charlotte, Lee, Collier, and DeSoto counties. Call ${BIZ.phone} to confirm scheduling for your area.` },
]

const serviceJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Additional General Contracting Services in Southwest Florida',
  serviceType: 'Fences, gutters, epoxy flooring, pavers, concrete, structural engineering coordination',
  areaServed: 'Southwest Florida',
  url: `${BIZ.siteUrl}/general-contracting-services`,
  provider: { '@type': 'GeneralContractor', name: BIZ.name, telephone: '+1-941-877-2009', url: BIZ.siteUrl },
}

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
}

export default function Page() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <BreadcrumbJsonLd crumbs={[{ name: 'General Contracting Services', path: '/general-contracting-services' }]} />
      <section className="page-hero" style={{ minHeight: '34vh' }}>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <span className="kicker">Licensed &amp; Insured · Serving All of Southwest Florida</span>
          <h1>Additional General Contracting Services</h1>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <span className="kicker">Beyond the Big Three</span>
          <h2>The Smaller Jobs, Done Right</h2>
          <p className="section-intro">
            Not every project is a new roof or a pool. These are the services Southwest Florida
            homeowners bundle with bigger work — or call us for on their own — all under the same
            licensed, insured, permitted process (GC {BIZ.licenseGC} · Roofing {BIZ.licenseRoof}).
          </p>
          <div className="gc-items">
            {ITEMS.map(item => (
              <div className="gc-item" key={item.id} id={item.id}>
                <div className="gc-item-img">
                  <Image src={item.img} alt={item.alt} fill sizes="(max-width: 960px) 100vw, 40vw" loading="lazy" style={{ objectFit: 'cover' }} />
                </div>
                <div className="gc-item-body">
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                  <div className="gc-item-links">
                    {item.links.map(l => <Link key={l.href + l.label} href={l.href}>{l.label} →</Link>)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section areas">
        <div className="container">
          <span className="kicker">Questions</span>
          <h2>Frequently Asked Questions</h2>
          <div className="faq-list">
            {FAQS.map(f => (
              <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
            ))}
          </div>
        </div>
      </section>
      <CtaBand
        title="Get a Licensed Contractor Estimate"
        text="Big or small, every project gets a clear written scope, a real license number behind it, and a crew that shows up."
        cta="Request an Estimate"
      />
    </>
  )
}
