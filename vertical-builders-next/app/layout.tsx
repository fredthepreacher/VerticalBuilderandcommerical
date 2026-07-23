import type { Metadata } from 'next'
import Script from 'next/script'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import StickyCta from '@/components/StickyCta'
import AiAssistantWidget from '@/components/AiAssistantWidget'
import { AREAS_ALL, BIZ, COUNTIES } from '@/lib/data'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(BIZ.siteUrl),
  title: {
    default: 'Vertical Builders and Commercial | Licensed Contractor Serving Southwest Florida',
    template: '%s | Vertical Builders and Commercial',
  },
  description:
    'Licensed general contractor and roofing contractor serving Southwest Florida. Roofing, storm protection, ceiling repair, pools, lanais, outdoor living, and commercial construction services.',
  openGraph: {
    type: 'website',
    siteName: BIZ.name,
    url: BIZ.siteUrl,
    images: ['/images/hero-roofing.webp'],
  },
  twitter: { card: 'summary_large_image' },
}

const businessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['GeneralContractor', 'RoofingContractor'],
  name: BIZ.name,
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
  knowsAbout: ['Roofing', 'Storm damage repair', 'Ceiling repair', 'Water damage repair', 'Pool construction', 'Lanai construction', 'Outdoor living', 'New construction', 'Commercial construction', 'General contracting'],
  makesOffer: [
    'Roofing & Storm Protection',
    'Ceiling, Interior & Water Damage Repair',
    'Pools, Lanais & Outdoor Living',
    'New Construction',
    'General Contracting',
    'Commercial Construction',
  ].map(name => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name, areaServed: 'Southwest Florida' } })),
  sameAs: [BIZ.facebook],
  hasCredential: [
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified General Contractor ${BIZ.licenseGC}` },
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified Roofing Contractor ${BIZ.licenseRoof}` },
  ],
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }} />
        <Header />
        <main>{children}</main>
        <Footer />
        <StickyCta />
        <AiAssistantWidget />
      </body>
    </html>
  )
}
