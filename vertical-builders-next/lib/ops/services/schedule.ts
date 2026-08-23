import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACTIVE_PROJECT_STATUSES, type ProjectStatus } from '../types'
import { addDays, daysBetween, toUtcDate } from '../utils/dates'
import { logActivity } from './activity'

/**
 * ============================================================================
 * SCHEDULE
 * ----------------------------------------------------------------------------
 * The Gantt shows jobs, not individual construction tasks. That is deliberate:
 * task-level dependencies are a different product, and a timeline nobody keeps
 * current is worse than no timeline. One bar per job is a thing the office will
 * actually maintain.
 *
 * Dates resolve in this order, so every existing project appears on the
 * timeline with no backfill:
 *
 *   scheduled_start_date  →  start_date  →  created_at
 *   scheduled_end_date    →  estimated_completion_date  →  start + 14 days
 *
 * A bar drawn from a fallback is marked `isEstimated` and rendered differently,
 * so nobody mistakes an assumption for a commitment.
 * ============================================================================
 */

export interface ScheduleBar {
  projectId: string
  projectNumber: string
  projectName: string
  status: ProjectStatus
  customerName: string | null
  serviceCategory: string | null
  projectManagerId: string | null
  projectManagerName: string | null
  start: string
  end: string
  /** True when either date came from a fallback rather than being set. */
  isEstimated: boolean
  scheduleLocked: boolean
  durationDays: number
  isOverdue: boolean
  contractAmountCents: number | null
}

export interface ScheduleFilters {
  projectManagerId?: string | null
  serviceCategory?: string | null
  status?: ProjectStatus | null
  from?: string | null
  to?: string | null
  includeCompleted?: boolean
}

export async function loadSchedule(
  supabase: SupabaseClient,
  filters: ScheduleFilters = {},
): Promise<ScheduleBar[]> {
  let query = supabase
    .from('projects')
    .select(
      'id, project_number, project_name, status, service_category, project_manager_id,' +
      'scheduled_start_date, scheduled_end_date, schedule_locked, start_date,' +
      'estimated_completion_date, actual_completion_date, contract_amount_cents, created_at,' +
      'contacts(first_name, last_name, company_name),' +
      'profiles:project_manager_id(full_name, email)',
    )
    .is('archived_at', null)
    .order('scheduled_start_date', { ascending: true, nullsFirst: false })
    .limit(500)

  if (filters.status) {
    query = query.eq('status', filters.status)
  } else if (!filters.includeCompleted) {
    query = query.not('status', 'in', '("complete","cancelled")')
  }
  if (filters.projectManagerId) query = query.eq('project_manager_id', filters.projectManagerId)
  if (filters.serviceCategory) query = query.eq('service_category', filters.serviceCategory)

  const { data } = await query
  const today = toUtcDate(new Date())!

  const bars: ScheduleBar[] = []

  for (const row of (data ?? []) as unknown as RawProjectRow[]) {
    const resolved = resolveDates(row)
    if (!resolved) continue

    if (filters.from && resolved.end < filters.from) continue
    if (filters.to && resolved.start > filters.to) continue

    const customer = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    const pm = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    const endDate = toUtcDate(resolved.end)!

    bars.push({
      projectId: row.id,
      projectNumber: row.project_number,
      projectName: row.project_name,
      status: row.status,
      customerName: customer
        ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.company_name
        : null,
      serviceCategory: row.service_category,
      projectManagerId: row.project_manager_id,
      projectManagerName: pm?.full_name ?? pm?.email ?? null,
      start: resolved.start,
      end: resolved.end,
      isEstimated: resolved.isEstimated,
      scheduleLocked: row.schedule_locked ?? false,
      durationDays: Math.max(1, daysBetween(toUtcDate(resolved.start)!, endDate) + 1),
      // Past its end date and not finished. The bar that needs a phone call.
      isOverdue:
        endDate.getTime() < today.getTime() &&
        !['complete', 'cancelled'].includes(row.status) &&
        !row.actual_completion_date,
      contractAmountCents: row.contract_amount_cents,
    })
  }

  return bars.sort((a, b) => a.start.localeCompare(b.start) || a.projectNumber.localeCompare(b.projectNumber))
}

interface RawProjectRow {
  id: string
  project_number: string
  project_name: string
  status: ProjectStatus
  service_category: string | null
  project_manager_id: string | null
  scheduled_start_date: string | null
  scheduled_end_date: string | null
  schedule_locked: boolean | null
  start_date: string | null
  estimated_completion_date: string | null
  actual_completion_date: string | null
  contract_amount_cents: number | null
  created_at: string
  contacts: { first_name: string | null; last_name: string | null; company_name: string | null }
    | { first_name: string | null; last_name: string | null; company_name: string | null }[] | null
  profiles: { full_name: string | null; email: string | null }
    | { full_name: string | null; email: string | null }[] | null
}

/** Exported so the fallback chain can be tested without a database. */
export function resolveDates(project: {
  scheduled_start_date?: string | null
  scheduled_end_date?: string | null
  start_date?: string | null
  estimated_completion_date?: string | null
  created_at?: string
}): { start: string; end: string; isEstimated: boolean } | null {
  const explicitStart = project.scheduled_start_date ?? project.start_date ?? null
  const explicitEnd = project.scheduled_end_date ?? project.estimated_completion_date ?? null

  const startSource = explicitStart ?? (project.created_at ? project.created_at.slice(0, 10) : null)
  if (!startSource) return null

  const start = toUtcDate(startSource)
  if (!start) return null

  // Two weeks is a deliberately visible placeholder: long enough to see on a
  // timeline, short enough that a wrong one is obvious and gets corrected.
  const end = explicitEnd ? toUtcDate(explicitEnd) : addDays(start, 14)
  if (!end) return null

  // A backwards range is data entry error; show a one-day bar rather than
  // nothing, so the operator can see and fix it.
  const safeEnd = end.getTime() < start.getTime() ? start : end

  return {
    start: start.toISOString().slice(0, 10),
    end: safeEnd.toISOString().slice(0, 10),
    isEstimated: !project.scheduled_start_date || !project.scheduled_end_date,
  }
}

