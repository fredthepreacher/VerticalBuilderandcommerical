import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/**
 * Session refresh + a first line of defence on /ops.
 *
 * This middleware only redirects unauthenticated visitors away from the CRM so
 * they see the login page instead of a flash of an empty dashboard. It is NOT
 * the authorisation boundary: every page calls requireUser() and every mutation
 * re-checks the role server-side, and Postgres RLS enforces the rules again at
 * the data layer. Browser-side routing is never trusted.
 *
 * The public marketing site is untouched — the matcher excludes it entirely.
 */

const PUBLIC_OPS_PATHS = ['/ops/login']

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Not configured yet — send everything to the login page, which explains why.
  if (!url || !anonKey) {
    if (PUBLIC_OPS_PATHS.includes(request.nextUrl.pathname)) return response
    return NextResponse.redirect(new URL('/ops/login', request.url))
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Must be getUser(), not getSession(): getUser revalidates the JWT with the
  // auth server, so a revoked session cannot be replayed from a stale cookie.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_OPS_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))

  if (!user && !isPublic) {
    const loginUrl = new URL('/ops/login', request.url)
    if (pathname !== '/ops') loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  if (user && pathname === '/ops/login') {
    return NextResponse.redirect(new URL('/ops/dashboard', request.url))
  }

  return response
}

export const config = {
  matcher: ['/ops', '/ops/:path*'],
}
