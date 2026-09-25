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
              <br />Licensed &amp; Insured ·{' '}
              <a href={BIZ.licenseLookup} target="_blank" rel="noopener noreferrer">Verify licenses</a>
            </p>
            <Link className="btn btn-accent footer-cta" href="/contact">Get a Free Estimate</Link>
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
              <li><Link href="/services">All Services →</Link></li>
            </ul>
            <h4 className="footer-h4-gap">Learn</h4>
            <ul>
              <li><Link href="/guides">Homeowner Guides</Link></li>
              <li><Link href="/gallery">Project Gallery</Link></li>
              <li><Link href="/about">About Us</Link></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            <ul>
              <li><a href={BIZ.phoneHref} data-track="call_footer">{BIZ.phone}</a></li>
              <li><a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></li>
              <li>{BIZ.address}<br />{BIZ.cityStateZip}</li>
              <li className="footer-social">
                <a href={BIZ.facebook} target="_blank" rel="noopener noreferrer">Facebook</a>
                {' · '}
                <a href={BIZ.googleProfile} target="_blank" rel="noopener noreferrer">Google Reviews</a>
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
          <span>
            © {new Date().getFullYear()} {BIZ.name}. All rights reserved.
            {' · '}<Link href="/privacy">Privacy Policy</Link>
            {' · '}<Link href="/terms">Terms of Use</Link>
          </span>
          <span><a href="#main">Back to top ↑</a></span>
        </div>
      </div>
    </footer>
  )
}
