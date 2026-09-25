'use client'

import { usePathname } from 'next/navigation'

/**
 * The public marketing site and the internal Vertical Ops CRM live in one
 * Next.js app but must not share chrome: nobody wants a sticky "Free Estimate"
 * bar and an AI sales chat widget on top of a compliance table.
 *
 * Rather than restructuring the app into multiple root layouts (which would
 * mean moving every marketing page and risking the live site), the header,
 * footer, sticky CTA and assistant widget are passed in as slots and simply not
 * rendered on internal routes.
 *
 * `usePathname` resolves during server rendering too, so a statically
 * prerendered marketing page still ships its header in the initial HTML, and an
 * /ops page never ships it at all — no flash, no hydration mismatch.
 */

const INTERNAL_PREFIXES = ['/ops', '/upload']

export default function SiteChrome({
  header,
  footer,
  extras,
  children,
}: {
  header: React.ReactNode
  footer: React.ReactNode
  extras: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const isInternal = INTERNAL_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))

  if (isInternal) return <>{children}</>

  return (
    <div className="mk">
      {header}
      <main id="main" tabIndex={-1}>{children}</main>
      {footer}
      {extras}
    </div>
  )
}
