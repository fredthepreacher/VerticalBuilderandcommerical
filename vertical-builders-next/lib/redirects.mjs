// Legacy URLs from the previous WordPress site that Google still has indexed
// (verified in search results, 25 Sep 2026) and that 404 on the Next.js site.
// Each one is sent permanently to the closest current page so the old
// rankings and inbound links carry over instead of evaporating.
//
// Plain .mjs so next.config.mjs can import it and a Vitest test can check that
// every destination is a real marketing route.

/** @type {{ source: string, destination: string }[]} */
export const LEGACY_REDIRECTS = [
  { source: '/relaunch', destination: '/about' },
  { source: '/one-page-home', destination: '/' },
  { source: '/home-page-2', destination: '/' },
  { source: '/page/:n', destination: '/' },
  { source: '/roofing-services', destination: '/roofing' },
  { source: '/residential-roofing', destination: '/roofing' },
  { source: '/commercial-roofing', destination: '/roofing' },
  { source: '/new-construction-builder', destination: '/new-construction' },
  { source: '/pool-enclosure-and-cages', destination: '/pools-lanais' },
  { source: '/our-service-areas', destination: '/service-areas' },
  { source: '/contact-us', destination: '/contact' },
  { source: '/about-us', destination: '/about' },
  { source: '/expert-roofing-custom-home-building-pool-construction-in-sarasota-vertical-builders-and-commercial', destination: '/service-areas/sarasota' },
  { source: '/venice-fl-roofing-custom-homes-pool-installation-vertical-builders-and-commercial', destination: '/service-areas/venice' },
  { source: '/port-charlotte-roofing-custom-homes-swimming-pool-contractors-vertical-builders-and-commercial', destination: '/service-areas/port-charlotte' },
  { source: '/nokomis-roofing-home-building-swimming-pool-contractors-vertical-builders-and-commercial', destination: '/service-areas/nokomis' },
  { source: '/structural-construction-services-in-sarasota-foundation-block-beam-experts-vertical-builders-and-commercial', destination: '/general-contracting-services' },
  // WordPress system paths that crawlers keep requesting
  { source: '/feed', destination: '/' },
  { source: '/category/:slug*', destination: '/guides' },
  { source: '/author/:slug*', destination: '/about' },
]
