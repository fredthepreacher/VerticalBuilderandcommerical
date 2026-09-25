import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { BIZ, FAQS, PROJECT_TYPES, REVIEWS } from '../lib/data'
import { SERVICE_TYPES } from '../lib/ops/constants'
import { SERVICES } from '../lib/services'
import { SERVICE_DETAILS } from '../lib/serviceDetails'
import { SERVICE_AREAS, permitNote } from '../lib/serviceAreas'
import { GUIDES } from '../lib/guides'
import { LEGACY_REDIRECTS } from '../lib/redirects.mjs'
import { pageMeta } from '../lib/seo'
import sitemap, { MARKETING_PATHS } from '../app/sitemap'

/**
 * Rules for the public marketing site. These encode decisions, not markup:
 * leads must reach the CRM with a usable service, old URLs must land on real
 * pages, and nothing on the site may claim what the business can't back up.
 */

const root = path.resolve(__dirname, '..')
const routeExists = (p: string) => {
  const clean = p.split('#')[0].split('?')[0]
  if (clean === '/') return true
  if (MARKETING_PATHS.includes(clean)) return true
  return fs.existsSync(path.join(root, 'app', clean, 'page.tsx'))
}

describe('lead intake', () => {
  it('every website project type is a CRM service type', () => {
    const crm = new Set<string>(SERVICE_TYPES)
    for (const t of PROJECT_TYPES) expect(crm.has(t), t).toBe(true)
  })

  it('every service page preselects a real project type on the form', () => {
    for (const s of SERVICES) {
      const d = SERVICE_DETAILS[s.slug]
      expect(d, s.slug).toBeTruthy()
      expect((PROJECT_TYPES as readonly string[]).includes(d.formValue), `${s.slug} → ${d.formValue}`).toBe(true)
    }
  })
})

describe('legacy redirects', () => {
  it('send every old WordPress URL to a page that exists', () => {
    for (const r of LEGACY_REDIRECTS) expect(routeExists(r.destination), `${r.source} → ${r.destination}`).toBe(true)
  })

  it('never redirect a live marketing route away', () => {
    for (const r of LEGACY_REDIRECTS) expect(MARKETING_PATHS.includes(r.source), r.source).toBe(false)
  })
})

describe('sitemap', () => {
  it('lists each marketing path once, every one backed by a page', () => {
    expect(new Set(MARKETING_PATHS).size).toBe(MARKETING_PATHS.length)
    for (const p of MARKETING_PATHS) expect(routeExists(p || '/'), p).toBe(true)
  })

  it('never exposes the CRM, the vendor portal or the thank-you page', () => {
    const urls = sitemap().map(e => e.url)
    for (const u of urls) expect(u).not.toMatch(/\/(ops|upload|api|thank-you)(\/|$)/)
  })

  it('does not stamp every URL with the build time', () => {
    const dates = new Set(sitemap().map(e => String(e.lastModified)))
    expect(dates.size).toBeLessThan(sitemap().length)
    for (const e of sitemap()) expect(new Date(e.lastModified as Date).getTime()).toBeLessThanOrEqual(Date.now())
  })
})

describe('page metadata', () => {
  it('gives each page its own canonical and og:url instead of the homepage', () => {
    const m = pageMeta({ title: 'Roofing', description: 'x', path: '/roofing' })
    expect(m.alternates?.canonical).toBe('/roofing')
    expect((m.openGraph as { url?: string }).url).toBe('/roofing')
  })

  it('service meta titles and descriptions are unique', () => {
    const titles = SERVICES.map(s => s.metaTitle)
    const descs = SERVICES.map(s => s.metaDescription)
    expect(new Set(titles).size).toBe(titles.length)
    expect(new Set(descs).size).toBe(descs.length)
  })

  it('the root layout does not pin og:url to the homepage', () => {
    const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8')
    const og = layout.slice(layout.indexOf('openGraph: {'), layout.indexOf('}', layout.indexOf('openGraph: {')))
    expect(og).not.toMatch(/\burl:/)
  })
})

