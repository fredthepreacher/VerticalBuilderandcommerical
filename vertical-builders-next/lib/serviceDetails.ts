// ============================================================
// Service-page depth: direct answers, warning signs, FAQs and related links.
//
// Rules for anything added here:
//  - Answer the question in the first sentence, then explain.
//  - Legal/insurance facts cite the statute or agency, and link to it.
//  - No invented numbers: no prices, durations, project counts, warranties or
//    ratings that the owner has not confirmed. Where pricing varies, explain
//    what drives it instead.
// ============================================================
import type { Faq } from './data'

export interface Citation { label: string; href: string }
export interface ServiceDetail {
  /** Self-contained answer passage — written to be quotable on its own. */
  answer: string
  signsTitle: string
  signs: string[]
  faqs: Faq[]
  related: string[] // service slugs
  guides: string[] // guide slugs
  /** PROJECT_TYPES value to preselect on the contact form. */
  formValue: string
  /** Match REVIEWS by their `project` label. */
  reviewMatch: string[]
  citations?: Citation[]
}

export const SERVICE_DETAILS: Record<string, ServiceDetail> = {
  roofing: {
    answer:
      'Vertical Builders and Commercial is a Florida Certified Roofing Contractor (CCC1333649) based in Nokomis that inspects, repairs and replaces shingle, metal, tile and flat roofs across Southwest Florida. Roof inspections are free, and because the company also holds a Certified General Contractor license (CGC1528626), the same crew can repair the ceiling and drywall damage a leak leaves behind.',
    signsTitle: 'Signs it is time for a roof inspection',
    signs: [
      'A water stain, bubble or sag in a ceiling',
      'Missing, lifted or creased shingles after a storm',
      'Cracked or slipped tiles, or exposed underlayment',
      'Your insurer is asking about the age or condition of the roof',
      'Granules collecting in gutters or at downspouts',
    ],
    faqs: [
      {
        q: 'Does Florida make me replace my whole roof if part of it is damaged?',
        a: 'Not always. Under Florida Statute 553.844(5), if your roof was built, repaired or replaced to the 2007 Florida Building Code or later, only the portion being repaired has to meet the current code — even when that is 25% or more of the roof. Older roofs can be different, which is why the inspection starts with the roof’s permit history.',
      },
      {
        q: 'Can my insurance company refuse to renew my policy because of my roof’s age?',
        a: 'Not solely because of age if the roof is under 15 years old. Florida Statute 627.7011(5) also says that for a roof 15 years or older, an insurer may not refuse to issue or renew solely because of age if an authorized inspection shows at least 5 years of useful life remaining.',
      },
      {
        q: 'Do you help after storm damage?',
        a: 'Yes. We tarp and dry-in to stop further water entry, then document the damage with photos and a written scope you can give your insurance company. The claim itself stays between you and your insurer — we repair or replace the roof and the interior damage under it.',
      },
      {
        q: 'How much does a new roof cost?',
        a: 'It depends on the roof’s size and pitch, the material (shingle, metal, tile or flat), how many layers come off, how much rotted decking is found at tear-off, and the wind-zone requirements and permit for your address. We price from a free on-site inspection, not a satellite photo, and put it in a written estimate.',
      },
      {
        q: 'How long does a roof replacement take?',
        a: 'The permit and material lead time usually take longer than the install itself. Your written estimate includes the expected schedule for your roof; tile and larger or steeper roofs take longer than shingle.',
      },
      {
        q: 'Do you offer financing for roofs?',
        a: 'Financing options are available for qualifying projects, including 0% plans for qualified buyers. Ask during your inspection and we will tell you what your project qualifies for.',
      },
    ],
    related: ['interior-repair', 'impact-windows-doors', 'permitting-help'],
    guides: ['florida-roof-25-percent-rule', 'roof-age-and-home-insurance-florida', 'roof-leak-ceiling-damage'],
    formValue: 'Roofing',
    reviewMatch: ['Patio roof', 'Roofing'],
    citations: [
      { label: 'Florida Statute 553.844 (roofing requirements)', href: 'https://www.flsenate.gov/laws/statutes/2025/553.844' },
      { label: 'Florida Statute 627.7011 (roof age and homeowner policies)', href: 'https://www.flsenate.gov/laws/statutes/2025/627.7011' },
    ],
  },

  'interior-repair': {
    answer:
      'After a roof leak, plumbing leak or storm, Vertical Builders and Commercial repairs ceilings, drywall, insulation, flooring and framing under its Florida Certified General Contractor license (CGC1528626) — and can fix the roof that caused the damage under its roofing license (CCC1333649), so one company is accountable for the whole repair.',
    signsTitle: 'Signs water has reached the inside of your home',
    signs: [
      'A brown ring, bubble or sag in a ceiling',
      'Drywall that feels soft or crumbles at the corners',
      'A musty smell in one room or closet',
      'Flooring that cups, lifts or separates',
      'Peeling paint around ceilings, windows or doors',
    ],
    faqs: [
      {
        q: 'Should the roof or the ceiling be fixed first?',
        a: 'Stop the water first. A new ceiling under an unrepaired roof gets wet again. We dry-in or repair the roof, confirm the leak is stopped, then replace the damaged ceiling, insulation and drywall — one schedule instead of two contractors.',
      },
      {
        q: 'Is a small ceiling stain worth an inspection?',
        a: 'Yes. A stain means water has already soaked through the drywall; the insulation and framing above it are often wetter than the stain suggests. The inspection is free.',
      },
      {
        q: 'Do you handle mold?',
        a: 'Florida licenses mold assessment and remediation separately from construction. If we find significant mold we tell you, and we schedule the rebuild after it has been remediated.',
      },
      {
        q: 'Can you remodel while you are repairing?',
        a: 'Yes. Many owners use a water-damage repair to update a kitchen, bathroom or flooring at the same time — it is one permit, one crew and one finish.',
      },
    ],
    related: ['roofing', 'kitchen-bath-remodels', 'permitting-help'],
    guides: ['roof-leak-ceiling-damage'],
    formValue: 'Ceiling / Interior Repair',
    reviewMatch: ['Remodeling'],
  },

  'pools-lanais': {
    answer:
      'Vertical Builders and Commercial builds and remodels pools and spas, screened lanais and pool cages, pool decks, and paver and concrete work across Southwest Florida. Work is permitted and built by a licensed Florida general contractor (CGC1528626), and the company also resolves lanais and enclosures that were built without a permit.',
    signsTitle: 'Common outdoor projects we are asked about',
    signs: [
      'A new pool and spa, or a remodel of an existing one',
      'A pool cage or screen enclosure that is damaged or outdated',
      'A pool deck that is cracked, stained or hot underfoot',
      'A covered or screened lanai to extend living space',
      'An existing lanai or enclosure with no permit on file',
    ],
    faqs: [
      {
        q: 'Do pool cages and screen enclosures need a permit?',
        a: 'A new enclosure, or structural changes to one, generally needs a permit and engineering for wind load. Simply rescreening an existing enclosure often does not — Charlotte County, for example, lists rescreening as not requiring a permit. Rules vary by city and county, and we confirm them for your address.',
      },
      {
        q: 'My lanai or pool cage was built without a permit. Can it be fixed?',
        a: 'Usually, yes. We assess what was built, file an after-the-fact permit, make any corrections the building department requires, and see it through final inspection.',
      },
      {
        q: 'Can you remodel a pool instead of building a new one?',
        a: 'Yes. Remodels typically involve new tile and coping, resurfacing, and a new deck in travertine, pavers or concrete — you can see several in our project gallery.',
      },
      {
        q: 'Do you also do pool decks, pavers and concrete?',
        a: 'Yes. We form and pour concrete decks, patios and driveways, and install pavers with proper base preparation and sealing.',
      },
    ],
    related: ['permitting-help', 'new-construction', 'roofing'],
    guides: ['unpermitted-work-after-the-fact-permits'],
    formValue: 'Pool / Lanai / Outdoor Living',
    reviewMatch: ['Pool cage & gutters', 'Lanai permitting'],
    citations: [
      { label: 'Charlotte County permit requirements', href: 'https://www.charlottecountyfl.gov/departments/community-development/building-construction/permits/permit-requirements.stml' },
    ],
  },

  'new-construction': {
    answer:
      'Vertical Builders and Commercial builds ground-up homes, room additions and ADUs across Southwest Florida as the licensed general contractor of record (CGC1528626) — managing engineering coordination, permits, inspections and every trade from site preparation to the final walkthrough.',
    signsTitle: 'What a build with us covers',
    signs: [
      'Lot review, site preparation and clearing',
      'Foundation, block and framing',
      'Engineering coordination and permit applications',
      'Scheduling every trade and every inspection',
      'Driveways, flatwork and the final walkthrough',
    ],
    faqs: [
      {
        q: 'Can you build on a lot I already own?',
        a: 'Yes. We start with a consultation about the lot, zoning, flood zone and budget, then coordinate the design and engineering needed to permit the house.',
      },
      {
        q: 'Do you build additions and ADUs?',
        a: 'Yes. Whether an ADU is allowed — and how big it can be — depends on your city or county’s zoning rules, so we confirm that before any design work.',
      },
      {
        q: 'Who pulls the permits on a new build?',
        a: 'We do. As the general contractor of record we apply for the permits, schedule the inspections and close them out.',
      },
    ],
    related: ['pools-lanais', 'kitchen-bath-remodels', 'permitting-help'],
    guides: [],
    formValue: 'New Construction',
    reviewMatch: [],
  },

  'kitchen-bath-remodels': {
    answer:
      'Vertical Builders and Commercial remodels kitchens and bathrooms across Southwest Florida from demolition to finished room — cabinets, counters, islands, tile showers, waterproofing, flooring and the permitted plumbing and electrical behind the walls — under a Florida Certified General Contractor license (CGC1528626).',
    signsTitle: 'What a remodel with us includes',
    signs: [
      'Demolition and haul-away',
      'Plumbing and electrical changes, permitted and inspected',
      'A waterproofing membrane behind every tiled shower',
      'Cabinets, counters, islands and tile',
      'Flooring, drywall and finish carpentry',
    ],
    faqs: [
      {
        q: 'Does a kitchen or bathroom remodel need a permit?',
        a: 'When plumbing, electrical or structural work changes, generally yes. Purely cosmetic replacement often does not. We tell you which applies during the estimate and pull any permits ourselves.',
      },
      {
        q: 'Why does shower waterproofing matter so much?',
        a: 'Tile and grout are not waterproof. The membrane behind them is what keeps water out of the wall framing. Leaking showers are one of the most common hidden-damage repairs we see — the waterproofing stage is visible in our project photos.',
      },
      {
        q: 'Can you fix water damage and remodel in the same project?',
        a: 'Yes. When a leak has already opened up the walls or floor, it is usually the most economical time to remodel.',
      },
    ],
    related: ['interior-repair', 'permitting-help', 'new-construction'],
    guides: ['roof-leak-ceiling-damage'],
    formValue: 'Kitchen & Bath Remodel',
    reviewMatch: ['Remodeling'],
  },

  'impact-windows-doors': {
    answer:
      'Vertical Builders and Commercial installs hurricane impact-rated windows, entry doors and sliding doors across Southwest Florida, handling product selection, Florida product approvals, permits and inspections as a licensed general contractor (CGC1528626).',
    signsTitle: 'Why owners upgrade to impact openings',
    signs: [
      'No more putting up and taking down shutters each storm',
      'Protection when nobody is home to prepare',
      'Quieter rooms and less heat gain through the glass',
      'Openings that can qualify for wind-mitigation credits',
      'Whole-home or one-elevation-at-a-time replacement',
    ],
    faqs: [
      {
        q: 'Do impact windows lower my insurance?',
        a: 'They can. Florida requires insurers to offer discounts for qualifying wind-mitigation features, and impact-rated openings are one of them. The amount depends on your insurer and is documented on a wind mitigation inspection (form OIR-B1-1802).',
      },
      {
        q: 'Do impact windows need a permit?',
        a: 'Replacing windows and doors generally requires a permit and approved products. Glass-only repairs may not — Charlotte County, for example, exempts glass-only replacement. We handle the permit and inspections.',
      },
      {
        q: 'Do I still need shutters with impact windows?',
        a: 'Impact-rated windows and doors are themselves the opening protection, so they are not paired with shutters.',
      },
      {
        q: 'Can I replace windows in phases?',
        a: 'Yes. Many owners start with the most exposed elevation or the sliding doors and finish the rest later.',
      },
    ],
    related: ['roofing', 'new-construction', 'permitting-help'],
    guides: ['roof-age-and-home-insurance-florida'],
    formValue: 'Impact Windows & Doors',
    reviewMatch: [],
    citations: [
      { label: 'Florida Office of Insurance Regulation — wind mitigation resources', href: 'https://floir.gov/consumers/wind-mitigation-resources' },
    ],
  },

  'permitting-help': {
    answer:
      'Vertical Builders and Commercial resolves unpermitted work across Southwest Florida. As a Florida Certified General Contractor (CGC1528626) the company files after-the-fact permits, coordinates engineering letters and required corrections, manages inspections through final closeout, and does the corrective construction itself — so the owner is not left between an expediter and a separate builder.',
    signsTitle: 'When owners call us about permits',
    signs: [
      'A buyer, lender or inspector found work with no permit on file',
      'A code-enforcement or building-department notice',
      'An insurer asking for permits on a roof, lanai or addition',
      'A previous contractor left a permit open or expired',
      'You bought a home with an enclosed lanai, shed or garage conversion of unknown history',
    ],
    faqs: [
      {
        q: 'What is an after-the-fact permit?',
        a: 'It is a permit filed for work that was already built. The building department reviews the plans and inspects the work — which can mean opening a wall, providing an engineering letter or making corrections — and once it passes, the permit is closed like any other.',
      },
      {
        q: 'Can unpermitted work delay a home sale?',
        a: 'Yes. Buyers, lenders and insurers can ask for it to be resolved before closing. Starting early gives you the most options and the least pressure.',
      },
      {
        q: 'How do I find out if my house has open or expired permits?',
        a: 'Search the permit records of the building department for your address. Inside city limits that is usually the city; in unincorporated areas it is the county. We look this up as the first step of an assessment.',
      },
      {
        q: 'Is my address handled by the city or the county?',
        a: 'It depends on whether the property is inside city limits, not on the mailing address. A Venice mailing address, for example, can be in unincorporated Sarasota County. We confirm the jurisdiction before filing anything.',
      },
      {
        q: 'Can you fix unpermitted work another contractor did?',
        a: 'Yes. That is a large share of this work. We assess what was built, tell you what the building department is likely to require, and correct it with our own licensed crews.',
      },
    ],
    related: ['pools-lanais', 'new-construction', 'kitchen-bath-remodels'],
    guides: ['unpermitted-work-after-the-fact-permits'],
    formValue: 'Permitting Help',
    reviewMatch: ['Lanai permitting'],
    citations: [
      { label: 'Sarasota County Building Division', href: 'https://www.scgov.net/government/planning-and-development-services/building' },
    ],
  },
}

export const PERMIT_STEPS = [
  { title: 'Review', desc: 'We pull the permit history for the address and look at what was built.' },
  { title: 'Assess', desc: 'On-site inspection, and an engineering letter where the county will need one.' },
  { title: 'File', desc: 'We submit the after-the-fact permit application as the licensed contractor.' },
  { title: 'Correct', desc: 'Any required corrections are made by our own licensed crews.' },
  { title: 'Close out', desc: 'We schedule inspections through final and hand you the closeout paperwork.' },
] as const
