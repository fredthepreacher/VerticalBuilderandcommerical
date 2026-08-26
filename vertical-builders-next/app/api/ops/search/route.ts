import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import { globalSearch } from '@/lib/ops/services/search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await requireUser()
  const term = request.nextUrl.searchParams.get('q') ?? ''
  if (term.trim().length < 2) return NextResponse.json({ hits: [] })

  const supabase = createSupabaseServerClient()
  const hits = await globalSearch(supabase, term)
  return NextResponse.json({ hits })
}
