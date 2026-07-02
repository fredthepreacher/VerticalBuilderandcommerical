import { BIZ } from '@/lib/data'

interface Crumb { name: string; path: string }

export default function BreadcrumbJsonLd({ crumbs }: { crumbs: Crumb[] }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: BIZ.siteUrl },
      ...crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 2,
        name: c.name,
        item: `${BIZ.siteUrl}${c.path}`,
      })),
    ],
  }
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
}
