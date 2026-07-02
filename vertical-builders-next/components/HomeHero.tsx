'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { BIZ } from '@/lib/data'

export default function HomeHero() {
  const [showVideo, setShowVideo] = useState(false)

  // Ambient background video: desktop only, after hydration, and only when
  // the user hasn't asked for reduced motion. Phones get the poster image.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 768px)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (wide && !reduced) setShowVideo(true)
  }, [])

  return (
    <section className="hero">
      <div className="hero-media">
        <Image src="/images/hero-roofing.webp" alt="" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
      </div>
      {showVideo && (
        <video className="hero-video" src="/videos/hero-flyover.mp4" poster="/images/hero-roofing.webp" autoPlay muted loop playsInline aria-hidden="true" />
      )}
      <div className="hero-overlay" />
      <div className="container hero-inner">
        <span className="kicker">Licensed &amp; Insured · Nokomis, FL</span>
        <h1>Licensed Roofing, Remodeling &amp; Outdoor Construction in Southwest Florida</h1>
        <p className="sub">
          Vertical Builders &amp; Commercial helps Florida homeowners and property owners protect, repair,
          and improve their homes — from storm-ready roofs to ceiling repairs, pools, lanais, and full remodels.
        </p>
        <div className="hero-ctas">
          <Link className="btn btn-accent" href="/contact">Request a Free Roof Inspection</Link>
          <a className="btn btn-outline" href={BIZ.phoneHref}>Call {BIZ.phone}</a>
        </div>
        <div className="hero-trust">
          <span><b>GC License</b> {BIZ.licenseGC}</span>
          <span><b>Roofing License</b> {BIZ.licenseRoof}</span>
          <span><b>Serving</b> All of Southwest Florida</span>
        </div>
      </div>
    </section>
  )
}
