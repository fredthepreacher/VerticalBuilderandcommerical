import type { Metadata } from 'next'
import '../ops.css'

export const metadata: Metadata = {
  title: 'Sign in — Vertical Ops',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function OpsAuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="ops">{children}</div>
}
