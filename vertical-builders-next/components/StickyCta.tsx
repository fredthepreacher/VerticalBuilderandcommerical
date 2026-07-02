import { BIZ } from '@/lib/data'
import Link from 'next/link'

export default function StickyCta() {
  return (
    <div className="mobile-cta">
      <a className="call" href={BIZ.phoneHref}>📞 Call Now</a>
      <Link className="quote" href="/contact">Get Free Estimate</Link>
    </div>
  )
}
