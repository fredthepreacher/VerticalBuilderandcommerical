'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, AlertTriangle, Building2, CalendarRange, ClipboardCheck, FileArchive,
  FileText, FolderOpen, Gauge, HardHat, Menu, Plus, Receipt, Settings, ShieldCheck,
  Users, Wrench, X,
} from 'lucide-react'
import GlobalSearch from './GlobalSearch'
import UserMenu from './UserMenu'
import QuickAdd from './QuickAdd'
import AssistantDrawer from './AssistantDrawer'
import type { UserRole } from '@/lib/ops/types'

export interface ShellUser {
  name: string
  email: string
  role: UserRole
  initials: string
}

/**
 * The assistant is always rendered. `aiConfigured`/`aiEnabled` decide which
 * MODE it runs in — Smart Ops (built-in, deterministic) or AI Enhanced — not
 * whether it appears at all.
 */
export interface ShellAssistant {
  aiConfigured: boolean
  aiEnabled: boolean
  canSeeFinancials: boolean
  canWrite: boolean
}

export interface ShellCounts {
  expiring: number
  needsReview: number
  openLeads: number
  openEstimates: number
  unpaidInvoices: number
}

const NAV = [
  { group: 'Overview', items: [
    { href: '/ops/dashboard', label: 'Dashboard', Icon: Gauge },
  ]},
  { group: 'Sales', items: [
    { href: '/ops/leads', label: 'Leads', Icon: Users, badge: 'openLeads' as const },
    { href: '/ops/contacts', label: 'Clients', Icon: Building2 },
    { href: '/ops/estimates', label: 'Estimates', Icon: FileText, badge: 'openEstimates' as const },
  ]},
  { group: 'Operations', items: [
    { href: '/ops/projects', label: 'Jobs', Icon: Wrench },
    { href: '/ops/schedule', label: 'Schedule', Icon: CalendarRange },
  ]},
  { group: 'Compliance', items: [
    { href: '/ops/subcontractors', label: 'Subcontractors', Icon: HardHat },
    { href: '/ops/compliance', label: 'Compliance', Icon: ShieldCheck, badge: 'expiring' as const },
    { href: '/ops/documents', label: 'Documents', Icon: FolderOpen },
    { href: '/ops/audits', label: 'Audit Center', Icon: FileArchive },
  ]},
  { group: 'Money', items: [
    { href: '/ops/invoices', label: 'Invoices', Icon: Receipt, badge: 'unpaidInvoices' as const },
  ]},
  { group: 'Workspace', items: [
    { href: '/ops/tasks', label: 'Tasks', Icon: ClipboardCheck },
    { href: '/ops/activity', label: 'Activity', Icon: Activity },
    { href: '/ops/settings', label: 'Settings', Icon: Settings },
  ]},
]

export default function Shell({
  user,
  counts,
  ai,
  children,
}: {
  user: ShellUser
  counts: ShellCounts
  ai?: ShellAssistant
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false) }, [pathname])

  // Escape closes the drawer — keyboard users should never get trapped.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className={`ops-shell${open ? ' is-open' : ''}`}>
      <aside className="ops-sidebar" id="ops-sidebar">
        <div className="ops-brand">
          <span className="ops-brand-mark" aria-hidden="true">V</span>
          <span className="ops-brand-text">
            <strong>Vertical Ops</strong>
            <span>CRM + Compliance</span>
          </span>
          <button
            type="button"
            className="ops-btn ops-btn-ghost ops-btn-sm ops-sidebar-close"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            style={{ marginLeft: 'auto', color: '#fff' }}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="ops-nav" aria-label="Vertical Ops sections">
          {NAV.map(section => (
            <div key={section.group}>
              <div className="ops-nav-group">{section.group}</div>
              <ul>
                {section.items.map(({ href, label, Icon, ...rest }) => {
                  const badgeKey = 'badge' in rest ? (rest.badge as keyof ShellCounts) : null
                  const count = badgeKey ? counts[badgeKey] : 0
                  return (
                    <li key={href}>
                      <Link href={href} aria-current={isActive(href) ? 'page' : undefined}>
                        <Icon aria-hidden="true" />
                        {label}
                        {count > 0 && (
                          <span className={`ops-nav-count${badgeKey === 'openLeads' || badgeKey === 'openEstimates' ? ' is-quiet' : ''}`}>
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ops-sidebar-foot">
          Vertical Builders &amp; Commercial<br />
          CGC1528626 · CCC1333649
        </div>
      </aside>

      {open && (
        <button
          type="button"
          className="ops-scrim"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="ops-main">
        <header className="ops-topbar">
          <button
            type="button"
            className="ops-btn ops-btn-ghost ops-btn-sm ops-mobile-only"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="ops-sidebar"
          >
            <Menu aria-hidden="true" />
          </button>

          <GlobalSearch />
          <div className="ops-topbar-spacer" />

          <Link
            href="/ops/compliance?status=expiring_soon"
            className="ops-btn ops-btn-sm"
            title={`${counts.expiring} coverage line${counts.expiring === 1 ? '' : 's'} expiring or expired`}
            style={counts.expiring > 0 ? { borderColor: '#efd9b3', background: '#fdf1de', color: '#9a5b00' } : undefined}
          >
            <AlertTriangle aria-hidden="true" />
            <span>{counts.expiring}</span>
            <span className="sr-only-inline"> expiring</span>
          </Link>

          {ai && (
            <AssistantDrawer
              aiConfigured={ai.aiConfigured}
              aiEnabled={ai.aiEnabled}
              canSeeFinancials={ai.canSeeFinancials}
              canWrite={ai.canWrite}
            />
          )}
          <QuickAdd />
          <UserMenu user={user} />
        </header>

        <div className="ops-page ops-page-wide">{children}</div>
      </div>
    </div>
  )
}

export function QuickAddButton() {
  return (
    <span className="ops-btn ops-btn-primary ops-btn-sm">
      <Plus aria-hidden="true" /> Quick Add
    </span>
  )
}
