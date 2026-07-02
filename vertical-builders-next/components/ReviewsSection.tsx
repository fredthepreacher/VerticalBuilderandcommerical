import { BIZ, REVIEWS } from '@/lib/data'

const Stars = () => <span className="stars" aria-label="5 star review">★★★★★</span>

export default function ReviewsSection() {
  return (
    <section className="section" id="reviews">
      <div className="container">
        <span className="kicker">Reputation</span>
        <h2>Rated {BIZ.ratingValue} Stars by Southwest Florida Homeowners</h2>
        <p className="section-intro">
          {BIZ.ratingValue} average across {BIZ.ratingCount} Google reviews. Excerpts below — read the full reviews on Google.
        </p>
        <div className="review-cards">
          {REVIEWS.map((r, i) => (
            <figure className="review" key={i}>
              <Stars />
              <blockquote>&ldquo;{r.text}&rdquo;</blockquote>
              <figcaption className="review-author">
                <span className="review-name">{r.name}</span>
                {/* Real whitespace text node: guarantees separation in extracted
                    text and screen readers. Whitespace-only nodes are not
                    rendered as flex items, so the visual layout is unchanged. */}
                {' '}
                <span className="review-project">{r.project}</span>
              </figcaption>
            </figure>
          ))}
          <div className="review review-cta-card">
            <p className="big-rating">{BIZ.ratingValue}<span>/5</span></p>
            <p>{BIZ.ratingCount} Google reviews</p>
            <a className="btn btn-dark" href={BIZ.googleProfile} target="_blank" rel="noopener noreferrer">Read All Reviews</a>
            <a className="btn btn-ghost" href={BIZ.facebook} target="_blank" rel="noopener noreferrer">Follow on Facebook</a>
          </div>
        </div>
      </div>
    </section>
  )
}
