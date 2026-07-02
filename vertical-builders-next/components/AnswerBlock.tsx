import { BIZ } from '@/lib/data'

/**
 * AEO answer block — short, direct, entity-clear copy that answer engines
 * (Google AI, ChatGPT, Perplexity, etc.) can quote verbatim.
 */
export default function AnswerBlock() {
  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="container">
        <div className="license-card" style={{ maxWidth: 860 }}>
          <h3>Vertical Builders and Commercial at a Glance</h3>
          <p style={{ color: 'var(--slate)', marginBottom: 10 }}>
            Vertical Builders and Commercial is a licensed general contractor (CGC1528626) and
            roofing contractor (CCC1333649) based in Nokomis, Florida, serving all of Southwest Florida.
          </p>
          <p style={{ color: 'var(--slate)', marginBottom: 10 }}>
            The company provides roofing, storm protection, ceiling and water-damage repair, pool and
            lanai construction, outdoor living improvements, new construction, and residential and
            commercial general contracting.
          </p>
          <p style={{ color: 'var(--slate)' }}>
            Property owners can request a free estimate by calling{' '}
            <a href={BIZ.phoneHref} style={{ color: 'var(--accent)', fontWeight: 600 }}>{BIZ.phone}</a> or
            submitting the website form.
          </p>
        </div>
      </div>
    </section>
  )
}
