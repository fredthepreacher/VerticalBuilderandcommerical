import Link from 'next/link'
import { getService } from '@/lib/services'
import { getGuide } from '@/lib/guides'

/** Related services and guides — the internal links that tie a topic together. */
export default function RelatedLinks({ services = [], guides = [], title = 'Keep reading' }: { services?: string[]; guides?: string[]; title?: string }) {
  const svc = services.map(getService).filter(Boolean)
  const gds = guides.map(getGuide).filter(Boolean)
  if (!svc.length && !gds.length) return null
  return (
    <section className="section related" aria-labelledby="related-title">
      <div className="container">
        <h2 id="related-title" className="h-sm">{title}</h2>
        <div className="related-grid">
          {svc.map(s => (
            <Link key={s!.slug} href={`/${s!.slug}`} className="related-card">
              <span className="related-kind">Service</span>
              <span className="related-name">{s!.title}</span>
              <span className="related-desc">{s!.metaDescription}</span>
            </Link>
          ))}
          {gds.map(g => (
            <Link key={g!.slug} href={`/guides/${g!.slug}`} className="related-card related-guide">
              <span className="related-kind">Homeowner guide</span>
              <span className="related-name">{g!.title}</span>
              <span className="related-desc">{g!.description}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
