// ============================================================
// Homeowner guides — original, sourced explainers for the questions Southwest
// Florida owners actually ask before hiring a contractor.
//
// Keep every factual claim tied to a source in `sources`, and bump `updated`
// when a law or program changes. These are general information, not legal or
// insurance advice, and each page says so.
// ============================================================
import type { Faq } from './data'

export interface GuideSection { h: string; p: string[]; list?: string[] }
export interface Guide {
  slug: string
  title: string
  metaTitle: string
  description: string
  updated: string // ISO date
  image: string
  imageAlt: string
  /** The answer in two or three sentences — first thing on the page. */
  answer: string
  sections: GuideSection[]
  faqs: Faq[]
  services: string[] // service slugs
  sources: { label: string; href: string }[]
}

export const GUIDES: Guide[] = [
  {
    slug: 'florida-roof-25-percent-rule',
    title: 'Florida’s 25% Roof Rule, Explained',
    metaTitle: 'Florida 25% Roof Rule Explained (2026)',
    description:
      'Does Florida make you replace your whole roof when 25% is damaged? What changed in 2022, how the 2007 Building Code date matters, and what to ask your roofer.',
    updated: '2026-09-25',
    image: '/images/roof-storm-tarp.webp',
    imageAlt: 'Storm-damaged roof protected with a blue tarp before repair',
    answer:
      'Not necessarily. Since 2022, Florida Statute 553.844(5) says that if a roof was built, repaired or replaced to the 2007 Florida Building Code or later, only the portion being repaired has to meet the current code — even when that portion is 25% or more of the roof. Roofs installed under older codes can still fall under the traditional 25% rule, so the roof’s permit history decides which applies.',
    sections: [
      {
        h: 'What the “25% rule” was',
        p: [
          'For years, the Florida Building Code treated a roof repair covering 25% or more of a roof section within a 12-month period as a trigger to bring the entire roof section up to the current code. After a storm, that often turned a partial repair into a full replacement — and insurance disputes over who paid for it.',
        ],
      },
      {
        h: 'What changed in 2022',
        p: [
          'Senate Bill 4-D (2022) added subsection (5) to Florida Statute 553.844. For a roofing system or section that was built, repaired or replaced in compliance with the 2007 Florida Building Code or any later edition, only the repaired, replaced or recovered portion has to be built to the code currently in effect.',
          'In practice, that means a newer roof with storm damage on one slope can usually be repaired rather than replaced — as long as the repair itself meets today’s code.',
        ],
      },
      {
        h: 'How to tell which rule applies to your roof',
        p: ['The date that matters is when your current roof was permitted and what code it was built to. Useful places to look:'],
        list: [
          'The permit history for your address at your city or county building department',
          'Closing documents or the four-point / roof inspection from when you bought the home',
          'The original roofing contract and final inspection paperwork',
          'Your insurer’s records, which often list roof age',
        ],
      },
      {
        h: 'What to ask a roofer before agreeing to a replacement',
        p: ['A good inspection report should answer these plainly:'],
        list: [
          'What code was this roof built to, and how do you know?',
          'Which portion is damaged, and roughly what share of the roof section is it?',
          'Can this be repaired to current code, or is there a reason it can’t?',
          'What will the repair look like next to the existing roof?',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does the 25% rule still exist in Florida?',
        a: 'Yes, for roofs that were not built to the 2007 Florida Building Code or later. For roofs that were, Florida Statute 553.844(5) limits the code upgrade to the portion being repaired.',
      },
      {
        q: 'Does my insurance company decide whether I get a new roof?',
        a: 'Your insurer decides what your policy pays for. What the building code requires is a separate question, answered by the code and your building department — which is why a clear inspection report matters.',
      },
    ],
    services: ['roofing', 'interior-repair'],
    sources: [
      { label: 'Florida Statute 553.844 — Windstorm loss mitigation; requirements for roofs', href: 'https://www.flsenate.gov/laws/statutes/2025/553.844' },
    ],
  },

  {
    slug: 'roof-age-and-home-insurance-florida',
    title: 'Roof Age and Homeowners Insurance in Florida',
    metaTitle: 'Can Florida Insurers Drop You for Roof Age? (2026)',
    description:
      'What Florida law says about roof age and homeowners insurance: the 15-year rule, the inspection option for older roofs, and how wind mitigation fits in.',
    updated: '2026-09-25',
    image: '/images/roof-finished-aerial.webp',
    imageAlt: 'Completed shingle roof replacement seen from above',
    answer:
      'A Florida insurer may not refuse to issue or renew a homeowners policy solely because of roof age if the roof is less than 15 years old. For a roof 15 years or older, the insurer must let you get an inspection, and it may not refuse coverage solely because of age if an authorized inspector finds at least 5 years of useful life remaining (Florida Statute 627.7011(5)).',
    sections: [
      {
        h: 'Roofs under 15 years old',
        p: [
          'Florida Statute 627.7011(5)(b) says an insurer may not refuse to issue or refuse to renew a homeowner’s policy insuring a residential structure with a roof less than 15 years old solely because of the age of the roof. The insurer can still act on the roof’s actual condition — age alone is not the reason.',
        ],
      },
      {
        h: 'Roofs 15 years and older',
        p: [
          'Under 627.7011(5)(c), before requiring a replacement the insurer must allow you to have the roof inspected by an authorized inspector. If that inspection shows 5 or more years of useful life remaining, the insurer may not refuse to issue or renew solely because of roof age.',
          'That makes an honest roof inspection worth having before you shop for coverage or respond to a non-renewal notice.',
        ],
      },
      {
        h: 'Where wind mitigation fits',
        p: [
          'Separately, Florida requires insurers to offer premium discounts for qualifying wind-mitigation features — roof-to-wall connections, roof deck attachment, secondary water resistance, roof shape and opening protection such as impact windows. These are documented on the state’s wind mitigation inspection form (OIR-B1-1802), which the Office of Insurance Regulation says can be used for up to five years.',
        ],
      },
      {
        h: 'Practical next steps',
        p: [],
        list: [
          'Find your roof’s permit date — it is the most reliable evidence of age.',
          'If your roof is 15+ years old, get an inspection before assuming it must be replaced.',
          'Ask whether a wind mitigation inspection is current for your home.',
          'If replacement is needed, ask for the new roof’s mitigation features to be documented at completion.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can my insurer cancel because my roof is 12 years old?',
        a: 'Not solely because of its age. Florida Statute 627.7011(5)(b) protects roofs under 15 years old from refusal or non-renewal based on age alone. Condition can still matter.',
      },
      {
        q: 'Who can do the inspection for a roof 15 years or older?',
        a: 'The statute refers to authorized inspectors. Ask your insurer which inspection reports it accepts before you book one.',
      },
    ],
    services: ['roofing', 'impact-windows-doors'],
    sources: [
      { label: 'Florida Statute 627.7011 — Homeowners’ policies; roof age', href: 'https://www.flsenate.gov/laws/statutes/2025/627.7011' },
      { label: 'Florida Office of Insurance Regulation — Wind mitigation resources', href: 'https://floir.gov/consumers/wind-mitigation-resources' },
    ],
  },

  {
    slug: 'unpermitted-work-after-the-fact-permits',
    title: 'Unpermitted Work & After-the-Fact Permits in Southwest Florida',
    metaTitle: 'Unpermitted Work & After-the-Fact Permits in SW Florida',
    description:
      'Found a lanai, addition or remodel with no permit? How after-the-fact permits work in Sarasota, Charlotte and Lee counties, what to expect, and how to avoid delays in a sale.',
    updated: '2026-09-25',
    image: '/gallery/lanai/full/lanai-structure.webp',
    imageAlt: 'Screened lanai enclosure frame — a common after-the-fact permit item',
    answer:
      'Unpermitted work can usually be legalized with an after-the-fact permit: a licensed contractor files the permit for the completed work, the building department reviews it and inspects, and any required corrections are made before the permit is closed. The earlier it is started — especially before listing a home — the more options the owner has.',
    sections: [
      {
        h: 'Why it comes up',
        p: [
          'Unpermitted work usually surfaces at a bad moment: a buyer’s inspection, a lender or insurer asking for permits, or a code-enforcement notice. Common examples are screened lanais and pool cages, enclosed porches, sheds, fences, garage conversions and bathroom or kitchen remodels where plumbing or electrical changed.',
        ],
      },
      {
        h: 'Step one: find out who has jurisdiction',
        p: [
          'Permits are issued by the city building department inside city limits and by the county in unincorporated areas. The mailing address is not proof — a Venice address can be in unincorporated Sarasota County, and Englewood spans Sarasota and Charlotte counties. The permit search for the right jurisdiction also shows whether any old permits are open or expired.',
        ],
      },
      {
        h: 'How an after-the-fact permit works',
        p: ['Every building department runs its own process, but the stages are consistent:'],
        list: [
          'Review — permit history and a look at what was actually built',
          'Assess — an on-site inspection, plus an engineering letter or drawings where the structure requires it',
          'File — a licensed contractor submits the permit for the existing work',
          'Correct — anything that does not meet code is fixed',
          'Close out — inspections through final, and paperwork you can hand a buyer or insurer',
        ],
      },
      {
        h: 'What it can involve',
        p: [
          'Inspectors may need to see what is inside a wall or under a slab, so small openings are common. Structures like lanais, enclosures and additions often need an engineer’s review for wind load. Fees and timelines depend on the jurisdiction and the work — your contractor should explain both before you commit.',
        ],
      },
      {
        h: 'Why a general contractor, not only a permit service',
        p: [
          'Permit expediters can research and file paperwork, but they cannot build. If the inspection calls for corrections, a licensed contractor has to do them. Using a Certified General Contractor for both keeps one party responsible from the first records search to the final inspection.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I sell a house with unpermitted work?',
        a: 'Often, but buyers, lenders and insurers can require it to be resolved or disclosed, which can delay or change the deal. Resolving it before listing avoids negotiating under a deadline.',
      },
      {
        q: 'Will the county make me tear it out?',
        a: 'Not usually, if the work can be shown to meet code or be corrected to meet it. Removal is typically the outcome only when the work cannot be brought into compliance.',
      },
    ],
    services: ['permitting-help', 'pools-lanais'],
    sources: [
      { label: 'Sarasota County Building Division', href: 'https://www.scgov.net/government/planning-and-development-services/building' },
      { label: 'Charlotte County permit requirements', href: 'https://www.charlottecountyfl.gov/departments/community-development/building-construction/permits/permit-requirements.stml' },
    ],
  },

  {
    slug: 'roof-leak-ceiling-damage',
    title: 'Roof Leak and Ceiling Damage: What to Do First',
    metaTitle: 'Roof Leak Damaged Your Ceiling? What to Do First',
    description:
      'A practical order of operations after a roof leak in Florida: stop the water, document it, dry it out, then repair the roof and ceiling in the right sequence.',
    updated: '2026-09-25',
    image: '/images/interior-repair-progress.webp',
    imageAlt: 'Ceiling, drywall and flooring repair in progress after water damage',
    answer:
      'Stop the water before anything else: protect the room, then get the roof tarped or dried in. Photograph everything, dry the wet materials quickly, and only then replace the ceiling — a new ceiling under an unrepaired roof will be damaged again. One contractor licensed for both roofing and general contracting can handle the whole sequence.',
    sections: [
      {
        h: '1. Protect the room',
        p: [],
        list: [
          'Move furniture and electronics away from the drip and put down containers.',
          'If a ceiling is bulging with water, keep people out from under it.',
          'If water is near light fixtures or outlets, turn off that circuit at the panel.',
        ],
      },
      {
        h: '2. Stop the water at the roof',
        p: [
          'A temporary tarp or dry-in keeps rain out until the permanent repair. Don’t climb onto a wet or storm-damaged roof yourself — this is the first thing a roofer should do on an emergency call.',
        ],
      },
      {
        h: '3. Document before anything is removed',
        p: [
          'Photograph and video the ceiling, walls, floor and the roof damage, with dates. Keep receipts for tarping and emergency work. If you plan to file an insurance claim, this record is what your insurer and adjuster will ask for.',
        ],
      },
      {
        h: '4. Dry it out',
        p: [
          'Wet insulation and drywall hold water against the framing. Removing soaked material and drying the space quickly limits the damage. If significant mold is found, Florida licenses mold remediation separately — it should be handled before the rebuild.',
        ],
      },
      {
        h: '5. Repair in the right order',
        p: ['Roof first, then the inside:'],
        list: [
          'Permanent roof repair or replacement, permitted where required',
          'Replace wet insulation and damaged drywall',
          'Tape, texture and paint the ceiling to match',
          'Repair flooring, trim or cabinets that were affected',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I just paint over a ceiling stain?',
        a: 'Not until the leak is fixed and the ceiling is confirmed dry. Paint hides the stain but not the wet drywall and insulation above it.',
      },
      {
        q: 'Do I need two contractors — a roofer and a remodeler?',
        a: 'Not with a company that holds both a roofing license and a general contractor license. One contractor can repair the roof and the interior on a single schedule.',
      },
    ],
    services: ['roofing', 'interior-repair'],
    sources: [],
  },
]

export const getGuide = (slug: string) => GUIDES.find(g => g.slug === slug)
