// ============================================================
// Service-area (location) pages — one entry per city.
// Each intro is unique copy; keep it natural, no fake local claims.
// The business is based in Nokomis and SERVES these areas.
// ============================================================

export interface ServiceArea {
  slug: string
  name: string
  county: string
  intro: string
  localAngle: string // one extra locally-flavored sentence used mid-page
  nearby: string[] // slugs
}

export const SERVICE_AREAS: ServiceArea[] = [
  {
    slug: 'sarasota',
    name: 'Sarasota',
    county: 'Sarasota County',
    intro: 'Vertical Builders and Commercial serves Sarasota property owners with licensed roofing, general contracting, interior repair, pool, lanai, outdoor living, and commercial construction services. Whether the project involves storm protection, roof work, ceiling repair, or improving an outdoor living space, our team helps homeowners and businesses move projects forward with dependable craftsmanship.',
    localAngle: 'From older neighborhoods near downtown to newer communities east of I-75, Sarasota properties span decades of construction styles — and our dual GC and roofing licenses let us handle both the structure and the finish work.',
    nearby: ['osprey', 'nokomis', 'venice', 'bradenton', 'lakewood-ranch', 'anna-maria-island'],
  },
  {
    slug: 'englewood',
    name: 'Englewood',
    county: 'Sarasota & Charlotte Counties',
    intro: 'Englewood homeowners deal with salt air, coastal storms, and aging roofs — and Vertical Builders and Commercial handles all of it. We provide licensed roofing, storm recovery, ceiling and water-damage repair, pool and lanai construction, and general contracting for properties across the Englewood area.',
    localAngle: 'Straddling the Sarasota–Charlotte county line, Englewood permitting can involve either county — we pull the right permits either way and manage inspections through closeout.',
    nearby: ['rotonda-west', 'north-port', 'venice', 'port-charlotte', 'punta-gorda'],
  },
  {
    slug: 'fort-myers',
    name: 'Fort Myers',
    county: 'Lee County',
    intro: 'Vertical Builders and Commercial brings licensed roofing, general contracting, interior repair, and outdoor living construction to Fort Myers homeowners and businesses. From storm-damaged roofs to pool and lanai upgrades, we manage the scope, the permits, and the build.',
    localAngle: 'Lee County has seen its share of hurricane recovery work — we handle tarp-to-finish roof replacement and the interior repairs that follow water intrusion.',
    nearby: ['north-fort-myers', 'cape-coral', 'punta-gorda', 'port-charlotte', 'naples'],
  },
  {
    slug: 'naples',
    name: 'Naples',
    county: 'Collier County',
    intro: 'In Naples, finish quality matters. Vertical Builders and Commercial provides licensed general contracting, roofing, interior remodeling, and pool, lanai, and outdoor living construction for Naples-area homes and commercial properties, with the craftsmanship standards discerning owners expect.',
    localAngle: 'Outdoor living is central to Naples properties — we build and remodel pools, spas, decks, and screened lanais designed for year-round use.',
    nearby: ['fort-myers', 'cape-coral', 'north-fort-myers'],
  },
  {
    slug: 'anna-maria-island',
    name: 'Anna Maria Island',
    county: 'Manatee County',
    intro: 'Island properties face wind, salt, and storm exposure year-round. Vertical Builders and Commercial serves Anna Maria Island with licensed roofing, storm protection, interior repair, and outdoor living construction — including work on elevated and coastal-code construction.',
    localAngle: 'Coastal-zone work on the island often involves stricter wind and flood requirements — as a licensed GC and roofing contractor we build to those codes and document everything for insurers.',
    nearby: ['bradenton', 'palmetto', 'lakewood-ranch', 'sarasota'],
  },
  {
    slug: 'port-charlotte',
    name: 'Port Charlotte',
    county: 'Charlotte County',
    intro: 'Vertical Builders and Commercial works throughout Port Charlotte on roofing, storm damage recovery, ceiling and interior repair, pools, lanais, and general contracting. Our crews are in Charlotte County regularly, and several of our featured roofing projects are in this area.',
    localAngle: 'Canal-front homes in Port Charlotte take real weather — we handle roof replacement, pool cages, and the water-damage repairs that follow storm seasons.',
    nearby: ['north-port', 'punta-gorda', 'englewood', 'rotonda-west', 'arcadia', 'cape-coral'],
  },
  {
    slug: 'north-port',
    name: 'North Port',
    county: 'Sarasota County',
    intro: 'North Port is one of the fastest-growing cities in Southwest Florida, and Vertical Builders and Commercial supports that growth with licensed new construction, roofing, interior repair, and outdoor living services for both new and established neighborhoods.',
    localAngle: 'We have built ground-up homes in the North Port area — from site prep and foundation through finished construction — alongside roof replacements and remodels.',
    nearby: ['port-charlotte', 'venice', 'englewood', 'punta-gorda', 'sarasota'],
  },
  {
    slug: 'venice',
    name: 'Venice',
    county: 'Sarasota County',
    intro: 'From the island to East Venice, Vertical Builders and Commercial provides Venice property owners with licensed roofing, ceiling and interior repair, pool and lanai construction, and general contracting. We are based just up the road in Nokomis, which makes Venice one of our home service areas.',
    localAngle: 'Being headquartered minutes away in Nokomis means fast scheduling for Venice inspections and estimates.',
    nearby: ['nokomis', 'osprey', 'englewood', 'north-port', 'sarasota'],
  },
  {
    slug: 'punta-gorda',
    name: 'Punta Gorda',
    county: 'Charlotte County',
    intro: 'Punta Gorda properties — from historic district homes to waterfront communities — get licensed roofing, storm protection, interior repair, and outdoor living construction from Vertical Builders and Commercial. We manage permits, inspections, and the build itself.',
    localAngle: 'Punta Gorda knows hurricanes better than most of Florida — storm-resistant roofing and properly engineered screen enclosures are a large part of what we do here.',
    nearby: ['port-charlotte', 'north-port', 'arcadia', 'fort-myers', 'cape-coral'],
  },
  {
    slug: 'cape-coral',
    name: 'Cape Coral',
    county: 'Lee County',
    intro: 'With hundreds of miles of canals, Cape Coral is built around outdoor living. Vertical Builders and Commercial serves Cape Coral with licensed pool and lanai construction, roofing and storm recovery, interior repair, and general contracting for waterfront and inland properties alike.',
    localAngle: 'Pool cages and screened lanais take the brunt of coastal weather here — we build and rebuild them to current wind code.',
    nearby: ['fort-myers', 'north-fort-myers', 'punta-gorda', 'port-charlotte'],
  },
  {
    slug: 'north-fort-myers',
    name: 'North Fort Myers',
    county: 'Lee County',
    intro: 'Vertical Builders and Commercial provides North Fort Myers homeowners with licensed roofing, ceiling and water-damage repair, pool and lanai work, and general contracting. One licensed company handles the project from estimate through final walkthrough.',
    localAngle: 'Many North Fort Myers homes are ready for roof replacement or lanai upgrades — we provide free inspections so owners know exactly where they stand.',
    nearby: ['fort-myers', 'cape-coral', 'punta-gorda', 'port-charlotte'],
  },
  {
    slug: 'rotonda-west',
    name: 'Rotonda West',
    county: 'Charlotte County',
    intro: 'Rotonda West homeowners choose Vertical Builders and Commercial for licensed roofing, storm damage recovery, interior repair, and pool and lanai construction. We serve the community regularly from our Nokomis base and know Charlotte County permitting well.',
    localAngle: 'Golf-course communities like Rotonda West expect clean job sites and finished results — our crews deliver both.',
    nearby: ['englewood', 'port-charlotte', 'north-port', 'punta-gorda'],
  },
  {
    slug: 'bradenton',
    name: 'Bradenton',
    county: 'Manatee County',
    intro: 'Vertical Builders and Commercial serves Bradenton with licensed roofing, general contracting, ceiling and interior repair, and outdoor living construction. From established West Bradenton neighborhoods to newer developments, we handle residential and commercial projects.',
    localAngle: 'Manatee County properties range from mid-century block homes to brand-new builds — our dual licensing covers the roof and everything under it.',
    nearby: ['palmetto', 'lakewood-ranch', 'anna-maria-island', 'sarasota', 'parrish'],
  },
  {
    slug: 'lakewood-ranch',
    name: 'Lakewood Ranch',
    county: 'Manatee County',
    intro: 'Lakewood Ranch homeowners expect polished results, and Vertical Builders and Commercial delivers licensed remodeling, roofing, outdoor living, and general contracting to match the community standard. Kitchens, bathrooms, lanais, and pool areas are our most requested projects here.',
    localAngle: 'HOA and design-standard requirements are common in Lakewood Ranch — we work within them and handle the paperwork.',
    nearby: ['bradenton', 'sarasota', 'parrish', 'palmetto'],
  },
  {
    slug: 'osprey',
    name: 'Osprey',
    county: 'Sarasota County',
    intro: 'Sitting between Sarasota and our Nokomis home base, Osprey is core service territory for Vertical Builders and Commercial. We provide licensed roofing, interior repair, pool and lanai construction, and general contracting for Osprey homes from the bayfront to Palmer Ranch.',
    localAngle: 'Minutes from our office, Osprey projects get fast estimates and flexible scheduling.',
    nearby: ['nokomis', 'sarasota', 'venice'],
  },
  {
    slug: 'nokomis',
    name: 'Nokomis',
    county: 'Sarasota County',
    intro: 'Nokomis is home — Vertical Builders and Commercial is headquartered at 303 S Tamiami Trail. Local homeowners get licensed roofing, ceiling and interior repair, pools, lanais, outdoor living, and general contracting from a contractor whose office is right in the neighborhood.',
    localAngle: 'As our headquarters city, Nokomis projects get the fastest response times we offer — stop by the office or call anytime during business hours.',
    nearby: ['venice', 'osprey', 'sarasota', 'englewood'],
  },
]

export const getServiceArea = (slug: string) => SERVICE_AREAS.find(a => a.slug === slug)
export const areaSlugByName = (name: string) => SERVICE_AREAS.find(a => a.name === name)?.slug
