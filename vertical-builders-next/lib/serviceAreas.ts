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
    intro: 'Vertical Builders and Commercial works throughout Port Charlotte on roofing, storm damage recovery, ceiling and interior repair, pools, lanais, and general contracting.',
    localAngle: 'Canal-front homes in Port Charlotte take real weather — we handle roof replacement, pool cages, and the water-damage repairs that follow storm seasons.',
    nearby: ['north-port', 'punta-gorda', 'englewood', 'rotonda-west', 'arcadia', 'cape-coral'],
  },
  {
    slug: 'north-port',
    name: 'North Port',
    county: 'Sarasota County',
    intro: 'North Port is one of the fastest-growing cities in Southwest Florida, and Vertical Builders and Commercial supports that growth with licensed new construction, roofing, interior repair, and outdoor living services for both new and established neighborhoods.',
    localAngle: 'With so much of North Port still being built out, new construction, additions, pools and lanais are common requests here — alongside roof replacements and storm repairs on established streets.',
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
    intro: 'Rotonda West homeowners choose Vertical Builders and Commercial for licensed roofing, storm damage recovery, interior repair, and pool and lanai construction. We serve the community from our Nokomis base and handle Charlotte County permitting routinely.',
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
    county: 'Manatee & Sarasota Counties',
    intro: 'Lakewood Ranch homeowners expect polished results, and Vertical Builders and Commercial delivers licensed remodeling, roofing, outdoor living, and general contracting to match the community standard.',
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
    localAngle: 'Nokomis projects are closest to our office — stop by or call during business hours.',
    nearby: ['venice', 'osprey', 'sarasota', 'englewood'],
  },
  {
    slug: 'palmetto',
    name: 'Palmetto',
    county: 'Manatee County',
    intro: 'Palmetto property owners on the north side of the Manatee River get licensed roofing, general contracting, interior repair, and outdoor living construction from Vertical Builders and Commercial. We handle residential and commercial projects with the same crews and standards we bring to the rest of Southwest Florida.',
    localAngle: 'Between riverfront neighborhoods and working commercial property along US-41, Palmetto projects range widely — our dual GC and roofing licensing covers both sides.',
    nearby: ['bradenton', 'parrish', 'anna-maria-island', 'lakewood-ranch'],
  },
  {
    slug: 'parrish',
    name: 'Parrish',
    county: 'Manatee County',
    intro: 'Parrish is growing fast, and Vertical Builders and Commercial supports that growth with licensed new construction, roofing, remodeling, and outdoor living services. From new-community homes that need a lanai or pool to established properties due for a roof, we manage the project end to end.',
    localAngle: 'Many Parrish homes are newer builds, which makes outdoor living additions — pools, lanais, screen enclosures and paver work — a natural next project.',
    nearby: ['bradenton', 'palmetto', 'lakewood-ranch'],
  },
  {
    slug: 'manasota-key',
    name: 'Manasota Key',
    county: 'Sarasota & Charlotte Counties',
    intro: 'Manasota Key properties sit directly in the path of Gulf weather, and Vertical Builders and Commercial builds for it: licensed roofing and storm protection, water-damage repair, and coastal outdoor living construction for homes along the key.',
    localAngle: 'Barrier-island work means wind-zone codes, salt exposure, and often two counties of permitting — we handle all three routinely.',
    nearby: ['englewood', 'venice', 'rotonda-west', 'placida'],
  },
  {
    slug: 'placida',
    name: 'Placida',
    county: 'Charlotte County',
    intro: 'In Placida and the Cape Haze peninsula, Vertical Builders and Commercial provides licensed roofing, storm recovery, interior repair, and outdoor living construction. Coastal homes here need contractors who document their work properly for insurers — that is standard practice for us.',
    localAngle: 'From waterfront communities to golf-course neighborhoods, Placida projects usually involve wind mitigation detail — we build and document to current code.',
    nearby: ['boca-grande', 'rotonda-west', 'englewood', 'port-charlotte'],
  },
  {
    slug: 'boca-grande',
    name: 'Boca Grande',
    county: 'Lee County',
    intro: 'Boca Grande homes deserve careful, code-correct work. Vertical Builders and Commercial serves Gasparilla Island with licensed roofing, storm protection, interior restoration, and outdoor living construction, with the finish quality island properties expect.',
    localAngle: 'Island logistics, historic-district considerations, and strict wind codes make Boca Grande projects demanding — licensed, insured, documented work is non-negotiable here.',
    nearby: ['placida', 'rotonda-west', 'englewood', 'port-charlotte'],
  },
  {
    slug: 'arcadia',
    name: 'Arcadia',
    county: 'DeSoto County',
    intro: 'Vertical Builders and Commercial serves Arcadia and DeSoto County with licensed roofing, storm damage repair, interior and ceiling repair, and general contracting. Inland properties take real wind and rain too — and we bring the same crews and licensing inland that we use on the coast.',
    localAngle: 'From in-town homes to rural properties and outbuildings, Arcadia projects get the same free-inspection, written-scope process we use everywhere.',
    nearby: ['punta-gorda', 'port-charlotte', 'north-port'],
  },
  {
    slug: 'estero',
    name: 'Estero',
    county: 'Lee County',
    intro: 'Estero homeowners in gated and golf communities choose Vertical Builders and Commercial for licensed remodeling, roofing, and outdoor living construction. We work within HOA requirements and deliver the finish level these communities expect.',
    localAngle: 'Kitchen and bath remodels, lanai upgrades and pool-area work are typical Estero projects, usually with an HOA approval step first.',
    nearby: ['bonita-springs', 'fort-myers', 'naples', 'cape-coral'],
  },
  {
    slug: 'bonita-springs',
    name: 'Bonita Springs',
    county: 'Lee County',
    intro: 'Between Naples and Fort Myers, Bonita Springs properties get licensed roofing, general contracting, interior repair, and pool and lanai construction from Vertical Builders and Commercial. One licensed company handles scope, permits, and build.',
    localAngle: 'Coastal Bonita neighborhoods know storm surge and wind — roofing, water-damage repair, and re-screening are steady work for our crews here.',
    nearby: ['estero', 'naples', 'fort-myers', 'marco-island'],
  },
  {
    slug: 'marco-island',
    name: 'Marco Island',
    county: 'Collier County',
    intro: 'Marco Island combines waterfront exposure with high finish expectations, and Vertical Builders and Commercial serves both: licensed roofing and storm protection, interior restoration, and pool, spa, and outdoor living construction for island properties.',
    localAngle: 'Condo associations and single-family owners alike need contractors who handle Collier County permitting cleanly — we do, from application through final inspection.',
    nearby: ['naples', 'bonita-springs', 'estero'],
  },
  {
    slug: 'lehigh-acres',
    name: 'Lehigh Acres',
    county: 'Lee County',
    intro: 'Lehigh Acres homeowners get straightforward, licensed contracting from Vertical Builders and Commercial: roof repair and replacement, ceiling and water-damage repair, remodels, and new construction on the area\'s many buildable lots.',
    localAngle: 'With so many buildable lots, Lehigh Acres is a common place for new construction and additions — a free consultation covers the lot, permits and budget before anything is drawn.',
    nearby: ['fort-myers', 'north-fort-myers', 'cape-coral'],
  },
]

