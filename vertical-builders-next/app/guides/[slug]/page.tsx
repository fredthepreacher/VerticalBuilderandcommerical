import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageMeta, BUSINESS_ID, absUrl } from '@/lib/seo'
import { BIZ } from '@/lib/data'
import { GUIDES, getGuide } from '@/lib/guides'
import Breadcrumbs from '@/components/Breadcrumbs'
import FaqSection from '@/components/FaqSection'
import RelatedLinks from '@/components/RelatedLinks'
import CtaBand from '@/components/CtaBand'
import JsonLd from '@/components/JsonLd'

interface Props { params: { slug: string } }

export const dynamicParams = false

export function generateStaticParams() {
  return GUIDES.map(g => ({ slug: g.slug }))
}

export function generateMetadata({ params }: Props): Metadata {
  const g = getGuide(params.slug)
  if (!g) return {}
  return pageMeta({
    title: g.metaTitle,
    description: g.description,
    path: `/guides/${g.slug}`,
    image: g.image,
    imageAlt: g.imageAlt,
    type: 'article',
  })
}

const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default function GuidePage({ params }: Props) {
  const g = getGuide(params.slug)
  if (!g) notFound()

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.description,
    image: absUrl(g.image),
    datePublished: g.updated,
    dateModified: g.updated,
    mainEntityOfPage: absUrl(`/guides/${g.slug}`),
    author: { '@id': BUSINESS_ID },
    publisher: { '@id': BUSINESS_ID },
    citation: g.sources.map(s => s.href),
  }

  return (
    <>
      <JsonLd data={articleJsonLd} />
      <section className="page-hero page-hero-guide">
        <div className="hero-media">
          <Image src={g.image} alt={g.imageAlt} fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
        </div>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Guides', path: '/guides' }, { name: g.title, path: `/guides/${g.slug}` }]} />
          <span className="kicker kicker-light">Homeowner guide · Updated <time dateTime={g.updated}>{fmt(g.updated)}</time></span>
          <h1>{g.title}</h1>
        </div>
      </section>
      <article className="section">
        <div className="container article">
          <div className="answer-card answer-card-lg">
            <span className="answer-label">The short answer</span>
            <p>{g.answer}</p>
          </div>
          {g.sections.map(s => (
            <section key={s.h} className="article-sec">
              <h2 className="h-md">{s.h}</h2>
              {s.p.map(p => <p key={p.slice(0, 40)}>{p}</p>)}
              {s.list && <ul className="tick-list">{s.list.map(li => <li key={li}>{li}</li>)}</ul>}
            </section>
          ))}
          <aside className="article-byline">
            <p>
              Written by the team at <Link href="/about">{BIZ.name}</Link>, a Florida Certified General Contractor
              ({BIZ.licenseGC}) and Certified Roofing Contractor ({BIZ.licenseRoof}) in Nokomis. This is general
              information, not legal or insurance advice — rules change, and your policy and building department
              have the final word.
            </p>
            {g.sources.length > 0 && (
              <>
                <h2 className="h-xs">Sources</h2>
                <ul className="source-list">
                  {g.sources.map(s => (
                    <li key={s.href}><a href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a></li>
                  ))}
                </ul>
              </>
            )}
          </aside>
        </div>
      </article>
      <FaqSection faqs={g.faqs} title="Related questions" tone="tint" />
      <RelatedLinks services={g.services} guides={GUIDES.filter(x => x.slug !== g.slug).slice(0, 2).map(x => x.slug)} title="Related services & guides" />
      <CtaBand
        title="Want a professional opinion on your home?"
        text="Inspections and estimates are free. You'll get a written scope — and straight answers."
        cta="Get a Free Estimate"
      />
    </>
  )
}
