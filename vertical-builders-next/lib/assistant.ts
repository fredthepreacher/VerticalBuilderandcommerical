// ============================================================
// Rule-based assistant "brain" — zero API keys, runs entirely
// client-side over the site's own data. Deterministic and fast.
//
// FUTURE AI UPGRADE PATH (documented in README):
//   1. Add app/api/assistant/route.ts calling your LLM provider
//      with process.env.ANTHROPIC_API_KEY (server-side only).
//   2. In AiAssistantWidget, replace answer() with a fetch to
//      that route, keeping this module as instant fallback.
// ============================================================
import { BIZ, FAQS } from './data'
import { SERVICE_AREAS } from './serviceAreas'
import { SERVICES } from './services'

export interface BotReply {
  text: string
  links?: { label: string; href: string }[]
}

const CONTACT_LINKS = [
  { label: `Call ${BIZ.phone}`, href: BIZ.phoneHref },
  { label: 'Request an Estimate', href: '/contact' },
]

interface Intent {
  keys: string[]
  reply: () => BotReply
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')

// --- Service topics (checked before generic intents) ---
const SERVICE_TOPICS: { keys: string[]; slug: string; blurb: string }[] = [
  { keys: ['permit', 'unpermitted', 'code violation', 'after the fact', 'county notice'], slug: 'permitting-help',
    blurb: 'Unpermitted work? We file after-the-fact permits, coordinate corrections and engineering letters, and close it out with the county. It’s a specialty of ours.' },
  { keys: ['roof', 'shingle', 'tarp', 'storm', 'hurricane damage', 'leak'], slug: 'roofing',
    blurb: 'We handle roof inspections (free), repairs, and full replacement — shingle, metal, tile, and flat roofs — including tarp-to-finish storm recovery.' },
  { keys: ['ceiling', 'drywall', 'water damage', 'interior repair', 'mold', 'restoration'], slug: 'interior-repair',
    blurb: 'We repair ceilings, drywall, flooring, and framing after leaks and water damage — and since we’re also the roofer, we can fix the cause too.' },
  { keys: ['pool', 'spa', 'lanai', 'cage', 'screen', 'enclosure', 'outdoor living', 'paver', 'deck'], slug: 'pools-lanais',
    blurb: 'We build and remodel pools and spas, install screened lanais and pool cages, and finish decks with tile, travertine, and pavers.' },
  { keys: ['new construction', 'new home', 'build a house', 'addition', 'adu', 'custom home', 'ground up'], slug: 'new-construction',
    blurb: 'We build ground-up homes, additions, and ADUs — site prep, permits, and every trade through the final walkthrough.' },
  { keys: ['kitchen', 'bathroom', 'bath', 'remodel', 'renovation', 'cabinet', 'shower', 'countertop'], slug: 'kitchen-bath-remodels',
    blurb: 'Kitchens and bathrooms from demo to done: cabinets, counters, tile showers with proper waterproofing, flooring, and permitted plumbing/electrical.' },
  { keys: ['impact window', 'window', 'door', 'hurricane window', 'sliders', 'impact glass'], slug: 'impact-windows-doors',
    blurb: 'We install hurricane impact windows and doors with permits, inspections, and wind-mitigation documentation for potential insurance credits.' },
]

const INTENTS: Intent[] = [
  {
    keys: ['license', 'licensed', 'insured', 'cgc', 'ccc', 'credential', 'legit'],
    reply: () => ({
      text: `Yes — fully licensed and insured. Florida Certified General Contractor ${BIZ.licenseGC} and Certified Roofing Contractor ${BIZ.licenseRoof}, both statewide licenses you can verify on the Florida DBPR website.`,
      links: [{ label: 'About our licenses', href: '/about' }],
    }),
  },
  {
    keys: ['financ', '0%', 'payment plan', 'afford', 'loan', 'monthly'],
    reply: () => ({
      text: 'Financing options are available for qualifying projects, including 0% plans for qualified buyers. Terms depend on the project — call us and we’ll walk you through what yours qualifies for.',
      links: CONTACT_LINKS,
    }),
  },
  {
    keys: ['estimate', 'quote', 'inspection', 'consultation', 'how much', 'cost', 'price', 'free'],
    reply: () => ({
      text: `Roof inspections and project estimates are free across our Southwest Florida service area. The fastest route is calling ${BIZ.phone}; the form works great too and we usually reply the same business day.`,
      links: CONTACT_LINKS,
    }),
  },
  {
    keys: ['review', 'rating', 'reputation', 'testimonial', 'trust'],
    reply: () => ({
      text: `We hold a ${BIZ.ratingValue}-star average across ${BIZ.ratingCount} Google reviews. Homeowners most often mention communication, fair pricing, and follow-through on permits.`,
      links: [
        { label: 'Read Google reviews', href: BIZ.googleProfile },
        { label: 'See our work', href: '/gallery' },
      ],
    }),
  },
  {
    keys: ['photo', 'gallery', 'picture', 'portfolio', 'before and after', 'your work', 'projects'],
    reply: () => ({
      text: 'Our gallery has 55+ real project photos — roofing, pools, lanais, remodels, and new construction — all our own crews’ work, no stock imagery.',
      links: [{ label: 'Browse the gallery', href: '/gallery' }],
    }),
  },
  {
    keys: ['hour', 'open', 'located', 'address', 'office', 'where are you'],
    reply: () => ({
      text: `Our office is at ${BIZ.address}, ${BIZ.cityStateZip}. Call ${BIZ.phone} or email ${BIZ.email} — we usually respond the same business day.`,
      links: CONTACT_LINKS,
    }),
  },
  {
    keys: ['commercial', 'business property', 'office building', 'retail'],
    reply: () => ({
      text: 'Yes — we work with both residential and commercial property owners across Southwest Florida, on projects that fit our general contracting and roofing licensing.',
      links: CONTACT_LINKS,
    }),
  },
  {
    keys: ['who are you', 'about the company', 'tell me about', 'what is vertical'],
    reply: () => ({
      text: `Vertical Builders and Commercial is a licensed general contractor (${BIZ.licenseGC}) and roofing contractor (${BIZ.licenseRoof}) based in Nokomis, FL, serving all of Southwest Florida — roofing, interior repair, pools and lanais, remodels, new construction, and commercial work.`,
      links: [{ label: 'About us', href: '/about' }],
    }),
  },
]

export function answer(input: string): BotReply {
  const q = ` ${norm(input)} `

  // 1. Location questions — match any known service-area city
  const area = SERVICE_AREAS.find(a => q.includes(` ${norm(a.name)} `) || q.includes(norm(a.name)))
  if (area) {
    const topic = SERVICE_TOPICS.find(t => t.keys.some(k => q.includes(k)))
    if (topic) {
      const svc = SERVICES.find(s => s.slug === topic.slug)
      return {
        text: `Yes — we serve ${area.name} (${area.county}). ${topic.blurb}`,
        links: [
          { label: `${svc?.title ?? 'Service'} details`, href: `/${topic.slug}` },
          { label: `${area.name} service area`, href: `/service-areas/${area.slug}` },
          ...CONTACT_LINKS,
        ],
      }
    }
    return {
      text: `Yes — ${area.name} is in our service area (${area.county}). We provide roofing, interior repair, pools and lanais, remodeling, new construction, and general contracting there.`,
      links: [
        { label: `${area.name} service area`, href: `/service-areas/${area.slug}` },
        ...CONTACT_LINKS,
      ],
    }
  }
  if (q.includes('serve') || q.includes('service area') || q.includes('work in') || q.includes('come to') || q.includes('my city') || q.includes('my area') || q.includes('southwest florida')) {
    return {
      text: 'We serve all of Southwest Florida — Sarasota, Manatee, Charlotte, Lee, Collier, and DeSoto counties — including Sarasota, Venice, North Port, Port Charlotte, Englewood, Fort Myers, Cape Coral, and Naples. If you don’t see your city, call and we’ll confirm.',
      links: [{ label: 'All service areas', href: '/service-areas' }, ...CONTACT_LINKS],
    }
  }

  // 2. Service questions
  const topic = SERVICE_TOPICS.find(t => t.keys.some(k => q.includes(k)))
  if (topic) {
    const svc = SERVICES.find(s => s.slug === topic.slug)
    return {
      text: topic.blurb,
      links: [{ label: `${svc?.title ?? 'Service'} details`, href: `/${topic.slug}` }, ...CONTACT_LINKS],
    }
  }

  // 3. General intents
  const intent = INTENTS.find(i => i.keys.some(k => q.includes(k)))
  if (intent) return intent.reply()

  // 4. Site FAQs (word-overlap match)
  const words = q.split(/\s+/).filter(w => w.length > 3)
  let best: { faq: (typeof FAQS)[number]; score: number } | null = null
  for (const faq of FAQS) {
    const hay = norm(faq.q + ' ' + faq.a)
    const score = words.filter(w => hay.includes(w)).length
    if (score >= 2 && (!best || score > best.score)) best = { faq, score }
  }
  if (best) return { text: best.faq.a, links: CONTACT_LINKS }

  // 5. Fallback
  return {
    text: `Good question — that one’s best answered by the team directly. Call ${BIZ.phone} or send the estimate form and we’ll get back to you, usually the same business day.`,
    links: CONTACT_LINKS,
  }
}

export const SUGGESTIONS = [
  'Do you offer free roof inspections?',
  'Do you serve Cape Coral?',
  'Help with unpermitted work',
  'Do you offer financing?',
  'Kitchen remodel estimate',
]
