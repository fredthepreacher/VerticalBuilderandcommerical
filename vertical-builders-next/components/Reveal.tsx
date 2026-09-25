'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Adds `is-in` to `[data-reveal]` elements as they scroll into view. Content is
 * fully visible without JavaScript and for reduced-motion users — the hidden
 * start state only applies once `html.js-reveal` is set here.
 */
export default function Reveal() {
  const pathname = usePathname()
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return
    const root = document.documentElement
    root.classList.add('js-reveal')
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'))
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target) }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    )
    els.forEach(el => {
      // Anything already on screen shows immediately — no flash on load.
      const r = el.getBoundingClientRect()
      if (r.top < window.innerHeight) el.classList.add('is-in')
      else io.observe(el)
    })
    return () => io.disconnect()
  }, [pathname])
  return null
}
