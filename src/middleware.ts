import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Define public routes that don't require authentication
const publicRoutes = [
  '/',
  '/auth/signin',
  '/auth/signup',
  '/auth/error',
  '/auth/reset-password',
  '/auth/new-password',
  '/api/auth',
  '/api/monitoring/health'
]

// Define API routes that don't require authentication
const publicApiRoutes = [
  '/api/auth',
  '/api/monitoring/health'
]

export default auth((req: NextRequest & { auth: any }) => {
  const { nextUrl } = req
  const isLoggedIn = !!req.auth

  // Check if the route is public
  const isPublicRoute = publicRoutes.some(route => 
    nextUrl.pathname === route || nextUrl.pathname.startsWith(route)
  )

  // Check if it's a public API route
  const isPublicApiRoute = publicApiRoutes.some(route =>
    nextUrl.pathname.startsWith(route)
  )

  // Allow public routes and API routes
  if (isPublicRoute || isPublicApiRoute) {
    return NextResponse.next()
  }

  // Redirect to signin if not authenticated and trying to access protected route
  if (!isLoggedIn) {
    const callbackUrl = nextUrl.pathname + nextUrl.search
    const signInUrl = new URL('/auth/signin', nextUrl.origin)
    signInUrl.searchParams.set('callbackUrl', callbackUrl)
    return NextResponse.redirect(signInUrl)
  }

  // Allow authenticated users to access protected routes
  return NextResponse.next()
})

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}