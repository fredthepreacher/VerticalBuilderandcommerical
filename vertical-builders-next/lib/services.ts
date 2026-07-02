export interface ServiceShot { img: string; alt: string; label?: string; after?: boolean }
export interface ServicePage {
  slug: string
  nav: string
  title: string
  metaTitle: string
  metaDescription: string
  heroImg: string
  heroAlt: string
  intro: string
  bullets: string[]
  cta: string
  shots: ServiceShot[]
  galleryCat: string
}

export const SERVICES: ServicePage[] = [
  {
    slug: 'roofing',
    nav: 'Roofing',
    title: 'Roofing & Storm Protection',
    metaTitle: 'Roofing & Storm Protection in Southwest Florida | Vertical Builders & Commercial',
    metaDescription: 'Licensed roofing contractor (CCC1333649) serving Nokomis, Venice, Sarasota, North Port & Port Charlotte. Free roof inspections, storm damage recovery, shingle, metal, tile & flat roofing.',
    heroImg: '/images/roof-shingles-topdown.webp',
    heroAlt: 'Aerial view of a newly installed shingle roof in Southwest Florida',
    intro: 'Florida roofs take a beating — sun, wind, and storm season. As a licensed roofing contractor we inspect, repair, and replace roofs across Sarasota and Charlotte Counties, and because we are also a licensed general contractor, we can repair the interior damage a leaking roof leaves behind.',
    bullets: ['Free roof inspections', 'Roof repairs & full replacement', 'Shingle, metal, tile & flat / low-slope roofing', 'Storm damage: tarp, dry-in & insurance-ready documentation', 'Gutters & roof ventilation'],
    cta: 'Request a Free Roof Inspection',
    shots: [
      { img: '/images/roof-storm-tarp.webp', label: 'Storm Tarp', alt: 'Storm-damaged roof protected with blue tarp before replacement' },
      { img: '/images/roof-crew-progress.webp', label: 'Install', alt: 'Roofing crew installing new roof with underlayment' },
      { img: '/images/roof-finished-aerial.webp', label: 'Completed', after: true, alt: 'Completed new shingle roof, aerial drone view' },
    ],
    galleryCat: 'roofing',
  },
  {
    slug: 'interior-repair',
    nav: 'Interior Repair',
    title: 'Ceiling, Interior & Water Damage Repair',
    metaTitle: 'Ceiling & Water Damage Repair in Southwest Florida | Vertical Builders & Commercial',
    metaDescription: 'Ceiling repair, drywall, water damage restoration and interior remodeling by a licensed Florida general contractor (CGC1528626). Serving Nokomis, Venice, Sarasota & surrounding areas.',
    heroImg: '/images/interior-repair-progress.webp',
    heroAlt: 'Interior drywall and flooring repair in progress',
    intro: 'A roof leak rarely stops at the roof. We repair ceilings, drywall, flooring, and framing after water damage — and we take kitchens and bathrooms all the way to move-in-quality remodels. One licensed contractor, one accountable crew, from the first cut to the final coat.',
    bullets: ['Ceiling & drywall repair', 'Water damage restoration', 'Interior repairs after roof leaks', 'Kitchen & bathroom remodels', 'Framing & structural corrections'],
    cta: 'Get a Repair Estimate',
    shots: [
      { img: '/images/kitchen-remodel.webp', alt: 'Remodeled white kitchen with large island' },
      { img: '/images/bathroom-remodel.webp', alt: 'Remodeled bathroom with tiled tub and shower' },
      { img: '/images/shower-tile.webp', alt: 'Custom tiled walk-in shower with niche' },
    ],
    galleryCat: 'interior',
  },
  {
    slug: 'pools-lanais',
    nav: 'Pools & Lanais',
    title: 'Pools, Lanais & Outdoor Living',
    metaTitle: 'Pool Builds, Lanais & Outdoor Living in Southwest Florida | Vertical Builders & Commercial',
    metaDescription: 'Custom pool builds and remodels, screened lanais, pool cages, pavers and outdoor living construction in Nokomis, Venice, Sarasota, North Port & Port Charlotte, FL.',
    heroImg: '/images/pool-spa-finished.webp',
    heroAlt: 'Finished waterfront pool and spa with blue mosaic tile',
    intro: 'Outdoor living is why you live in Florida. We build and remodel pools, install screened lanais and pool cages, and finish decks with tile, travertine, and pavers — permitted, engineered, and built to handle Gulf Coast weather.',
    bullets: ['New pool builds & remodels', 'Pool decks, tile & coping', 'Screened lanais & pool cages', 'Pavers & concrete pours', 'Outdoor living upgrades'],
    cta: 'Plan an Outdoor Project',
    shots: [
      { img: '/images/pool-construction-aerial.webp', label: 'Before', alt: 'Pool shell under construction, aerial view' },
      { img: '/images/pool-spa-tile-work.webp', label: 'Tile & Coping', alt: 'Blue mosaic tile and coping installation on spa' },
      { img: '/images/pool-waterfront.webp', label: 'After', after: true, alt: 'Finished waterfront pool and spa' },
    ],
    galleryCat: 'pools-outdoor',
  },
]

export const getService = (slug: string) => SERVICES.find(s => s.slug === slug)
