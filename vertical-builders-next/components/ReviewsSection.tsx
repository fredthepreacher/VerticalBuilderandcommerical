import { BIZ, REVIEWS } from '@/lib/data'

export default function ReviewsSection() {
  return (
    <section className="section" id="reviews" aria-labelledby="reviews-title">
      <div className="container">
        <div className="reviews-head" data-reveal>
          <div>
            <span className="kicker">Reputation</span>
            <h2 id="reviews-title">What Southwest Florida homeowners say</h2>
          </div>
          <p className="section-intro">
            {BIZ.ratingValue} average across {BIZ.ratingCount} Google reviews as of {BIZ.ratingAsOf}.
            Short excerpts below — the full reviews are on Google.
          </p>
        </div>
        <div className="review-cards">
          {REVIEWS.map((r, i) => (
            <figure className="review" key={i} data-reveal style={{ ['--d' as string]: `${(i % 3) * 80}ms` }}>
              <span className="stars" aria-hidden="true">★★★★★</span>
              <span className="sr-only">5 star Google review.</span>
              <blockquote>&ldquo;{r.text}&rdquo;</blockquote>
              <figcaption className="review-author">
                <span className="review-name">{r.name}</span>
                {/* Real whitespace text node: guarantees separation in extracted
                    text and screen readers. */}
                {' '}
                <span className="review-project">{r.project}</span>
              </figcaption>
            </figure>
          ))}
          <div className="review review-cta-card" data-reveal>
            <p className="big-rating">{BIZ.ratingValue}<span>/5</span></p>
            <p>{BIZ.ratingCount} Google reviews <span className="muted-sm">(as of {BIZ.ratingAsOf})</span></p>
            <a className="btn btn-accent" href={BIZ.googleProfile} target="_blank" rel="noopener noreferrer">Read all reviews</a>
            <a className="btn btn-ghost-light" href={BIZ.facebook} target="_blank" rel="noopener noreferrer">Follow on Facebook</a>
          </div>
        </div>
      </div>
    </section>
  )
}
