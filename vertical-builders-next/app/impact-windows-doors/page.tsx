import type { Metadata } from 'next'
import { getService } from '@/lib/services'
import ServicePageTemplate from '@/components/ServicePageTemplate'

const service = getService('impact-windows-doors')!

export const metadata: Metadata = {
  title: service.metaTitle,
  description: service.metaDescription,
}

export default function Page() {
  return <ServicePageTemplate service={service} />
}
