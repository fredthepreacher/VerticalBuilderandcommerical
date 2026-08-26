'use client'

import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/ops/supabase/client'
import type { ShellUser } from './Shell'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Owner / Admin',
  office: 'Office / Compliance',
  project_manager: 'Project Manager',
  read_only: 'Read-only / Auditor',
}

export default function UserMenu({ user }: { user: ShellUser }) {
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      await createSupabaseBrowserClient().auth.signOut()
    } finally {
      // Full reload so no server-rendered page keeps a stale session in memory.
      window.location.href = '/ops/login'
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div className="ops-user" title={`${user.email} — ${ROLE_LABELS[user.role] ?? user.role}`}>
        <span className="ops-avatar" aria-hidden="true">{user.initials}</span>
        <span className="ops-user-meta">
          <strong>{user.name}</strong>
          <span>{ROLE_LABELS[user.role] ?? user.role}</span>
        </span>
      </div>
      <button
        type="button"
        className="ops-btn ops-btn-ghost ops-btn-sm"
        onClick={signOut}
        disabled={busy}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut aria-hidden="true" />
      </button>
    </div>
  )
}
