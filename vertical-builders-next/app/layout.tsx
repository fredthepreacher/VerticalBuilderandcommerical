import type { Metadata } from 'next'
import Script from 'next/script'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import StickyCta from '@/components/StickyCta'
import AiAssistantWidget from '@/components/AiAssistantWidget'
import SiteChrome from '@/components/SiteChrome'
import Reveal from '@/components/Reveal'
import TrackClicks from '@/components/TrackClicks'
import JsonLd from '@/components/JsonLd'
import { AREAS_ALL, BIZ, COUNTIES } from '@/lib/data'
import { SERVICES } from '@/lib/services'
import { BUSINESS_ID, WEBSITE_ID, DEFAULT_OG_IMAGE } from '@/lib/seo'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(BIZ.siteUrl),
  title: {
    default: 'Vertical Builders and Commercial | Licensed Contractor Serving Southwest Florida',
    template: '%s | Vertical Builders and Commercial',
  },
  description:
    'Licensed general contractor and roofing contractor serving Southwest Florida. Roofing, storm protection, ceiling repair, pools, lanais, outdoor living, and commercial construction services.',
  // No `url` here on purpose: a layout-level og:url is inherited by every page
  // that doesn't override it, which made every inner page claim to be the
  // homepage. Pages set their own via lib/seo.ts#pageMeta.
  openGraph: {
    type: 'website',
    siteName: BIZ.name,
    locale: 'en_US',
    images: [DEFAULT_OG_IMAGE],
  },
  twitter: { card: 'summary_large_image' },
  formatDetection: { telephone: true, address: false, email: false },
}

// The single business entity. Every other JSON-LD block on the site points at
// it by @id, so search and answer engines see one company, not dozens of
// loosely matching ones. No AggregateRating/Review markup: self-served review
// stars are ineligible for local businesses and the count can't be kept live.
const businessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['GeneralContractor', 'RoofingContractor'],
  '@id': BUSINESS_ID,
  name: BIZ.name,
  alternateName: ['Vertical Builders and Commercial', 'Vertical Builders & Commercial'],
  description:
    'Florida Certified General Contractor (CGC1528626) and Certified Roofing Contractor (CCC1333649) based in Nokomis, serving Southwest Florida with roofing, storm repair, interior and water-damage repair, pools and lanais, remodels, impact windows, new construction and permit resolution.',
  url: BIZ.siteUrl,
  telephone: '+1-941-877-2009',
  email: BIZ.email,
  image: `${BIZ.siteUrl}/images/hero-roofing.webp`,
  logo: `${BIZ.siteUrl}/brand/logo-full.png`,
  address: {
    '@type': 'PostalAddress',
    streetAddress: BIZ.address,
    addressLocality: 'Nokomis',
    addressRegion: 'FL',
    postalCode: '34275',
    addressCountry: 'US',
  },
  areaServed: ['Southwest Florida', ...AREAS_ALL.map(c => `${c} FL`), ...COUNTIES.map(c => `${c} FL`)],
  knowsAbout: ['Roofing', 'Roof replacement', 'Storm damage repair', 'Ceiling repair', 'Water damage repair', 'Pool construction', 'Screen enclosures', 'Lanai construction', 'Kitchen and bathroom remodeling', 'Impact windows and doors', 'After-the-fact permits', 'New construction', 'Commercial construction', 'General contracting', 'Florida Building Code'],
  makesOffer: SERVICES.map(s => ({
    '@type': 'Offer',
    itemOffered: { '@type': 'Service', name: s.title, url: `${BIZ.siteUrl}/${s.slug}` },
  })),
  sameAs: [BIZ.facebook],
  hasMap: BIZ.googleProfile,
  hasCredential: [
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified General Contractor ${BIZ.licenseGC}` },
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified Roofing Contractor ${BIZ.licenseRoof}` },
  ],
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: BIZ.siteUrl,
  name: BIZ.name,
  publisher: { '@id': BUSINESS_ID },
  inLanguage: 'en-US',
}

const GA_MEASUREMENT_ID = 'G-81L0NGL7DW'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        <JsonLd data={businessJsonLd} />
        <JsonLd data={websiteJsonLd} />
        {/* Marketing chrome renders on public pages only. Internal /ops and
            /upload routes get the bare document — see components/SiteChrome. */}
        <SiteChrome
          header={<Header />}
          footer={<Footer />}
          extras={<><StickyCta /><AiAssistantWidget /><Reveal /><TrackClicks /></>}
        >
          {children}
        </SiteChrome>
      </body>
    </html>
  )
}
