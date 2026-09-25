import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta, BUSINESS_ID, absUrl } from '@/lib/seo'
import { SERVICES } from '@/lib/services'
import Breadcrumbs from '@/components/Breadcrumbs'
import TrustBar from '@/components/TrustBar'
import CtaBand from '@/components/CtaBand'
import JsonLd from '@/components/JsonLd'

export const metadata: Metadata = pageMeta({
  title: 'Services: Roofing, Repairs, Remodels, Pools & Permits',
  description:
    'Roofing and storm repair, ceiling and water-damage repair, pools and lanais, kitchen and bath remodels, impact windows, new construction and permit help in Southwest Florida.',
  path: '/services',
})

const listJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Services',
  itemListElement: SERVICES.map((s, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: absUrl(`/${s.slug}`),
    name: s.title,
  })),
  about: { '@id': BUSINESS_ID },
}

export default function ServicesPage() {
  return (
    <>
      <JsonLd data={listJsonLd} />
      <section className="page-hero page-hero-plain">
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Services', path: '/services' }]} />
          <span className="kicker kicker-light">Roofing license + general contractor license</span>
          <h1>What we build, repair &amp; permit</h1>
          <p className="page-hero-sub">One licensed company from the roof down — and the paperwork that goes with it.</p>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <div className="svc-index">
            {SERVICES.map(s => (
              <Link href={`/${s.slug}`} className="svc-index-card" key={s.slug} data-reveal>
                <div className="svc-index-img">
                  <Image src={s.heroImg} alt={s.heroAlt} fill sizes="(max-width: 760px) 100vw, (max-width: 1080px) 50vw, 33vw" loading="lazy" style={{ objectFit: 'cover' }} />
                </div>
                <div className="svc-index-body">
                  <h2 className="h-sm">{s.title}</h2>
                  <p>{s.metaDescription}</p>
                  <span className="svc-index-more">{s.nav} details →</span>
                </div>
              </Link>
            ))}
            <Link href="/general-contracting-services" className="svc-index-card svc-index-card-text" data-reveal>
              <div className="svc-index-body">
                <h2 className="h-sm">Fences, gutters, epoxy floors, pavers &amp; engineering</h2>
                <p>The smaller jobs owners bundle with bigger work — or call us for on their own.</p>
                <span className="svc-index-more">See these services →</span>
              </div>
            </Link>
          </div>
        </div>
      </section>
      <CtaBand
        title="Not sure which service you need?"
        text="Describe what's going on and we'll tell you what it takes — free inspection, written estimate."
        cta="Get a Free Estimate"
      />
    </>
  )
}
