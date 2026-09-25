import { BIZ } from '@/lib/data'
import Link from 'next/link'

export default function StickyCta() {
  return (
    <div className="mobile-cta" role="region" aria-label="Quick contact">
      <a className="call" href={BIZ.phoneHref} data-track="call_sticky">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
        Call Now
      </a>
      <Link className="quote" href="/contact" data-track="cta_sticky">Free Estimate</Link>
    </div>
  )
}
