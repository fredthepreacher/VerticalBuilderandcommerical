import Link from 'next/link'
import Image from 'next/image'
import { AREAS, BIZ } from '@/lib/data'

export default function Footer() {
  return (
    <footer className="site">
      <div className="container">
        <div className="footer-grid">
          <div>
            <Link href="/" className="footer-logo">
              <Image src="/brand/logo-full.png" alt="Vertical Builders and Commercial" width={240} height={69} />
            </Link>
            <p className="footer-blurb">
              Licensed general contractor and roofing contractor serving Southwest Florida homeowners and property owners.
            </p>
            <p>
              GC {BIZ.licenseGC} · Roofing {BIZ.licenseRoof}
              <br />Licensed &amp; Insured
            </p>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li><a href={BIZ.phoneHref}>{BIZ.phone}</a></li>
              <li><a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></li>
              <li>{BIZ.address}<br />{BIZ.cityStateZip}</li>
              <li className="footer-social">
                <a href={BIZ.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
                {' · '}
                <a href={BIZ.googleProfile} target="_blank" rel="noopener noreferrer">Google Profile</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>Service Areas</h4>
            <ul>
              {AREAS.map(a => <li key={a}>{a}</li>)}
              <li>Fort Myers · Cape Coral · Naples</li>
              <li>&amp; all of Southwest Florida</li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {BIZ.name}. All rights reserved.</span>
          <span><Link href="/">Back to top ↑</Link></span>
        </div>
      </div>
    </footer>
  )
}
