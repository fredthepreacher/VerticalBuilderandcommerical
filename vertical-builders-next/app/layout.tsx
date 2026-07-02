import type { Metadata } from 'next'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import StickyCta from '@/components/StickyCta'
import AiAssistantWidget from '@/components/AiAssistantWidget'
import { BIZ } from '@/lib/data'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(BIZ.siteUrl),
  title: {
    default: 'Vertical Builders & Commercial | Roofing, Remodeling & Outdoor Construction in Southwest Florida',
    template: '%s | Vertical Builders & Commercial',
  },
  description:
    'Licensed general contractor and roofing contractor serving Nokomis, Venice, Sarasota, North Port, and Port Charlotte. Roofing, ceiling repairs, pools, lanais, remodels, and free estimates.',
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
  areaServed: ['Nokomis FL', 'Venice FL', 'Sarasota FL', 'North Port FL', 'Port Charlotte FL', 'Englewood FL'],
  sameAs: [BIZ.facebook],
  hasCredential: [
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified General Contractor ${BIZ.licenseGC}` },
    { '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: `Florida Certified Roofing Contractor ${BIZ.licenseRoof}` },
  ],
}

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
