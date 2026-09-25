'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { BIZ } from '@/lib/data'
import { SERVICES } from '@/lib/services'

const LINKS = [
  ['/permitting-help', 'Permit Help'],
  ['/gallery', 'Our Work'],
  ['/service-areas', 'Service Areas'],
  ['/guides', 'Guides'],
  ['/about', 'About'],
] as const

export default function Header() {
  const [open, setOpen] = useState(false)
  const [svcOpen, setSvcOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  const svcRef = useRef<HTMLLIElement>(null)

  // Close menus on navigation.
  useEffect(() => { setOpen(false); setSvcOpen(false) }, [pathname])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setSvcOpen(false) }
    }
    const onClick = (e: MouseEvent) => {
      if (svcRef.current && !svcRef.current.contains(e.target as Node)) setSvcOpen(false)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick) }
  }, [])

  const servicesActive = SERVICES.some(s => pathname === `/${s.slug}`) || pathname === '/services'

  return (
    <header className={`site${scrolled ? ' is-scrolled' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="container nav">
        <Link href="/" className="nav-logo" aria-label="Vertical Builders and Commercial — home">
          <Image src="/brand/logo-full.png" alt="Vertical Builders and Commercial" width={205} height={59} priority />
        </Link>
        <button
          className={`nav-toggle${open ? ' active' : ''}`}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen(o => !o)}
        >
          <span /><span /><span />
        </button>
        <nav aria-label="Main">
          <ul id="site-nav" className={`nav-links${open ? ' open' : ''}`}>
            <li className="nav-svc" ref={svcRef}>
              <button
                type="button"
                className={`nav-svc-btn${servicesActive ? ' active' : ''}`}
                aria-expanded={svcOpen}
                aria-controls="nav-svc-menu"
                onClick={() => setSvcOpen(o => !o)}
              >
                Services <span aria-hidden="true" className="caret" />
              </button>
              <ul id="nav-svc-menu" className={`nav-svc-menu${svcOpen ? ' open' : ''}`}>
                {SERVICES.map(s => (
                  <li key={s.slug}>
                    <Link href={`/${s.slug}`} aria-current={pathname === `/${s.slug}` ? 'page' : undefined}>{s.title}</Link>
                  </li>
                ))}
                <li><Link href="/general-contracting-services">Fences, Epoxy, Pavers &amp; Engineering</Link></li>
                <li className="nav-svc-all"><Link href="/services">All services →</Link></li>
              </ul>
            </li>
            {LINKS.map(([href, label]) => (
              <li key={href}>
                <Link
                  href={href}
                  className={pathname === href || pathname.startsWith(`${href}/`) ? 'active' : ''}
                  aria-current={pathname === href ? 'page' : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
            <li className="nav-phone"><a href={BIZ.phoneHref} data-track="call_header">{BIZ.phone}</a></li>
            <li><Link className="nav-cta" href="/contact" data-track="cta_header">Free Estimate</Link></li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
