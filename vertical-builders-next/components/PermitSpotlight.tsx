import Link from 'next/link'
import { PERMIT_STEPS } from '@/lib/serviceDetails'
import { REVIEWS } from '@/lib/data'

export default function PermitSpotlight() {
  const quote = REVIEWS.find(r => r.project === 'Lanai permitting')
  return (
    <section className="section permit-band" aria-labelledby="permit-title">
      <div className="container permit-grid">
        <div data-reveal>
          <span className="kicker kicker-light">Permit problems, solved</span>
          <h2 id="permit-title">Unpermitted lanai, addition or remodel? We make it right with the county.</h2>
          <p>
            Permit services can file paperwork but can&rsquo;t build. We&rsquo;re the licensed general contractor that does
            both — the after-the-fact permit, any corrections the inspector asks for, and the final closeout
            you can hand a buyer or insurer.
          </p>
          {quote && (
            <figure className="permit-quote">
              <blockquote>&ldquo;{quote.text}&rdquo;</blockquote>
              <figcaption>{quote.name} · Google review · {quote.project}</figcaption>
            </figure>
          )}
          <div className="permit-ctas">
            <Link className="btn btn-accent" href="/contact?service=Permitting%20Help" data-track="cta_permit_band">Get help with a permit</Link>
            <Link className="btn btn-outline" href="/permitting-help">How it works</Link>
          </div>
        </div>
        <ol className="permit-steps" data-reveal>
          {PERMIT_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="permit-step-n">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
