// ============================================================
// SINGLE SOURCE OF TRUTH — edit business info here
// ============================================================
export const BIZ = {
  name: 'Vertical Builders & Commercial',
  phone: '941-877-2009',
  phoneHref: 'tel:+19418772009',
  email: 'Office@verticalbc.com',
  address: '303 S Tamiami Trail Unit H',
  cityStateZip: 'Nokomis, FL 34275',
  // Confirmed by Fred 7/1/26 — matches current site + client services graphic
  licenseGC: 'CGC1528626',
  licenseRoof: 'CCC1333649',
  facebook: 'https://www.facebook.com/verticalbuildersandcommercial',
  googleProfile: 'https://share.google/RhODy88tDx7AKneP5',
  siteUrl: 'https://www.verticalbuildersandcommercial.com',
  ratingValue: '4.9',
  ratingCount: '75',
} as const

// Primary areas (footer, compact lists)
export const AREAS = ['Nokomis', 'Venice', 'Sarasota', 'North Port', 'Port Charlotte', 'Englewood'] as const

// Full Southwest Florida coverage (service-area section, schema)
export const AREAS_ALL = [
  'Nokomis', 'Venice', 'Osprey', 'Sarasota', 'Bradenton', 'Lakewood Ranch', 'Palmetto', 'Parrish',
  'Anna Maria Island', 'Englewood', 'Manasota Key', 'Rotonda West', 'Placida', 'Boca Grande', 'Port Charlotte',
  'Punta Gorda', 'North Port', 'Arcadia', 'Fort Myers', 'North Fort Myers', 'Cape Coral',
  'Lehigh Acres', 'Estero', 'Bonita Springs', 'Naples', 'Marco Island', 'LaBelle', 'Immokalee',
] as const

export const COUNTIES = [
  'Sarasota County', 'Charlotte County', 'Lee County', 'Collier County',
  'DeSoto County', 'Manatee County', 'Hendry County', 'Glades County',
] as const

// Short excerpts from real Google reviews (pulled 7/1/26, 4.9★ / 75 reviews).
export interface Review { name: string; project: string; text: string }
export const REVIEWS: Review[] = [
  { name: 'Judith A.', project: 'Lanai permitting', text: 'Eddie Ramon was a life saver. He worked with the county through the entire process.' },
  { name: 'Carol M.', project: 'Pool cage & gutters', text: 'From start to finish, the project was amazing! Wonderful communication with Eddie.' },
  { name: 'Andres D.', project: 'Patio roof', text: 'The crew was fast and efficient, completing the work exactly as promised.' },
  { name: 'Google review', project: 'Roofing', text: 'The quality of their work is excellent, and I highly recommend this company.' },
  { name: 'Google review', project: 'Remodeling', text: '5 stars for professional service and communication throughout the process.' },
]

export interface Faq { q: string; a: string }
export const FAQS: Faq[] = [
  { q: 'Do you handle both roofing and general contracting?', a: 'Yes. We hold both a Florida Certified General Contractor license (CGC1528626) and a Certified Roofing Contractor license (CCC1333649) — one company can take your project from roof to remodel.' },
  { q: 'Do you offer free roof inspections or estimates?', a: 'Yes. Roof inspections and project estimates are free throughout our Southwest Florida service area.' },
  { q: 'Can you help with storm or water-damage repairs?', a: "Yes. We handle storm damage from emergency tarp and dry-in through full roof replacement — and because we're also a general contractor, we repair the interior ceiling, drywall, and water damage afterward." },
  { q: 'Do you handle permits?', a: 'Yes. As a licensed general contractor we pull permits and manage inspections. We can also help resolve unpermitted work issues on existing properties.' },
  { q: 'Do you offer financing?', a: 'Financing options are available for qualifying projects, including 0% plans for qualified buyers. Contact us for current terms.' },
  { q: 'Do you serve all of Southwest Florida?', a: 'Yes. Vertical Builders and Commercial serves homeowners and businesses throughout Southwest Florida, including Sarasota, Venice, North Port, Port Charlotte, Punta Gorda, Englewood, Rotonda West, Fort Myers, Cape Coral, Naples, and nearby communities.' },
  { q: 'Do you handle both residential and commercial work?', a: 'Yes. Vertical Builders and Commercial works with both residential and commercial property owners on roofing, repair, remodeling, and construction projects that fit our licensing and scope.' },
]

export const EXTRA_SERVICES = ['Impact Windows & Doors', 'Kitchen & Bathroom Remodels', 'New Construction', 'Additions & ADUs', 'Fences & Gutters', 'Epoxy Flake Flooring', 'Pavers & Concrete Pours', 'Permitting & Unpermitted-Work Help', 'Structural Engineering Services'] as const

export const STEPS = [
  { title: 'Free Consultation', desc: 'Free inspection or on-site consultation to assess your project.' },
  { title: 'Scope & Estimate', desc: 'Clear written scope and estimate — no surprises later.' },
  { title: 'Permits & Scheduling', desc: 'We pull permits, order materials, and set the schedule.' },
  { title: 'Build / Repair', desc: 'Licensed crews complete the work to code and to spec.' },
  { title: 'Final Walkthrough', desc: 'We walk the finished job with you and stand behind it.' },
] as const

export const PROJECT_TYPES = ['Roofing', 'Ceiling / Interior Repair', 'Pool / Lanai / Outdoor Living', 'Remodeling', 'Other'] as const
