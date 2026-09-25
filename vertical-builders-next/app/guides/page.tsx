import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { pageMeta } from '@/lib/seo'
import { GUIDES } from '@/lib/guides'
import Breadcrumbs from '@/components/Breadcrumbs'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = pageMeta({
  title: 'Homeowner Guides: Florida Roofs, Insurance & Permits',
  description:
    'Sourced, plain-English guides for Southwest Florida homeowners: the 25% roof rule, roof age and insurance, after-the-fact permits, and what to do after a roof leak.',
  path: '/guides',
})

const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default function GuidesPage() {
  return (
    <>
      <section className="page-hero page-hero-plain">
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Guides', path: '/guides' }]} />
          <span className="kicker kicker-light">Homeowner guides</span>
          <h1>Straight answers on Florida roofs, insurance &amp; permits</h1>
          <p className="page-hero-sub">Written by a licensed contractor, with the statute or agency linked for every rule we quote.</p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="guide-grid">
            {GUIDES.map(g => (
              <Link href={`/guides/${g.slug}`} className="guide-card" key={g.slug} data-reveal>
                <div className="guide-card-img">
                  <Image src={g.image} alt={g.imageAlt} fill sizes="(max-width: 760px) 100vw, 50vw" loading="lazy" style={{ objectFit: 'cover' }} />
                </div>
                <div className="guide-card-body">
                  <span className="guide-date">Updated {fmt(g.updated)}</span>
                  <h2 className="h-sm">{g.title}</h2>
                  <p>{g.description}</p>
                  <span className="svc-index-more">Read the guide →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <CtaBand
        title="Rather talk it through?"
        text="Call the office and ask — or book a free inspection and we'll answer with your roof in front of us."
        cta="Get a Free Estimate"
      />
    </>
  )
}
