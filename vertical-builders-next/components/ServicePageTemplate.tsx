import Image from 'next/image'
import Link from 'next/link'
import type { ServicePage } from '@/lib/services'
import { GALLERY, thumbSrc } from '@/lib/gallery'
import TrustBar from './TrustBar'
import BreadcrumbJsonLd from './BreadcrumbJsonLd'
import CtaBand from './CtaBand'

export default function ServicePageTemplate({ service }: { service: ServicePage }) {
  const galleryPreview = GALLERY.filter(g => g.cat === service.galleryCat).slice(0, 8)
  return (
    <>
      <BreadcrumbJsonLd crumbs={[{ name: service.title, path: `/${service.slug}` }]} />
      <section className="page-hero">
        <div className="hero-media">
          <Image src={service.heroImg} alt={service.heroAlt} fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
        </div>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <span className="kicker">Licensed &amp; Insured</span>
          <h1>{service.title}</h1>
        </div>
      </section>
      <TrustBar />
      <section className="section">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              <h2>What We Do</h2>
              <p style={{ marginTop: 18 }}>{service.intro}</p>
              <ul style={{ listStyle: 'none', margin: '18px 0 26px' }}>
                {service.bullets.map(b => (
                  <li key={b} style={{ padding: '6px 0 6px 26px', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, top: 13, width: 12, height: 12, background: 'var(--accent)', clipPath: 'polygon(0 0,100% 50%,0 100%)' }} />
                    {b}
                  </li>
                ))}
              </ul>
              <Link className="btn btn-accent" href="/contact">{service.cta}</Link>
              <p style={{ marginTop: 18, fontSize: '.92rem', color: 'var(--slate)' }}>
                Available across <Link href="/service-areas" style={{ color: 'var(--accent)', fontWeight: 600 }}>all of Southwest Florida</Link>.
              </p>
            </div>
            <div>
              <div className="project" style={{ marginTop: 0 }}>
                <div className="project-grid" style={{ gridTemplateColumns: '1fr', padding: 20 }}>
                  {service.shots.map(s => (
                    <div className="shot" key={s.img}>
                      {s.label && <span className={`label${s.after ? ' after' : ''}`}>{s.label}</span>}
                      <Image src={s.img} alt={s.alt} fill sizes="(max-width: 960px) 100vw, 40vw" loading="lazy" style={{ objectFit: 'cover' }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="section work">
        <div className="container">
          <span className="kicker">Recent Work</span>
          <h2>{service.title} Projects</h2>
          <div className="gallery-grid" style={{ marginTop: 34 }}>
            {galleryPreview.map(img => (
              <Link className="gallery-item" key={img.name} href="/gallery" aria-label={`See ${img.alt} in gallery`}>
                <Image src={thumbSrc(img)} alt={img.alt} width={img.tw} height={img.th} loading="lazy" sizes="(max-width: 760px) 50vw, 25vw" />
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 26 }}>
            <Link className="btn btn-dark" href="/gallery">See the Full Gallery →</Link>
          </p>
        </div>
      </section>
      <CtaBand
        title="Free Estimates & Inspections"
        text="Tell us about your project — we'll take a look and give you a clear written scope and estimate."
        cta={service.cta}
      />
    </>
  )
}
