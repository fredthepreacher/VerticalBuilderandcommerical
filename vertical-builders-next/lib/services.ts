export interface ServiceShot { img: string; alt: string; label?: string; after?: boolean }
export interface ServicePage {
  slug: string
  pillar?: boolean
  chipMatch?: string // matches an EXTRA_SERVICES label to make its chip clickable
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
  galleryCat?: string
}

export const SERVICES: ServicePage[] = [
  {
    slug: 'roofing',
    pillar: true,
    nav: 'Roofing',
    title: 'Roofing & Storm Protection',
    metaTitle: 'Roofing Contractor in Southwest Florida',
    metaDescription: 'Licensed roofing contractor (CCC1333649) serving all of Southwest Florida. Free roof inspections, storm damage recovery, shingle, metal, tile & flat roofing.',
    heroImg: '/images/roof-shingles-topdown.webp',
    heroAlt: 'Aerial view of a newly installed shingle roof in Southwest Florida',
    intro: 'Florida roofs take a beating — sun, wind, and storm season. As a licensed roofing contractor we inspect, repair, and replace roofs across Southwest Florida, and because we are also a licensed general contractor, we can repair the interior damage a leaking roof leaves behind.',
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
    pillar: true,
    nav: 'Interior Repair',
    title: 'Ceiling, Interior & Water Damage Repair',
    metaTitle: 'Ceiling Repair & Water Damage Restoration in Southwest Florida',
    metaDescription: 'Ceiling repair, drywall, water damage restoration and interior remodeling by a licensed Florida general contractor (CGC1528626). Serving Southwest Florida from Sarasota to Naples.',
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
    pillar: true,
    nav: 'Pools & Lanais',
    title: 'Pools, Lanais & Outdoor Living',
    metaTitle: 'Pool, Lanai & Outdoor Living Contractor in Southwest Florida',
    metaDescription: 'Custom pool builds and remodels, screened lanais, pool cages, pavers and outdoor living construction across Southwest Florida.',
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
  {
    slug: 'new-construction',
    chipMatch: 'New Construction',
    nav: 'New Construction',
    title: 'New Construction & Additions',
    metaTitle: 'New Construction Contractor in Southwest Florida',
    metaDescription: 'Licensed Florida general contractor (CGC1528626) building new homes, additions, and ADUs across Southwest Florida — from site prep and permits through final walkthrough.',
    heroImg: '/images/new-construction.webp',
    heroAlt: 'Newly constructed single-family home in Southwest Florida',
    intro: 'From a cleared lot to the final walkthrough, Vertical Builders and Commercial builds ground-up homes, additions, and ADUs across Southwest Florida. As the licensed general contractor of record we manage engineering coordination, permits, inspections, scheduling, and every trade in between — one accountable company for the whole build.',
    bullets: ['Ground-up custom home construction', 'Room additions & ADUs', 'Site prep, foundation & framing', 'Permits, inspections & engineering coordination', 'Concrete driveways & flatwork'],
    cta: 'Plan Your Build',
    shots: [
      { img: '/gallery/new-construction/full/foundation-layout.webp', label: 'Site & Foundation', alt: 'Foundation layout on a cleared new construction lot' },
      { img: '/gallery/new-construction/full/new-build-stucco.webp', label: 'Structure', alt: 'New construction home at stucco stage' },
      { img: '/gallery/new-construction/full/new-home-complete.webp', label: 'Completed', after: true, alt: 'Completed new construction home by Vertical Builders and Commercial' },
    ],
    galleryCat: 'new-construction',
  },
  {
    slug: 'kitchen-bath-remodels',
    chipMatch: 'Kitchen & Bathroom Remodels',
    nav: 'Kitchen & Bath',
    title: 'Kitchen & Bathroom Remodeling',
    metaTitle: 'Kitchen & Bathroom Remodeling in Southwest Florida',
    metaDescription: 'Licensed kitchen and bathroom remodeling across Southwest Florida: cabinets, counters, tile showers, flooring, and full-gut renovations finished to move-in quality.',
    heroImg: '/images/kitchen-remodel.webp',
    heroAlt: 'Remodeled white kitchen with large island',
    intro: 'Kitchens and bathrooms are where remodeling dollars work hardest. Vertical Builders and Commercial takes both from demo to done: cabinets, counters, islands, tile showers, waterproofing, flooring, and the plumbing and electrical behind the walls — permitted and inspected, not patched.',
    bullets: ['Full kitchen remodels & islands', 'Bathroom renovations & walk-in showers', 'Proper shower waterproofing before tile', 'Flooring, drywall & finish carpentry', 'Permitted plumbing & electrical changes'],
    cta: 'Get a Remodel Estimate',
    shots: [
      { img: '/gallery/interior/full/kitchen-remodel-demo.webp', label: 'Demo', alt: 'Kitchen demolition stage during interior remodel' },
      { img: '/gallery/interior/full/shower-waterproofing.webp', label: 'Waterproofing', alt: 'Shower waterproofing during bathroom renovation' },
      { img: '/gallery/interior/full/kitchen-island-remodel.webp', label: 'Completed', after: true, alt: 'Completed kitchen remodel with large island and quartz countertop' },
    ],
    galleryCat: 'interior',
  },
  {
    slug: 'impact-windows-doors',
    chipMatch: 'Impact Windows & Doors',
    nav: 'Impact Windows',
    title: 'Impact Windows & Doors',
    metaTitle: 'Impact Window & Door Installation in Southwest Florida',
    metaDescription: 'Hurricane impact window and door installation by a licensed Florida general contractor. Storm protection, energy savings, and potential insurance benefits for Southwest Florida homes.',
    heroImg: '/images/window-install-exterior.webp',
    heroAlt: 'Exterior window on a stucco home in Southwest Florida',
    intro: 'Impact-rated windows and doors are one of the highest-value storm upgrades a Southwest Florida home can get: protection during hurricane season, quieter interiors, lower cooling loads, and potential wind-mitigation insurance credits. As a licensed general contractor we handle product selection, permits, installation, and inspection.',
    bullets: ['Hurricane impact window installation', 'Impact-rated entry & sliding doors', 'Permits, product approvals & inspections', 'Wind-mitigation documentation for insurers', 'Whole-home or phased replacement'],
    cta: 'Get an Impact Window Estimate',
    shots: [
      { img: '/images/window-install-exterior.webp', alt: 'Exterior window installation on a Southwest Florida home' },
      { img: '/images/new-construction.webp', alt: 'New construction home with modern windows' },
    ],
  },
  {
    slug: 'permitting-help',
    chipMatch: 'Permitting & Unpermitted-Work Help',
    nav: 'Permitting Help',
    title: 'Permitting & Unpermitted Work Help',
    metaTitle: 'Permit Help & Unpermitted Work Resolution in Southwest Florida',
    metaDescription: 'Hired someone who never pulled a permit? Vertical Builders and Commercial resolves unpermitted work with after-the-fact permits across Southwest Florida — inspections, corrections, and closeout by a licensed GC.',
    heroImg: '/images/permit-help-graphic.webp',
    heroAlt: 'Vertical Builders and Commercial permit assistance information',
    intro: 'Unpermitted work surfaces at the worst times — during a sale, an insurance claim, or a county notice. Vertical Builders and Commercial specializes in making it right: we assess the work, file after-the-fact permits, coordinate any required corrections and engineering letters, and manage county inspections through final closeout. It is detailed, patient work, and it is one of the things clients thank us for most.',
    bullets: ['After-the-fact permit filing', 'Unpermitted lanais, fences, sheds & remodels', 'County coordination & inspection scheduling', 'Corrective work by licensed crews', 'Closeout documentation for sales & insurance'],
    cta: 'Resolve a Permit Issue',
    shots: [
      { img: '/images/permit-help-graphic.webp', alt: 'Vertical Builders and Commercial permit help information graphic' },
      { img: '/gallery/lanai/full/lanai-structure.webp', alt: 'Lanai screen enclosure structure — a common after-the-fact permit item' },
    ],
  },
]

export const getService = (slug: string) => SERVICES.find(s => s.slug === slug)