export async function updateSchedule(
  supabase: SupabaseClient,
  params: {
    projectId: string
    scheduledStartDate: string | null
    scheduledEndDate: string | null
    scheduleNotes?: string | null
    actorUserId: string
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, project_number, schedule_locked, scheduled_start_date, scheduled_end_date')
    .eq('id', params.projectId)
    .maybeSingle()

  if (!project) return { ok: false, error: 'Job not found.' }
  if (project.schedule_locked) {
    return { ok: false, error: 'This job’s schedule is locked. Unlock it on the job page before changing dates.' }
  }

  if (params.scheduledStartDate && params.scheduledEndDate
      && params.scheduledEndDate < params.scheduledStartDate) {
    return { ok: false, error: 'The end date must be on or after the start date.' }
  }

  const { error } = await supabase
    .from('projects')
    .update({
      scheduled_start_date: params.scheduledStartDate,
      scheduled_end_date: params.scheduledEndDate,
      ...(params.scheduleNotes !== undefined ? { schedule_notes: params.scheduleNotes } : {}),
    })
    .eq('id', params.projectId)

  if (error) {
    console.error('[schedule] update failed', error)
    return { ok: false, error: 'The schedule could not be saved.' }
  }

  await logActivity(supabase, {
    action: 'project.schedule_changed',
    entityType: 'project',
    entityId: params.projectId,
    actorUserId: params.actorUserId,
    metadata: {
      project_number: project.project_number,
      from: { start: project.scheduled_start_date, end: project.scheduled_end_date },
      to: { start: params.scheduledStartDate, end: params.scheduledEndDate },
    },
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Timeline geometry — pure, so the Gantt renders identically on server and client
// ---------------------------------------------------------------------------

export type TimelineScale = 'day' | 'week' | 'month'

export interface TimelineWindow {
  start: string
  end: string
  totalDays: number
  scale: TimelineScale
  ticks: { date: string; label: string; isMajor: boolean; offsetPercent: number }[]
  todayOffsetPercent: number | null
}

export function buildTimeline(
  bars: ScheduleBar[],
  scale: TimelineScale,
  today: Date = new Date(),
): TimelineWindow {
  const todayUtc = toUtcDate(today)!

  // Always include today plus a little breathing room, so an empty schedule
  // still renders a sensible axis instead of collapsing to zero width.
  let min = todayUtc
  let max = addDays(todayUtc, scale === 'day' ? 14 : scale === 'week' ? 56 : 120)

  for (const bar of bars) {
    const s = toUtcDate(bar.start)!
    const e = toUtcDate(bar.end)!
    if (s.getTime() < min.getTime()) min = s
    if (e.getTime() > max.getTime()) max = e
  }

  min = addDays(min, -3)
  max = addDays(max, 3)

  const totalDays = Math.max(1, daysBetween(min, max) + 1)
  const ticks: TimelineWindow['ticks'] = []

  const step = scale === 'day' ? 1 : scale === 'week' ? 7 : 30
  for (let offset = 0; offset <= totalDays; offset += step) {
    const date = addDays(min, offset)
    ticks.push({
      date: date.toISOString().slice(0, 10),
      label: formatTick(date, scale),
      isMajor: scale === 'day' ? date.getUTCDay() === 1 : date.getUTCDate() <= step,
      offsetPercent: (offset / totalDays) * 100,
    })
  }

  const todayOffset = daysBetween(min, todayUtc)

  return {
    start: min.toISOString().slice(0, 10),
    end: max.toISOString().slice(0, 10),
    totalDays,
    scale,
    ticks,
    todayOffsetPercent:
      todayOffset >= 0 && todayOffset <= totalDays ? (todayOffset / totalDays) * 100 : null,
  }
}

export function barGeometry(
  bar: ScheduleBar,
  window: TimelineWindow,
): { leftPercent: number; widthPercent: number } {
  const windowStart = toUtcDate(window.start)!
  const startOffset = daysBetween(windowStart, toUtcDate(bar.start)!)
  const endOffset = daysBetween(windowStart, toUtcDate(bar.end)!)

  const left = (startOffset / window.totalDays) * 100
  // +1 so a single-day job is a visible bar, not a hairline.
  const width = ((endOffset - startOffset + 1) / window.totalDays) * 100

  return {
    leftPercent: Math.max(0, Math.min(100, left)),
    widthPercent: Math.max(0.6, Math.min(100 - Math.max(0, left), width)),
  }
}

function formatTick(date: Date, scale: TimelineScale): string {
  if (scale === 'month') {
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  }
  if (scale === 'week') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })
}

export const SCHEDULE_STATUS_TONE: Record<string, string> = {
  prospect: '#6a7683',
  estimate: '#6a7683',
  preconstruction: '#1a56a8',
  permitting: '#9a5b00',
  scheduled: '#1a56a8',
  in_progress: '#12724a',
  on_hold: '#9a5b00',
  final_walkthrough: '#12724a',
  complete: '#5c6773',
  cancelled: '#ad2216',
}

export function isActiveOnSchedule(status: ProjectStatus): boolean {
  return (ACTIVE_PROJECT_STATUSES as string[]).includes(status)
}
