import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { campaignFunnels } from '@/lib/ops/prospecting/analytics'
import { computeRates, formatRate } from '@/lib/ops/prospecting/analytics-metrics'
import { csvCell } from '@/lib/ops/prospecting/mail-batch-read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLUMNS = [
  'campaign', 'county', 'imported', 'approved', 'mailed', 'responded', 'appointments', 'sold',
  'sold_revenue', 'response_rate', 'appointment_rate', 'close_rate',
]

/** Campaign analytics as CSV (spec §25). Revenue column only for permitted roles. */
export async function GET(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('analyticsExport')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }
  const canRevenue = user.can('analyticsRevenueView')
  const rangeKey = request.nextUrl.searchParams.get('range') ?? '90'
  const range = resolveRange(rangeKey)

  const supabase = createSupabaseServerClient()
  const rows = await campaignFunnels(supabase, range)

  const cols = canRevenue ? COLUMNS : COLUMNS.filter(c => c !== 'sold_revenue')
  const lines = rows.map(r => {
    const rr = computeRates(r)
    const cells: Record<string, string> = {
      campaign: r.campaignName ?? '', county: r.county ?? '',
      imported: String(r.imported), approved: String(r.approved), mailed: String(r.mailed),
      responded: String(r.responded), appointments: String(r.appointments), sold: String(r.sold),
      sold_revenue: r.soldWithRevenue > 0 ? (r.soldRevenueCents / 100).toFixed(2) : '',
      response_rate: formatRate(rr.responseRate), appointment_rate: formatRate(rr.appointmentRateMailed),
      close_rate: formatRate(rr.closeRateMailed),
    }
    return cols.map(c => csvCell(cells[c])).join(',')
  })

  const csv = [cols.join(','), ...lines].join('\n')
  const filename = `Campaign_Analytics_${rangeKey}_${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

function resolveRange(key: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (key === 'all') return { from: null, to: null }
  if (key === 'ytd') return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString(), to: null }
  const days = Number(key)
  if (Number.isFinite(days) && days > 0) return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: null }
  return { from: null, to: null }
}
