import { Inbox } from 'lucide-react'
import Link from 'next/link'

export function EmptyState({
  title,
  message,
  actionLabel,
  actionHref,
  secondaryLabel,
  secondaryHref,
  icon,
}: {
  title: string
  message: string
  actionLabel?: string
  actionHref?: string
  /** A second, quieter way out. Both halves must be supplied for it to render. */
  secondaryLabel?: string
  secondaryHref?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="ops-empty">
      {icon ?? <Inbox aria-hidden="true" />}
      <strong>{title}</strong>
      <p>{message}</p>
      {(actionLabel || secondaryLabel) && (
        <div className="ops-empty-actions">
          {actionLabel && actionHref && (
            <Link className="ops-btn ops-btn-primary" href={actionHref}>{actionLabel}</Link>
          )}
          {secondaryLabel && secondaryHref && (
            <Link className="ops-btn" href={secondaryHref}>{secondaryLabel}</Link>
          )}
        </div>
      )}
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" style={{ padding: '8px 0 14px' }}>
      <span className="ops-hint" style={{ padding: '0 14px' }}>Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="ops-skeleton ops-skeleton-row" />
      ))}
    </div>
  )
}

export function ErrorState({ message, retryHref }: { message: string; retryHref?: string }) {
  return (
    <div className="ops-empty">
      <strong>Something went wrong</strong>
      <p>{message}</p>
      {retryHref && <Link className="ops-btn" href={retryHref}>Try again</Link>}
    </div>
  )
}
