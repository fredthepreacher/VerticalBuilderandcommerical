'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, FileText, FileUp, HardHat, ListPlus, Plus, Receipt, Upload, UserPlus, Users, Wrench,
} from 'lucide-react'

const ITEMS = [
  { href: '/ops/leads/new', label: 'New lead', Icon: Users },
  { href: '/ops/leads/import', label: 'Import leads (CSV)', Icon: Upload },
  { href: '/ops/contacts/new', label: 'New client', Icon: UserPlus },
  { href: '/ops/estimates/new', label: 'New estimate', Icon: FileText },
  { href: '/ops/projects/new', label: 'New job', Icon: Wrench },
  { href: '/ops/invoices/new', label: 'New invoice', Icon: Receipt },
  { href: '/ops/subcontractors/new', label: 'New subcontractor', Icon: HardHat },
  { href: '/ops/compliance/upload', label: 'Upload COI', Icon: FileUp },
  { href: '/ops/tasks?new=1', label: 'New task', Icon: ListPlus },
]

export default function QuickAdd() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ops-btn ops-btn-primary ops-btn-sm"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus aria-hidden="true" />
        <span className="ops-quickadd-label">Quick Add</span>
        <ChevronDown aria-hidden="true" style={{ width: 13, height: 13 }} />
      </button>

      {open && (
        <div
          role="menu"
          className="ops-search-results"
          style={{ left: 'auto', right: 0, width: 250, top: 'calc(100% + 6px)' }}
        >
          {ITEMS.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              className="ops-search-hit"
              style={{ display: 'flex', alignItems: 'center', gap: 9 }}
              onClick={() => setOpen(false)}
            >
              <Icon aria-hidden="true" style={{ width: 15, height: 15, color: 'var(--ops-muted)' }} />
              <strong style={{ fontWeight: 550 }}>{label}</strong>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
