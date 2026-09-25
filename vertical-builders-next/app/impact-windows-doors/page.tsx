import type { Metadata } from 'next'
import { pageMeta } from '@/lib/seo'
import { getService } from '@/lib/services'
import ServicePageTemplate from '@/components/ServicePageTemplate'

const service = getService('impact-windows-doors')!

export const metadata: Metadata = pageMeta({
  title: service.metaTitle,
  description: service.metaDescription,
  path: '/impact-windows-doors',
  image: service.heroImg,
  imageAlt: service.heroAlt,
})

export default function Page() {
  return <ServicePageTemplate service={service} />
}
