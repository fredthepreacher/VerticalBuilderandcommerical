'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { BIZ } from '@/lib/data'

type VideoSrc = '/videos/hero-flyover.mp4' | '/videos/hero-flyover-mobile.mp4' | null

/**
 * Starting points a visitor recognises in their own words. Each one leads to
 * the contact form with the project type already chosen, plus the page that
 * explains that service. `service` must be a PROJECT_TYPES value.
 */
const NEEDS = [
  { id: 'leak', label: 'Roof leak or storm damage', service: 'Storm Damage / Emergency Tarp', href: '/roofing', line: 'We tarp and dry-in first, then repair the roof and the ceiling under it — one licensed company for both.' },
  { id: 'roof', label: 'New roof', service: 'Roofing', href: '/roofing', line: 'Shingle, metal, tile and flat roofs, priced from a free on-site inspection.' },
  { id: 'permit', label: 'Permit problem', service: 'Permitting Help', href: '/permitting-help', line: 'After-the-fact permits, corrections and county inspections, handled by a Certified General Contractor.' },
  { id: 'outdoor', label: 'Pool, lanai or cage', service: 'Pool / Lanai / Outdoor Living', href: '/pools-lanais', line: 'Pool builds and remodels, screened lanais, pool cages, decks and pavers.' },
  { id: 'remodel', label: 'Kitchen or bath', service: 'Kitchen & Bath Remodel', href: '/kitchen-bath-remodels', line: 'Demo to finished room, with permitted plumbing and electrical and real shower waterproofing.' },
  { id: 'windows', label: 'Impact windows', service: 'Impact Windows & Doors', href: '/impact-windows-doors', line: 'Impact windows and doors with product approvals, permits and inspections handled.' },
] as const

/**
 * Hero background video strategy:
 *  - Desktop (≥768px): full 1.5MB encode
 *  - Mobile: dedicated 0.4MB 720p encode — same visual impact, phone-friendly
 *  - Skipped entirely for prefers-reduced-motion or Data Saver users
 *  - Poster (optimized WebP) always renders first, so there is zero layout shift
 */
export default function HomeHero() {
  const [videoSrc, setVideoSrc] = useState<VideoSrc>(null)
  const [need, setNeed] = useState<(typeof NEEDS)[number]>(NEEDS[0])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    type NetworkInformation = { saveData?: boolean }
    const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
    if (reduced || conn?.saveData) return
    const wide = window.matchMedia('(min-width: 768px)').matches
    setVideoSrc(wide ? '/videos/hero-flyover.mp4' : '/videos/hero-flyover-mobile.mp4')
  }, [])

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-media">
        <Image src="/images/hero-roofing.webp" alt="" fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
      </div>
      {videoSrc && (
        <video className="hero-video" src={videoSrc} poster="/images/hero-roofing.webp" autoPlay muted loop playsInline aria-hidden="true" />
      )}
      <div className="hero-overlay" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <span className="kicker kicker-light">Based in Nokomis · Serving Southwest Florida</span>
          <h1 id="hero-title">The Roof, the Repairs Under It &amp; the Permits — One Licensed Contractor</h1>
          <p className="sub">
            Vertical Builders &amp; Commercial is a Florida Certified General Contractor <em>and</em> Certified
            Roofing Contractor. Storm-damaged roofs, ceiling and water-damage repair, pools and lanais,
            remodels, and unpermitted work made right — across Southwest Florida.
          </p>
          <div className="hero-ctas">
            <Link className="btn btn-accent btn-lg" href="/contact" data-track="cta_hero">Get a Free Estimate</Link>
            <a className="btn btn-outline btn-lg" href={BIZ.phoneHref} data-track="call_hero">
              <PhoneIcon /> {BIZ.phone}
            </a>
          </div>
          <ul className="hero-proof" aria-label="Credentials">
            <li><b>{BIZ.ratingValue}★</b> {BIZ.ratingCount} Google reviews</li>
            <li><b>GC</b> {BIZ.licenseGC}</li>
            <li><b>Roofing</b> {BIZ.licenseRoof}</li>
            <li><b>Free</b> inspections &amp; estimates</li>
          </ul>
        </div>

        <div className="need-picker" role="group" aria-labelledby="need-title">
          <p id="need-title" className="need-title">What do you need help with?</p>
          <div className="need-options">
            {NEEDS.map(n => (
              <button
                key={n.id}
                type="button"
                className={`need-chip${need.id === n.id ? ' is-on' : ''}`}
                aria-pressed={need.id === n.id}
                onClick={() => setNeed(n)}
              >
                {n.label}
              </button>
            ))}
          </div>
          <p className="need-line" aria-live="polite">{need.line}</p>
          <div className="need-actions">
            <Link className="btn btn-accent" href={`/contact?service=${encodeURIComponent(need.service)}`} data-track="cta_need_picker">
              Start my free estimate
            </Link>
            <Link className="need-learn" href={need.href}>How it works →</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ verticalAlign: '-3px' }}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  )
}
