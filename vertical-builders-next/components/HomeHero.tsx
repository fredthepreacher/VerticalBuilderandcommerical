'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { BIZ } from '@/lib/data'

type VideoSrc = '/videos/hero-flyover.mp4' | '/videos/hero-flyover-mobile.mp4' | null

/**
 * Hero background video strategy:
 *  - Desktop (≥768px): full 1.5MB encode
 *  - Mobile: dedicated 0.4MB 720p encode — same visual impact, phone-friendly
 *  - Skipped entirely for prefers-reduced-motion or Data Saver users
 *  - Poster (optimized WebP) always renders first, so there is zero layout shift
 */
export default function HomeHero() {
  const [videoSrc, setVideoSrc] = useState<VideoSrc>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    type NetworkInformation = { saveData?: boolean }
    const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
    if (reduced || conn?.saveData) return
    const wide = window.matchMedia('(min-width: 768px)').matches
    setVideoSrc(wide ? '/videos/hero-flyover.mp4' : '/videos/hero-flyover-mobile.mp4')
  }, [])

  return (
    <section className="hero">
      <div className="hero-media">
        <Image src="/images/hero-roofing.webp" alt="" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
      </div>
      {videoSrc && (
        <video className="hero-video" src={videoSrc} poster="/images/hero-roofing.webp" autoPlay muted loop playsInline aria-hidden="true" />
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