export const getServiceArea = (slug: string) => SERVICE_AREAS.find(a => a.slug === slug)
export const areaSlugByName = (name: string) => SERVICE_AREAS.find(a => a.name === name)?.slug

// ------------------------------------------------------------
// Who issues building permits. Incorporated cities run their own permitting
// inside city limits; unincorporated communities are permitted by the county.
// This is the question owners most often get wrong (a mailing address is not
// proof of jurisdiction), so each city page answers it plainly.
// ------------------------------------------------------------
type Jurisdiction =
  | { kind: 'city'; city: string }
  | { kind: 'unincorporated' }
  | { kind: 'custom'; note: string }

const JURISDICTION: Record<string, Jurisdiction> = {
  sarasota: { kind: 'city', city: 'City of Sarasota' },
  venice: { kind: 'city', city: 'City of Venice' },
  'north-port': { kind: 'city', city: 'City of North Port' },
  'punta-gorda': { kind: 'city', city: 'City of Punta Gorda' },
  'fort-myers': { kind: 'city', city: 'City of Fort Myers' },
  'cape-coral': { kind: 'city', city: 'City of Cape Coral' },
  naples: { kind: 'city', city: 'City of Naples' },
  bradenton: { kind: 'city', city: 'City of Bradenton' },
  palmetto: { kind: 'city', city: 'City of Palmetto' },
  'bonita-springs': { kind: 'city', city: 'City of Bonita Springs' },
  'marco-island': { kind: 'city', city: 'City of Marco Island' },
  estero: { kind: 'city', city: 'Village of Estero' },
  arcadia: { kind: 'city', city: 'City of Arcadia' },
  nokomis: { kind: 'unincorporated' },
  osprey: { kind: 'unincorporated' },
  'port-charlotte': { kind: 'unincorporated' },
  'rotonda-west': { kind: 'unincorporated' },
  placida: { kind: 'unincorporated' },
  'north-fort-myers': { kind: 'unincorporated' },
  'lehigh-acres': { kind: 'unincorporated' },
  parrish: { kind: 'unincorporated' },
  'boca-grande': { kind: 'unincorporated' },
  englewood: { kind: 'custom', note: 'Englewood is unincorporated and straddles the Sarasota–Charlotte county line, so the permit comes from whichever county the property sits in.' },
  'manasota-key': { kind: 'custom', note: 'Manasota Key is split between Sarasota and Charlotte counties, so the permitting county depends on where on the key the property sits.' },
  'lakewood-ranch': { kind: 'custom', note: 'Lakewood Ranch is unincorporated and spans Manatee and Sarasota counties, so permits come from whichever county the property is in — plus any HOA design approval.' },
  'anna-maria-island': { kind: 'custom', note: 'Anna Maria Island is three separate cities — Anna Maria, Holmes Beach and Bradenton Beach — and permitting follows the city the property is in.' },
}

/** Plain-language answer to "who issues the permit here?" for a city page. */
export function permitNote(area: ServiceArea): string {
  const j = JURISDICTION[area.slug]
  if (!j) return `We confirm whether your ${area.name} address is permitted by a city or by ${area.county} before filing anything.`
  if (j.kind === 'custom') return j.note
  if (j.kind === 'unincorporated') {
    return `${area.name} is unincorporated, so building permits are issued by ${area.county} rather than a city building department.`
  }
  return `Whether a permit comes from the ${j.city} or from ${area.county} depends on whether the property is inside city limits — a ${area.name} mailing address isn't proof. We confirm the jurisdiction and pull the permit ourselves.`
}
