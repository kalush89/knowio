import { handlers } from "@/lib/auth"
import { NextRequest } from "next/server"

/**
 * NextAuth.js API Route Handler
 * 
 * This route handles all NextAuth.js authentication requests including:
 * - OAuth provider callbacks (Google, GitHub)
 * - Credentials authentication
 * - Session management
 * - Sign in/out operations
 * 
 * Requirements addressed:
 * - 2.2: Authenticate users with valid credentials and redirect to chat interface
 * - 6.1: Display GitHub sign-in button on sign-in page (handled by NextAuth UI)
 * - 6.2: Handle GitHub OAuth flow redirects (handled by OAuth callback)
 * - 8.1: Create secure sessions with appropriate expiration (configured in auth config)
 * 
 * The route implements comprehensive error handling, security logging, and
 * proper session management as required by the authentication system design.
 */

// Extract handlers from NextAuth configuration
const { GET: NextAuthGET, POST: NextAuthPOST } = handlers

/**
 * Handle GET requests for NextAuth
 * Used for OAuth callbacks, session checks, and CSRF token generation
 * 
 * Requirement 6.2: Handle GitHub OAuth flow redirects
 * Requirement 8.1: Create secure sessions with appropriate expiration
 */
export async function GET(request: NextRequest) {
  try {
    // Log authentication requests for monitoring (excluding sensitive data)
    const url = new URL(request.url)
    const pathSegments = url.pathname.split('/')
    const action = pathSegments[pathSegments.length - 1] || 'unknown'
    const provider = url.searchParams.get('provider')
    
    // Enhanced logging for OAuth callbacks and session management
    if (['callback', 'signin', 'signout', 'session', 'csrf'].includes(action)) {
      const logData: any = {
        action,
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get('user-agent')?.substring(0, 100) || 'unknown'
      }
      
      // Add provider info for OAuth callbacks (Requirement 6.2)
      if (action === 'callback' && provider) {
        logData.provider = provider
        console.log(`NextAuth OAuth callback: ${provider}`, logData)
      } else {
        console.log(`NextAuth GET request: ${action}`, logData)
      }
    }
    
    return await NextAuthGET(request)
  } catch (error) {
    // Enhanced error logging for debugging OAuth flows
    const url = new URL(request.url)
    const provider = url.searchParams.get('provider')
    const errorCode = url.searchParams.get('error')
    
    console.error('NextAuth GET error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      url: request.url,
      provider,
      errorCode,
      timestamp: new Date().toISOString()
    })
    
    // Re-throw to let NextAuth handle the error appropriately
    throw error
  }
}

/**
 * Handle POST requests for NextAuth
 * Used for sign-in, sign-out, and other authentication actions
 * 
 * Requirement 2.2: Authenticate users with valid credentials and redirect to chat interface
 * Requirement 8.1: Create secure sessions with appropriate expiration
 */
export async function POST(request: NextRequest) {
  try {
    // Log authentication requests for monitoring (excluding sensitive data)
    const url = new URL(request.url)
    const pathSegments = url.pathname.split('/')
    const action = pathSegments[pathSegments.length - 1] || 'unknown'
    
    // Enhanced logging for authentication actions
    if (['signin', 'signout', 'callback'].includes(action)) {
      const logData = {
        action,
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get('user-agent')?.substring(0, 100) || 'unknown',
        origin: request.headers.get('origin') || 'unknown'
      }
      
      // Log sign-in attempts (Requirement 2.2)
      if (action === 'signin') {
        console.log('NextAuth sign-in attempt', logData)
      } else {
        console.log(`NextAuth POST request: ${action}`, logData)
      }
    }
    
    const response = await NextAuthPOST(request)
    
    // Log successful authentication responses
    if (response.status === 200 || response.status === 302) {
      console.log(`NextAuth ${action} successful`, {
        status: response.status,
        timestamp: new Date().toISOString()
      })
    }
    
    return response
  } catch (error) {
    // Enhanced error logging for authentication failures
    const url = new URL(request.url)
    const pathSegments = url.pathname.split('/')
    const action = pathSegments[pathSegments.length - 1] || 'unknown'
    
    console.error('NextAuth POST error:', {
      action,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      url: request.url,
      timestamp: new Date().toISOString()
    })
    
    // Re-throw to let NextAuth handle the error appropriately
    throw error
  }
}