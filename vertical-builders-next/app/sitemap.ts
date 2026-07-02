import type { MetadataRoute } from 'next'
import { BIZ } from '@/lib/data'
import { SERVICE_AREAS } from '@/lib/serviceAreas'

export default function sitemap(): MetadataRoute.Sitemap {
  const core = ['', '/roofing', '/interior-repair', '/pools-lanais', '/new-construction', '/kitchen-bath-remodels', '/impact-windows-doors', '/permitting-help', '/gallery', '/about', '/contact', '/service-areas']
  const areas = SERVICE_AREAS.map(a => `/service-areas/${a.slug}`)
  return [...core, ...areas].map(r => ({
    url: `${BIZ.siteUrl}${r}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: r === '' ? 1 : r.startsWith('/service-areas/') ? 0.7 : 0.8,
  }))
}
