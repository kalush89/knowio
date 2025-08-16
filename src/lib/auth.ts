import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import Credentials from "next-auth/providers/credentials"
import { prisma } from "./db"
import { verifyPassword } from "./auth/password"
import { validateEmail } from "./auth/validation"
import { validateAuthConfig, isProviderConfigured } from "./auth/config"
import type { NextAuthConfig } from "next-auth"

// Validate configuration on startup - this ensures early failure if config is invalid
validateAuthConfig()

/**
 * Environment variables used:
 * - SESSION_MAX_AGE: Session maximum age in seconds (default: 2592000 = 30 days)
 * - SESSION_UPDATE_AGE: Session update frequency in seconds (default: 86400 = 24 hours)
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: Google OAuth credentials
 * - GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET: GitHub OAuth credentials
 * - NODE_ENV: Environment mode for debug settings
 */

// Build providers array based on available configuration
const providers: any[] = [
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" }
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        return null
      }

      // Validate email format
      if (!validateEmail(credentials.email as string)) {
        return null
      }

      const user = await prisma.user.findUnique({
        where: {
          email: credentials.email as string
        }
      })

      if (!user || !user.password) {
        return null
      }

      const isPasswordValid = await verifyPassword(
        credentials.password as string,
        user.password
      )

      if (!isPasswordValid) {
        return null
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      }
    }
  })
]

// Add Google provider if configured
if (isProviderConfigured('google')) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile",
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        }
      }
    })
  )
}

// Add GitHub provider if configured
if (isProviderConfigured('github')) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "read:user user:email"
        }
      },
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
        }
      }
    })
  )
}

// Session configuration - extracted for better organization
const sessionConfig = {
  strategy: "jwt" as const,
  maxAge: parseInt(process.env.SESSION_MAX_AGE || '2592000'), // 30 days default
  updateAge: parseInt(process.env.SESSION_UPDATE_AGE || '86400'), // 24 hours default
}

// Cookie configuration - extracted for better organization
const cookieConfig = {
  sessionToken: {
    name: `next-auth.session-token`,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure: process.env.NODE_ENV === 'production'
    }
  }
}

// Page configuration - extracted for better organization
// Requirement 6.1: Display GitHub sign-in button on sign-in page
// Requirement 2.2: Authenticate users with valid credentials and redirect to chat interface
const pageConfig = {
  signIn: '/auth/signin',
  signUp: '/auth/signup', // Custom sign-up page
  error: '/auth/error',
  verifyRequest: '/auth/verify-request', // For email verification
  newUser: '/' // Redirect new users to main chat interface (Requirement 2.2)
}

export const nextAuthConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  providers,
  session: sessionConfig,
  cookies: cookieConfig,
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        token.image = user.image
      }

      // Store the OAuth provider information
      if (account) {
        token.provider = account.provider
      }

      return token
    },
    async session({ session, token }) {
      // Requirement 8.1: Create secure sessions with appropriate expiration
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.image = token.image as string

        // Add provider information to session for UI purposes
        if (token.provider) {
          (session as any).provider = token.provider
        }

        // Log session creation for monitoring (Requirement 8.1)
        console.log('Session created/updated:', {
          userId: session.user.id,
          email: session.user.email,
          provider: token.provider || 'unknown',
          timestamp: new Date().toISOString()
        })
      }
      return session
    },
    async signIn({ user, account, profile }) {
      // Requirement 6.2: Handle GitHub OAuth flow redirects properly
      // Enhanced sign-in callback with better error handling and logging

      console.log('NextAuth signIn callback:', {
        provider: account?.provider,
        userEmail: user.email,
        userId: user.id
      })

      // For OAuth providers, ensure we have required profile information
      if (account?.provider !== 'credentials' && !user.email) {
        console.error(`Sign-in failed: No email provided by ${account?.provider}`, {
          provider: account?.provider,
          userId: user.id,
          profileData: profile ? 'present' : 'missing'
        })
        return false
      }

      // Additional validation for GitHub provider (Requirement 6.2)
      if (account?.provider === 'github') {
        if (!user.email) {
          console.error('GitHub sign-in failed: No email in profile')
          return false
        }
        console.log('GitHub sign-in successful:', { email: user.email })
      }

      // Additional validation for Google provider
      if (account?.provider === 'google') {
        if (!user.email) {
          console.error('Google sign-in failed: No email in profile')
          return false
        }
        console.log('Google sign-in successful:', { email: user.email })
      }

      // Log successful credentials sign-in (Requirement 2.2)
      if (account?.provider === 'credentials') {
        console.log('Credentials sign-in successful:', { email: user.email })
      }

      return true
    },
    async redirect({ url, baseUrl }) {
      // Requirement 2.2: Redirect to chat interface after successful authentication
      // Requirement 6.2: Handle GitHub OAuth flow redirects properly

      console.log('NextAuth redirect callback:', { url, baseUrl })

      // If the URL is relative, make it absolute
      if (url.startsWith("/")) {
        const absoluteUrl = `${baseUrl}${url}`
        console.log('Redirecting to relative URL:', absoluteUrl)
        return absoluteUrl
      }

      // If the URL is on the same origin, allow it
      if (new URL(url).origin === baseUrl) {
        console.log('Redirecting to same origin URL:', url)
        return url
      }

      // For OAuth flows, check if we have a callback URL
      const urlObj = new URL(url)
      const callbackUrl = urlObj.searchParams.get('callbackUrl')
      if (callbackUrl && callbackUrl.startsWith('/')) {
        const redirectUrl = `${baseUrl}${callbackUrl}`
        console.log('Redirecting to callback URL:', redirectUrl)
        return redirectUrl
      }

      // Default redirect to the main chat interface (Requirement 2.2)
      const defaultUrl = `${baseUrl}/`
      console.log('Redirecting to default chat interface:', defaultUrl)
      return defaultUrl
    }
  },
  pages: pageConfig,
  events: {
    async signIn({ user, account, isNewUser }) {
      // Enhanced logging for sign-in events
      // Requirement 2.2: Track successful authentication
      // Requirement 6.2: Track GitHub OAuth sign-ins
      console.log('User signed in:', {
        email: user.email,
        provider: account?.provider || 'unknown',
        isNewUser: isNewUser || false,
        timestamp: new Date().toISOString()
      })

      // Special handling for new users (Requirement 2.2)
      if (isNewUser) {
        console.log('New user created:', {
          email: user.email,
          provider: account?.provider || 'unknown',
          timestamp: new Date().toISOString()
        })
      }
    },
    async signOut({ session, token }) {
      // Enhanced logging for sign-out events
      // Requirement 8.1: Track session termination
      const userEmail = session?.user?.email ||
        (token && typeof token === 'object' && 'email' in token ? token.email as string : 'unknown')
      console.log('User signed out:', {
        email: userEmail,
        timestamp: new Date().toISOString()
      })
    },
    async createUser({ user }) {
      // Log user creation events
      console.log('User account created:', {
        email: user.email,
        id: user.id,
        timestamp: new Date().toISOString()
      })
    },
    async linkAccount({ user, account }) {
      // Log account linking events (for OAuth providers)
      console.log('Account linked:', {
        email: user.email,
        provider: account.provider,
        timestamp: new Date().toISOString()
      })
    }
  },
  debug: process.env.NODE_ENV === "development",
}

export const { handlers, auth, signIn, signOut } = NextAuth(nextAuthConfig)