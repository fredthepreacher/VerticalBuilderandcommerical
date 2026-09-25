import { FAQS, type Faq } from '@/lib/data'
import JsonLd from './JsonLd'

interface Props {
  faqs?: Faq[]
  title?: string
  kicker?: string
  /** Set false when another FAQPage block already describes this page. */
  schema?: boolean
  tone?: 'plain' | 'tint'
}

export default function FaqSection({ faqs = FAQS, title = 'Frequently Asked Questions', kicker = 'Questions', schema = true, tone = 'plain' }: Props) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  return (
    <section className={`section${tone === 'tint' ? ' tint' : ''}`}>
      <div className="container faq-wrap">
        {schema && <JsonLd data={jsonLd} />}
        <div className="faq-head">
          <span className="kicker">{kicker}</span>
          <h2>{title}</h2>
        </div>
        <div className="faq-list">
          {faqs.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
