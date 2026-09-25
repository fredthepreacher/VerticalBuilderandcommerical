import Link from 'next/link'
import Image from 'next/image'
import { SERVICES } from '@/lib/services'
import { EXTRA_SERVICES } from '@/lib/data'

// Chips without a dedicated page link to the grouped services page (anchored)
// or the closest core page — nothing renders as dead text.
const CHIP_FALLBACKS: Record<string, string> = {
  'Additions & ADUs': '/new-construction',
  'Fences & Gutters': '/general-contracting-services#fences-gutters',
  'Epoxy Flake Flooring': '/general-contracting-services#epoxy-flooring',
  'Pavers & Concrete Pours': '/general-contracting-services#pavers-concrete',
  'Structural Engineering Services': '/general-contracting-services#structural-engineering',
}


export default function PillarCards() {
  return (
    <section className="section">
      <div className="container">
        <span className="kicker">What we do</span>
        <h2>Protect it, repair it, improve it</h2>
        <p className="section-intro">
          Most projects start in one of these three places. All of them are permitted, inspected and built by our own licensed crews.
        </p>
        <div className="pillars">
          {SERVICES.filter(s => s.pillar).map(s => (
            <div className="pillar" key={s.slug} data-reveal>
              <div className="pillar-img">
                <Image src={s.heroImg} alt={s.heroAlt} fill sizes="(max-width: 960px) 100vw, 33vw" loading="lazy" />
              </div>
              <div className="pillar-body">
                <h3>{s.title}</h3>
                <ul>{s.bullets.slice(0, 4).map(b => <li key={b}>{b}</li>)}</ul>
                <Link className="btn btn-accent" href={`/${s.slug}`}>{s.nav} Details →</Link>
              </div>
            </div>
          ))}
        </div>
        <div className="extra-services" data-reveal>
          <h3>More general contracting services</h3>
          <div className="chips">
            {EXTRA_SERVICES.map(s => {
              const linked = SERVICES.find(x => !x.pillar && x.chipMatch === s)
              const href = linked ? `/${linked.slug}` : CHIP_FALLBACKS[s]
              return href
                ? <Link className="chip chip-link" key={s} href={href}>{s} →</Link>
                : <span className="chip" key={s}>{s}</span>
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
