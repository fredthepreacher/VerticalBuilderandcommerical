import Image from 'next/image'
import Link from 'next/link'
import type { ServicePage } from '@/lib/services'
import { SERVICE_DETAILS, PERMIT_STEPS } from '@/lib/serviceDetails'
import { BIZ, COUNTIES, REVIEWS, STEPS } from '@/lib/data'
import { SERVICE_AREAS } from '@/lib/serviceAreas'
import { GALLERY, thumbSrc } from '@/lib/gallery'
import { BUSINESS_ID, absUrl } from '@/lib/seo'
import TrustBar from './TrustBar'
import Breadcrumbs from './Breadcrumbs'
import CtaBand from './CtaBand'
import FaqSection from './FaqSection'
import RelatedLinks from './RelatedLinks'
import JsonLd from './JsonLd'

const FEATURED_AREAS = ['nokomis', 'venice', 'sarasota', 'north-port', 'englewood', 'port-charlotte', 'punta-gorda', 'osprey']

export default function ServicePageTemplate({ service }: { service: ServicePage }) {
  const d = SERVICE_DETAILS[service.slug]
  const galleryPreview = service.galleryCat ? GALLERY.filter(g => g.cat === service.galleryCat).slice(0, 8) : []
  const reviews = d ? REVIEWS.filter(r => d.reviewMatch.includes(r.project)) : []
  const estimateHref = d ? `/contact?service=${encodeURIComponent(d.formValue)}` : '/contact'
  const steps = service.slug === 'permitting-help' ? PERMIT_STEPS : STEPS

  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${absUrl(`/${service.slug}`)}#service`,
    name: service.title,
    serviceType: service.title,
    description: d?.answer ?? service.intro,
    url: absUrl(`/${service.slug}`),
    image: absUrl(service.heroImg),
    provider: { '@id': BUSINESS_ID },
    areaServed: COUNTIES.map(c => ({ '@type': 'AdministrativeArea', name: `${c}, Florida` })),
  }

  return (
    <>
      <JsonLd data={serviceJsonLd} />
      <section className="page-hero page-hero-svc">
        <div className="hero-media">
          <Image src={service.heroImg} alt={service.heroAlt} fill priority sizes="100vw" style={{ objectFit: 'cover' }} />
        </div>
        <div className="hero-overlay" />
        <div className="container hero-inner">
          <Breadcrumbs tone="dark" crumbs={[{ name: 'Services', path: '/services' }, { name: service.title, path: `/${service.slug}` }]} />
          <span className="kicker kicker-light">Licensed &amp; insured · Southwest Florida</span>
          <h1>{service.title}</h1>
          <div className="hero-ctas">
            <Link className="btn btn-accent" href={estimateHref} data-track={`cta_service_hero_${service.slug}`}>{service.cta}</Link>
            <a className="btn btn-outline" href={BIZ.phoneHref}>Call {BIZ.phone}</a>
          </div>
        </div>
      </section>
      <TrustBar />

      <section className="section">
        <div className="container">
          <div className="about-grid">
            <div className="about-copy">
              {d && (
                <div className="answer-card" data-reveal>
                  <span className="answer-label">Quick answer</span>
                  <p>{d.answer}</p>
                </div>
              )}
              <h2 className="h-md">What we do</h2>
              <p>{service.intro}</p>
              <ul className="tick-list">
                {service.bullets.map(b => <li key={b}>{b}</li>)}
              </ul>
              <div className="inline-ctas">
                <Link className="btn btn-accent" href={estimateHref}>{service.cta}</Link>
                <span className="inline-note">Free estimate · written scope · no obligation</span>
              </div>
            </div>
            <div className="svc-shots" data-reveal>
              {service.shots.map(s => (
                <figure className="shot" key={s.img}>
                  {s.label && <span className={`label${s.after ? ' after' : ''}`}>{s.label}</span>}
                  <Image src={s.img} alt={s.alt} fill sizes="(max-width: 960px) 100vw, 40vw" loading="lazy" style={{ objectFit: 'cover' }} />
                </figure>
              ))}
              <p className="svc-shots-note">Our own crews&rsquo; work — no stock photos.</p>
            </div>
          </div>
        </div>
      </section>

      {d && (
        <section className="section tint">
          <div className="container split-2">
            <div data-reveal>
              <span className="kicker">Is this you?</span>
              <h2 className="h-md">{d.signsTitle}</h2>
              <ul className="sign-list">
                {d.signs.map(s => <li key={s}>{s}</li>)}
              </ul>
            </div>
            <div data-reveal>
              <span className="kicker">How it works</span>
              <h2 className="h-md">From first call to final walkthrough</h2>
              <ol className="mini-steps">
                {steps.map((s, i) => (
                  <li key={s.title}>
                    <span className="mini-n">{i + 1}</span>
                    <div><b>{s.title}.</b> {s.desc}</div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="section svc-reviews">
          <div className="container">
            <div className="svc-review-row">
              {reviews.map(r => (
                <figure className="review" key={r.text} data-reveal>
                  <span className="stars" aria-hidden="true">★★★★★</span>
                  <span className="sr-only">5 star Google review</span>
                  <blockquote>&ldquo;{r.text}&rdquo;</blockquote>
                  <figcaption className="review-author">
                    <span className="review-name">{r.name}</span>{' '}
                    <span className="review-project">{r.project}</span>
                  </figcaption>
                </figure>
              ))}
              <div className="review review-cta-card">
                <p className="big-rating">{BIZ.ratingValue}<span>/5</span></p>
                <p>{BIZ.ratingCount} Google reviews <span className="muted-sm">(as of {BIZ.ratingAsOf})</span></p>
                <a className="btn btn-ghost-light" href={BIZ.googleProfile} target="_blank" rel="noopener noreferrer">Read them on Google</a>
              </div>
            </div>
          </div>
        </section>
      )}

      {galleryPreview.length > 0 && <section className="section work">
        <div className="container">
          <span className="kicker">Recent work</span>
          <h2>{service.title} Projects</h2>
          <div className="gallery-grid" style={{ marginTop: 34 }}>
            {galleryPreview.map(img => (
              <Link className="gallery-item" key={img.name} href="/gallery" aria-label={`See ${img.alt} in the gallery`}>
                <Image src={thumbSrc(img)} alt={img.alt} width={img.tw} height={img.th} loading="lazy" sizes="(max-width: 760px) 50vw, 25vw" />
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 26 }}>
            <Link className="btn btn-dark" href="/gallery">See the full gallery →</Link>
          </p>
        </div>
      </section>}

      {d && <FaqSection faqs={d.faqs} title={`${service.nav} questions, answered`} />}

      {d?.citations && d.citations.length > 0 && (
        <div className="container sources-line">
          <p>Sources: {d.citations.map((c, i) => (
            <span key={c.href}>{i > 0 && ' · '}<a href={c.href} target="_blank" rel="noopener noreferrer">{c.label}</a></span>
          ))}. General information, not legal or insurance advice.</p>
        </div>
      )}

      <section className="section areas">
        <div className="container">
          <span className="kicker">Where we work</span>
          <h2 className="h-md">{service.title} across Southwest Florida</h2>
          <div className="area-list">
            {FEATURED_AREAS.map(slug => SERVICE_AREAS.find(a => a.slug === slug)).filter(Boolean).map(a => (
              <Link className="area area-link" key={a!.slug} href={`/service-areas/${a!.slug}`}>{a!.name}</Link>
            ))}
            <Link className="area area-link" href="/service-areas">All service areas →</Link>
          </div>
        </div>
      </section>

      {d && <RelatedLinks services={d.related} guides={d.guides} title="Related services & guides" />}

      <CtaBand
        title="Free estimates & inspections"
        text="Tell us about your project — we'll take a look and give you a clear written scope and estimate."
        cta={service.cta}
        href={estimateHref}
      />
    </>
  )
}
