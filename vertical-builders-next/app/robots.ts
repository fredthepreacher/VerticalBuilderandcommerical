import type { MetadataRoute } from 'next'
import { BIZ } from '@/lib/data'

export default function robots(): MetadataRoute.Robots {
  return {
    // /ops is the internal CRM and /upload is the tokenised vendor portal —
    // neither should ever be crawled or indexed.
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/thank-you', '/api/', '/ops', '/ops/', '/upload/'],
    },
    sitemap: `${BIZ.siteUrl}/sitemap.xml`,
  }
}
