import type { Metadata } from 'next'
import { BIZ } from './data'

/**
 * One place that turns a page's intent into complete search/social metadata.
 *
 * Why this exists: the root layout used to define `openGraph.url` as the
 * homepage, and Next.js hands a child page the parent's whole `openGraph`
 * object unless the child defines its own. Every inner page was therefore
 * telling Facebook/LinkedIn/iMessage (and AI crawlers that read OG) that it
 * *was* the homepage, with the homepage title. Canonicals were also only set on
 * the city pages. Every indexable marketing page now goes through here.
 */
export interface PageMetaInput {
  /** Page title without the brand suffix — the layout template appends it. */
  title: string
  description: string
  /** Path beginning with '/', no trailing slash ('' or '/' for home). */
  path: string
  /** Absolute path under /public. Defaults to the hero roofing photo. */
  image?: string
  imageAlt?: string
  /** Use for article pages. */
  type?: 'website' | 'article'
  /** Title that ignores the layout template (homepage). */
  absoluteTitle?: boolean
}

export const DEFAULT_OG_IMAGE = '/images/hero-roofing.webp'

export function pageMeta({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  imageAlt,
  type = 'website',
  absoluteTitle = false,
}: PageMetaInput): Metadata {
  const canonical = path === '/' ? '/' : path.replace(/\/$/, '') || '/'
  const ogTitle = absoluteTitle ? title : `${title} | ${BIZ.name}`
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical },
    openGraph: {
      type,
      siteName: BIZ.name,
      locale: 'en_US',
      url: canonical,
      title: ogTitle,
      description,
      images: [{ url: image, alt: imageAlt ?? ogTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: [image],
    },
  }
}

/** Stable @id for the business entity so every page's JSON-LD points at one node. */
export const BUSINESS_ID = `${BIZ.siteUrl}/#business`
export const WEBSITE_ID = `${BIZ.siteUrl}/#website`
export const absUrl = (path: string) => `${BIZ.siteUrl}${path === '/' ? '' : path}`
