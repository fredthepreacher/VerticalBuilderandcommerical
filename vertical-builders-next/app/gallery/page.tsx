import type { Metadata } from 'next'
import GalleryGrid from '@/components/GalleryGrid'
import CtaBand from '@/components/CtaBand'

export const metadata: Metadata = {
  title: 'Project Gallery — Roofing, Pools, Lanais & Remodels',
  description:
    'Browse real project photos from Vertical Builders & Commercial: roofing and storm recovery, pool builds, screened lanais, interior remodels and new construction across Southwest Florida.',
}

export default function GalleryPage() {
  return (
    <>
      <section className="page-hero" style={{ minHeight: '34vh' }}>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <span className="kicker">Our Work</span>
          <h1>Project Gallery</h1>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <span className="kicker">Real Projects</span>
          <h2>Browse by Category</h2>
          <p className="section-intro">Every photo is our own crew&apos;s work across Sarasota and Charlotte Counties — no stock imagery.</p>
          <GalleryGrid />
        </div>
      </section>
      <CtaBand
        title="Like What You See?"
        text="Tell us about your project and we'll bring the same quality to your home."
        cta="Request a Free Estimate"
      />
    </>
  )
}
