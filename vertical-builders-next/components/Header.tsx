'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { BIZ } from '@/lib/data'

const LINKS = [
  ['/roofing', 'Roofing'],
  ['/interior-repair', 'Interior Repair'],
  ['/pools-lanais', 'Pools & Lanais'],
  ['/gallery', 'Gallery'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
] as const

export default function Header() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  return (
    <header className="site">
      <div className="container nav">
        <Link href="/" className="nav-logo" onClick={() => setOpen(false)} aria-label="Vertical Builders and Commercial — home">
          <Image src="/brand/logo-full.png" alt="Vertical Builders and Commercial" width={205} height={59} priority />
        </Link>
        <button
          className={`nav-toggle${open ? ' active' : ''}`}
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span /><span /><span />
        </button>
        <ul className={`nav-links${open ? ' open' : ''}`}>
          {LINKS.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className={pathname === href ? 'active' : ''} onClick={() => setOpen(false)}>
                {label}
              </Link>
            </li>
          ))}
          <li><a className="nav-call" href={BIZ.phoneHref}>{BIZ.phone}</a></li>
        </ul>
      </div>
    </header>
  )
}
