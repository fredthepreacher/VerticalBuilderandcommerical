import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BIZ } from '@/lib/data'
import { SERVICE_AREAS, getServiceArea, permitNote } from '@/lib/serviceAreas'
import { pageMeta, BUSINESS_ID } from '@/lib/seo'
import Breadcrumbs from '@/components/Breadcrumbs'
import TrustBar from '@/components/TrustBar'
import CtaBand from '@/components/CtaBand'
import JsonLd from '@/components/JsonLd'
import RelatedLinks from '@/components/RelatedLinks'

interface Props { params: { slug: string } }

export function generateStaticParams() {
  return SERVICE_AREAS.map(a => ({ slug: a.slug }))
}

export function generateMetadata({ params }: Props): Metadata {
  const area = getServiceArea(params.slug)
  if (!area) return {}
  return pageMeta({
    title: `Roofing & General Contractor in ${area.name}, FL`,
    description: `Licensed roofing & general contractor serving ${area.name}, FL: roof replacement, storm and ceiling repair, pools, lanais, remodels and permits. Free estimates.`,
    path: `/service-areas/${area.slug}`,
  })
}

const CORE_SERVICES: { name: string; href: string }[] = [
  { name: 'Roofing & Storm Protection', href: '/roofing' },
  { name: 'Ceiling / Interior / Water Damage Repair', href: '/interior-repair' },
  { name: 'Pools, Lanais & Outdoor Living', href: '/pools-lanais' },
  { name: 'New Construction', href: '/new-construction' },
  { name: 'Kitchen & Bathroom Remodels', href: '/kitchen-bath-remodels' },
  { name: 'Impact Windows & Doors', href: '/impact-windows-doors' },
  { name: 'Permitting & Unpermitted Work Help', href: '/permitting-help' },
  { name: 'Fences, Epoxy, Pavers & Engineering', href: '/general-contracting-services' },
  { name: 'Commercial Construction', href: '/contact?service=Commercial' },
]

export default function ServiceAreaPage({ params }: Props) {
  const area = getServiceArea(params.slug)
  if (!area) notFound()

  const permit = permitNote(area)
  const faqs = [
    {
      q: `Who issues building permits in ${area.name}?`,
      a: permit,
    },
    {
      q: `Do you serve ${area.name}, FL?`,
      a: `Yes. Vertical Builders and Commercial serves ${area.name} and surrounding Southwest Florida communities with licensed contractor, roofing, interior repair, pool, lanai, and outdoor living services.`,
    },
    {
      q: `What services do you provide in ${area.name}?`,
      a: 'The company provides roofing, storm protection, ceiling repair, interior restoration, pools, lanais, outdoor living improvements, new construction, general contracting, and commercial construction services.',
    },
    {
      q: `Can I request an estimate for a ${area.name} property?`,
      a: `Yes. Property owners can call ${BIZ.phone} or submit the website form to request an estimate.`,
    },
    {
      q: `Are you licensed to work in ${area.county}?`,
      a: `Yes. Vertical Builders and Commercial holds statewide Florida licenses — Certified General Contractor ${BIZ.licenseGC} and Certified Roofing Contractor ${BIZ.licenseRoof} — valid throughout ${area.county} and all of Florida.`,
    },
  ]

  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${BIZ.siteUrl}/service-areas/${area.slug}#service`,
    name: `Roofing & General Contracting in ${area.name}, FL`,
    serviceType: 'General contracting, roofing, interior repair, pools, lanais, outdoor living, commercial construction',
    areaServed: { '@type': 'Place', name: `${area.name}, Florida`, containedInPlace: { '@type': 'AdministrativeArea', name: `${area.county}, Florida` } },
    url: `${BIZ.siteUrl}/service-areas/${area.slug}`,
    provider: { '@id': BUSINESS_ID },
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  const nearby = area.nearby.map(getServiceArea).filter(Boolean)

  return (
    <>
      <JsonLd data={serviceJsonLd} />
      <JsonLd data={faqJsonLd} />
      <section className="page-hero page-hero-plain">
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[
            { name: 'Service Areas', path: '/service-areas' },
            { name: area.name, path: `/service-areas/${area.slug}` },
          ]} />
          <span className="kicker kicker-light">{area.county}</span>
          <h1>Roofing &amp; General Contractor in {area.name}, FL</h1>
          <p className="page-hero-sub">Licensed for roofing and general contracting · Office in Nokomis · Free estimates</p>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              <h2>Licensed Contractor Services in {area.name}</h2>
              <p style={{ marginTop: 18 }}>{area.intro}</p>
              <p>{area.localAngle}</p>
              <div className="answer-card">
                <span className="answer-label">Permits in {area.name}</span>
                <p>{permit}</p>
              </div>
              <p>
                Vertical Builders and Commercial is a licensed Florida general contractor and roofing
                contractor serving {area.name} and the broader Southwest Florida region from our office
                in Nokomis. Residential and commercial property owners can request an estimate by
                calling <a href={BIZ.phoneHref} style={{ color: 'var(--accent)', fontWeight: 600 }}>{BIZ.phone}</a> or
                submitting the website form.
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                <Link className="btn btn-accent" href="/contact" data-track={`cta_area_${area.slug}`}>Get a Free Estimate in {area.name}</Link>
                <a className="btn btn-ghost" href={BIZ.phoneHref}>Call {BIZ.phone}</a>
              </div>
            </div>
            <div className="license-card">
              <h3>Services in {area.name}</h3>
              <ul>
                {CORE_SERVICES.map(s => (
                  <li key={s.name}><Link href={s.href}>{s.name}</Link></li>
                ))}
              </ul>
              <p style={{ marginTop: 16, fontSize: '.88rem', color: 'var(--slate)' }}>
                Licensed &amp; insured: GC {BIZ.licenseGC} · Roofing {BIZ.licenseRoof}.{' '}
                <Link href="/gallery" style={{ color: 'var(--accent)', fontWeight: 600 }}>See our work</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section className="section areas">
        <div className="container">
          <span className="kicker">Questions</span>
          <h2>{area.name} questions</h2>
          <div className="faq-list">
            {faqs.map(f => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          {nearby.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <h3 style={{ color: 'var(--navy)', fontSize: '1.1rem' }}>Nearby Service Areas</h3>
              <div className="area-list">
                {nearby.map(n => (
                  <Link className="area" key={n!.slug} href={`/service-areas/${n!.slug}`}>{n!.name}</Link>
                ))}
              </div>
              <p className="note">
                <Link href="/service-areas" style={{ color: 'var(--accent)', fontWeight: 600 }}>View all Southwest Florida service areas →</Link>
              </p>
            </div>
          )}
        </div>
      </section>
      <RelatedLinks
        title="Before you call"
        guides={['unpermitted-work-after-the-fact-permits', 'florida-roof-25-percent-rule', 'roof-age-and-home-insurance-florida']}
      />
      <CtaBand
        title={`Planning a project in ${area.name}?`}
        text="Get a clear written scope and estimate from a licensed Florida contractor — roofing, repair, remodel, or outdoor living."
        cta="Schedule a Project Consultation"
      />
    </>
  )
}
