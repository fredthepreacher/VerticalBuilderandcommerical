import type { MetadataRoute } from 'next'
import { BIZ } from '@/lib/data'

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/roofing', '/interior-repair', '/pools-lanais', '/gallery', '/about', '/contact']
  return routes.map(r => ({
    url: `${BIZ.siteUrl}${r}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: r === '' ? 1 : 0.8,
  }))
}
