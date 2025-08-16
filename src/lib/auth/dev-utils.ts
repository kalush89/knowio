/**
 * Development utilities for authentication testing and debugging
 */

import { getAvailableProviders, isProviderConfigured } from './config'

/**
 * Logs the current authentication configuration status
 * Useful for debugging during development
 */
export function logAuthStatus(): void {
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  console.log('\n🔐 Authentication Configuration Status:')
  console.log('=====================================')
  
  const providers = getAvailableProviders()
  console.log(`Available providers: ${providers.join(', ')}`)
  
  console.log('\nProvider Configuration:')
  console.log(`✓ Credentials: Always available`)
  console.log(`${isProviderConfigured('google') ? '✓' : '✗'} Google OAuth: ${isProviderConfigured('google') ? 'Configured' : 'Not configured'}`)
  console.log(`${isProviderConfigured('github') ? '✓' : '✗'} GitHub OAuth: ${isProviderConfigured('github') ? 'Configured' : 'Not configured'}`)
  
  console.log('\nEnvironment Variables:')
  console.log(`NEXTAUTH_URL: ${process.env.NEXTAUTH_URL || 'Not set (using default)'}`)
  console.log(`NEXTAUTH_SECRET: ${process.env.NEXTAUTH_SECRET ? 'Set' : 'Not set'}`)
  console.log(`GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set'}`)
  console.log(`GOOGLE_CLIENT_SECRET: ${process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set'}`)
  console.log(`GITHUB_CLIENT_ID: ${process.env.GITHUB_CLIENT_ID ? 'Set' : 'Not set'}`)
  console.log(`GITHUB_CLIENT_SECRET: ${process.env.GITHUB_CLIENT_SECRET ? 'Set' : 'Not set'}`)
  
  console.log('=====================================\n')
}

/**
 * Creates a test user object for development/testing
 */
export function createTestUser(overrides: Partial<{
  id: string
  email: string
  name: string
  image: string
}> = {}) {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    image: null,
    ...overrides
  }
}

/**
 * Mock OAuth provider response for testing
 */
export function mockOAuthProfile(provider: 'google' | 'github', overrides: Record<string, any> = {}) {
  const baseProfiles = {
    google: {
      sub: 'google-user-id',
      email: 'user@gmail.com',
      name: 'Google User',
      picture: 'https://example.com/avatar.jpg',
      email_verified: true
    },
    github: {
      id: 'github-user-id',
      login: 'githubuser',
      email: 'user@github.com',
      name: 'GitHub User',
      avatar_url: 'https://github.com/avatar.jpg'
    }
  }
  
  return {
    ...baseProfiles[provider],
    ...overrides
  }
}