describe('no unverifiable claims', () => {
  const marketingSource = () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name)
        if (f.isDirectory()) { if (!['ops', 'api', 'upload'].includes(f.name)) walk(p) }
        else if (/\.(tsx?|mjs)$/.test(f.name)) files.push(p)
      }
    }
    walk(path.join(root, 'app'))
    for (const f of fs.readdirSync(path.join(root, 'components'))) {
      const p = path.join(root, 'components', f)
      if (fs.statSync(p).isFile()) files.push(p)
    }
    for (const f of ['data.ts', 'services.ts', 'serviceDetails.ts', 'serviceAreas.ts', 'guides.ts']) files.push(path.join(root, 'lib', f))
    // Comments are stripped: they may name the very things we forbid, to explain why.
    return files
      .map(f => fs.readFileSync(f, 'utf8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  it('emits no self-served review or rating schema', () => {
    const src = marketingSource()
    expect(src).not.toMatch(/AggregateRating/)
    expect(src).not.toMatch(/'@type':\s*'Review'/)
  })

  it('shows the Google rating only with the date it was read', () => {
    expect(BIZ.ratingAsOf).toMatch(/\d{4}/)
    const reviews = fs.readFileSync(path.join(root, 'components/ReviewsSection.tsx'), 'utf8')
    expect(reviews).toContain('ratingAsOf')
  })

  it('makes no warranty, years-in-business or project-count claims the owner has not confirmed', () => {
    const src = marketingSource()
    expect(src).not.toMatch(/\b\d+[- ]year (workmanship )?warranty/i)
    expect(src).not.toMatch(/\b(in business since|serving [\w ]+ since|established in|founded in) (19|20)\d\d\b/i)
    expect(src).not.toMatch(/\b\d+\+? years (of experience|in business)\b/i)
    expect(src).not.toMatch(/\b\d{2,}\+? (projects|roofs|homes) (completed|built|installed)/i)
    expect(src).not.toMatch(/GAF|Owens Corning|Master Elite|Golden Pledge/)
  })

  it('reviews are the real excerpts, unchanged in number', () => {
    expect(REVIEWS.length).toBe(5)
  })
})

describe('answers and local pages', () => {
  it('every service has a direct answer and at least three FAQs', () => {
    for (const s of SERVICES) {
      const d = SERVICE_DETAILS[s.slug]
      expect(d.answer.length, s.slug).toBeGreaterThan(120)
      expect(d.faqs.length, s.slug).toBeGreaterThanOrEqual(3)
      for (const r of d.related) expect(SERVICES.some(x => x.slug === r), `${s.slug} → ${r}`).toBe(true)
      for (const g of d.guides) expect(GUIDES.some(x => x.slug === g), `${s.slug} → ${g}`).toBe(true)
    }
  })

  it('every city page says who issues permits there', () => {
    for (const a of SERVICE_AREAS) {
      const note = permitNote(a)
      expect(note.length, a.slug).toBeGreaterThan(40)
      expect(note, a.slug).not.toMatch(/We confirm whether your/) // i.e. has a real jurisdiction entry
    }
  })

  it('nearby-area links point at real city pages', () => {
    const slugs = new Set(SERVICE_AREAS.map(a => a.slug))
    for (const a of SERVICE_AREAS) for (const n of a.nearby) expect(slugs.has(n), `${a.slug} → ${n}`).toBe(true)
  })

  it('guides are dated, answered first, and cite sources for legal claims', () => {
    for (const g of GUIDES) {
      expect(g.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(g.answer.length).toBeGreaterThan(120)
      if (/Statute|Code|law/i.test(g.answer)) expect(g.sources.length, g.slug).toBeGreaterThan(0)
    }
  })

  it('home FAQ explains what happens after a request', () => {
    expect(FAQS.some(f => /after I request/i.test(f.q))).toBe(true)
  })
})
