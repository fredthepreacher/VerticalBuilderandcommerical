import type { MetadataRoute } from 'next'
import { BIZ } from '@/lib/data'
import { SERVICE_AREAS } from '@/lib/serviceAreas'
import { SERVICES } from '@/lib/services'
import { GUIDES } from '@/lib/guides'

// A fixed content date instead of `new Date()`: stamping every URL with the
// build time tells crawlers everything changed on every deploy, which teaches
// them to ignore lastmod. Bump this when marketing content actually changes.
const CONTENT_UPDATED = new Date('2026-09-25')

export const MARKETING_PATHS = [
  '',
  '/services',
  ...SERVICES.map(s => `/${s.slug}`),
  '/general-contracting-services',
  '/gallery',
  '/about',
  '/contact',
  '/service-areas',
  ...SERVICE_AREAS.map(a => `/service-areas/${a.slug}`),
  '/guides',
  ...GUIDES.map(g => `/guides/${g.slug}`),
  '/privacy',
  '/terms',
]

function priority(r: string) {
  if (r === '') return 1
  if (r === '/contact' || SERVICES.some(s => `/${s.slug}` === r)) return 0.9
  if (r === '/privacy' || r === '/terms') return 0.2
  if (r.startsWith('/service-areas/') || r.startsWith('/guides/')) return 0.7
  return 0.8
}

export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PATHS.map(r => {
    const guide = GUIDES.find(g => `/guides/${g.slug}` === r)
    return {
      url: `${BIZ.siteUrl}${r}`,
      lastModified: guide ? new Date(guide.updated) : CONTENT_UPDATED,
      changeFrequency: 'monthly' as const,
      priority: priority(r),
    }
  })
}
