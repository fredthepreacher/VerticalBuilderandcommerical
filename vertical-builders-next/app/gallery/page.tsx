import type { Metadata } from 'next'
import { pageMeta, BUSINESS_ID, absUrl } from '@/lib/seo'
import { GALLERY, fullSrc } from '@/lib/gallery'
import JsonLd from '@/components/JsonLd'
import GalleryGrid from '@/components/GalleryGrid'
import Breadcrumbs from '@/components/Breadcrumbs'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = {
  ...pageMeta({
    title: 'Project Gallery — Roofing, Pools, Lanais & Remodels',
    description: 'Browse real project photos from Vertical Builders & Commercial: roofing and storm recovery, pool builds, screened lanais, interior remodels and new construction across Southwest Florida.',
    path: '/gallery',
  image: '/images/pool-spa-finished.webp',
  }),
}

// Original project photography, described for image search. Creator and
// copyright point at the business entity — these are the company's own photos.
const galleryJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ImageGallery',
  name: 'Project gallery',
  url: absUrl('/gallery'),
  about: { '@id': BUSINESS_ID },
  image: GALLERY.map(g => ({
    '@type': 'ImageObject',
    contentUrl: absUrl(fullSrc(g)),
    caption: g.alt,
    width: g.w,
    height: g.h,
    creator: { '@id': BUSINESS_ID },
    copyrightHolder: { '@id': BUSINESS_ID },
  })),
}

export default function GalleryPage() {
  return (
    <>
      <JsonLd data={galleryJsonLd} />
      <section className="page-hero page-hero-plain">
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Project Gallery', path: '/gallery' }]} />
          <span className="kicker kicker-light">Our work</span>
          <h1>Project gallery</h1>
          <p className="page-hero-sub">Roofing, pools, lanais, remodels and new builds — every photo is our own crews&rsquo; work.</p>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <span className="kicker">Real Projects</span>
          <h2>Browse by Category</h2>
          <p className="section-intro">A curated selection of featured projects — every photo is our own crew&apos;s work across Southwest Florida, no stock imagery. More project photos are added as jobs complete.</p>
          <GalleryGrid />
        </div>
      </section>
      <CtaBand
        title="Like What You See?"
        text="Tell us about your project and we'll bring the same quality to your home."
        cta="Request a Southwest Florida Estimate"
      />
    </>
  )
}
