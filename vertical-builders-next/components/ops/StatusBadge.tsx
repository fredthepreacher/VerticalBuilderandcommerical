import {
  COMPLIANCE_LABELS,
  LEAD_STAGE_LABELS,
  PROJECT_STATUS_LABELS,
  type ComplianceStatus,
  type LeadStage,
  type ProjectStatus,
} from '@/lib/ops/types'

/**
 * Status is never carried by colour alone: every badge renders a dot, a word,
 * and (for compliance) a distinct shape, so it reads correctly in greyscale and
 * for colour-blind users.
 */

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral'

export const COMPLIANCE_TONE: Record<ComplianceStatus, Tone> = {
  compliant: 'ok',
  expiring_soon: 'warn',
  needs_review: 'info',
  missing: 'bad',
  non_compliant: 'bad',
  waived: 'neutral',
}

export function Badge({
  tone = 'neutral',
  children,
  square = false,
  title,
}: {
  tone?: Tone
  children: React.ReactNode
  square?: boolean
  title?: string
}) {
  return (
    <span className={`ops-badge ${tone}${square ? ' ops-badge-sq' : ''}`} title={title}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function ComplianceBadge({ status, title }: { status: ComplianceStatus; title?: string }) {
  return (
    <Badge tone={COMPLIANCE_TONE[status]} title={title}>
      {COMPLIANCE_LABELS[status]}
    </Badge>
  )
}

const LEAD_TONE: Partial<Record<LeadStage, Tone>> = {
  new: 'info',
  needs_contact_info: 'warn',
  door_knocked: 'info',
  won: 'ok',
  lost: 'neutral',
  do_not_contact: 'neutral',
  follow_up: 'warn',
}

export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  return <Badge tone={LEAD_TONE[stage] ?? 'neutral'}>{LEAD_STAGE_LABELS[stage] ?? stage}</Badge>
}

const PROJECT_TONE: Partial<Record<ProjectStatus, Tone>> = {
  in_progress: 'info',
  complete: 'ok',
  on_hold: 'warn',
  cancelled: 'neutral',
  scheduled: 'info',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_TONE[status] ?? 'neutral'}>{PROJECT_STATUS_LABELS[status] ?? status}</Badge>
}

/** Expiration pill: "in 12 days" / "expired 4 days ago" / a plain date. */
export function ExpirationBadge({
  date,
  days,
  warningDays = 30,
}: {
  date: string | null
  days: number | null
  warningDays?: number
}) {
  if (!date) return <Badge tone="bad">No date on file</Badge>
  if (days === null) return <Badge tone="neutral">{date}</Badge>
  if (days < 0) {
    return <Badge tone="bad" title={date}>Expired {Math.abs(days)}d ago</Badge>
  }
  if (days <= warningDays) {
    return <Badge tone="warn" title={date}>Expires in {days}d</Badge>
  }
  return <Badge tone="ok" title={date}>Current · {date}</Badge>
}
