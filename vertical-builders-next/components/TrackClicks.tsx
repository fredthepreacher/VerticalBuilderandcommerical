'use client'

import { useEffect } from 'react'

type Gtag = (command: 'event', name: string, params?: Record<string, unknown>) => void

/**
 * Sends GA4 events for the actions that matter to a contractor — phone taps,
 * email taps, estimate CTAs, map/profile clicks — from one delegated listener,
 * so no page has to wire its own. Leaves the existing `qualify_lead` form event
 * untouched; that one still fires only on a confirmed CRM insert.
 *
 * Events: click_to_call, click_email, cta_click (label = data-track or text),
 * outbound_profile (Google / Facebook).
 */
export default function TrackClicks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const gtag = (window as unknown as { gtag?: Gtag }).gtag
      if (typeof gtag !== 'function') return
      const a = (e.target as Element | null)?.closest?.('a')
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      const label = a.getAttribute('data-track') ?? a.textContent?.trim().slice(0, 60) ?? ''
      const page = window.location.pathname
      if (href.startsWith('tel:')) gtag('event', 'click_to_call', { label, page })
      else if (href.startsWith('mailto:')) gtag('event', 'click_email', { label, page })
      else if (/facebook\.com|share\.google|google\.com\/maps|g\.page/.test(href)) gtag('event', 'outbound_profile', { label, page, url: href })
      else if (href.startsWith('/contact') || a.hasAttribute('data-track')) gtag('event', 'cta_click', { label, page, destination: href })
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])
  return null
}
