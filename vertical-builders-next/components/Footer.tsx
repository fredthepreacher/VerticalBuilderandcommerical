import Link from 'next/link'
import Image from 'next/image'
import { BIZ } from '@/lib/data'

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
            <h4>Services</h4>
            <ul>
              <li><Link href="/roofing">Roofing &amp; Storm Protection</Link></li>
              <li><Link href="/interior-repair">Interior &amp; Water Damage Repair</Link></li>
              <li><Link href="/pools-lanais">Pools, Lanais &amp; Outdoor Living</Link></li>
              <li><Link href="/new-construction">New Construction &amp; Additions</Link></li>
              <li><Link href="/kitchen-bath-remodels">Kitchen &amp; Bath Remodels</Link></li>
              <li><Link href="/impact-windows-doors">Impact Windows &amp; Doors</Link></li>
              <li><Link href="/permitting-help">Permitting Help</Link></li>
              <li><Link href="/general-contracting-services">More GC Services</Link></li>
            </ul>
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
              <li><Link href="/service-areas/nokomis">Nokomis</Link></li>
              <li><Link href="/service-areas/venice">Venice</Link></li>
              <li><Link href="/service-areas/sarasota">Sarasota</Link></li>
              <li><Link href="/service-areas/north-port">North Port</Link></li>
              <li><Link href="/service-areas/port-charlotte">Port Charlotte</Link></li>
              <li><Link href="/service-areas/englewood">Englewood</Link></li>
              <li><Link href="/service-areas/fort-myers">Fort Myers</Link></li>
              <li><Link href="/service-areas/naples">Naples</Link></li>
              <li><Link href="/service-areas">All of Southwest Florida →</Link></li>
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
