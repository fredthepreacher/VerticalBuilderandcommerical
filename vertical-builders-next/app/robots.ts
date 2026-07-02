import type { MetadataRoute } from 'next'
import { BIZ } from '@/lib/data'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/thank-you', '/api/'] },
    sitemap: `${BIZ.siteUrl}/sitemap.xml`,
  }
}
