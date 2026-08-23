import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { evaluateVendor, refreshVendorCompliance } from '@/lib/ops/services/compliance'

/**
 * On-demand compliance evaluation for one vendor, optionally as of a past date
 * and in the context of a project. Useful for spot-checking an audit answer
 * ("were they covered on 3 March?") without exporting a whole package.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await requireUser()

  const vendorId = request.nextUrl.searchParams.get('vendorId')
  if (!vendorId) {
    return NextResponse.json({ error: 'vendorId is required.' }, { status: 400 })
  }

  const projectId = request.nextUrl.searchParams.get('projectId')
  const asOf = request.nextUrl.searchParams.get('asOf')
  const asOfDate = asOf ? new Date(`${asOf}T00:00:00Z`) : undefined
  if (asOf && Number.isNaN(asOfDate!.getTime())) {
    return NextResponse.json({ error: 'asOf must be a YYYY-MM-DD date.' }, { status: 400 })
  }

  const supabase = createSupabaseServerClient()
  const evaluation = await evaluateVendor(supabase, vendorId, { projectId, asOfDate })
  if (!evaluation) {
    return NextResponse.json({ error: 'Subcontractor not found.' }, { status: 404 })
  }

  return NextResponse.json(evaluation)
}

export async function POST(request: NextRequest) {
  const user = await requireUser()
  if (!user.can('writeRecords')) {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 })
  }

  const { vendorId } = (await request.json().catch(() => ({}))) as { vendorId?: string }
  if (!vendorId) return NextResponse.json({ error: 'vendorId is required.' }, { status: 400 })

  const supabase = createSupabaseServerClient()
  const evaluation = await refreshVendorCompliance(supabase, vendorId)
  if (!evaluation) return NextResponse.json({ error: 'Subcontractor not found.' }, { status: 404 })

  return NextResponse.json(evaluation)
}
