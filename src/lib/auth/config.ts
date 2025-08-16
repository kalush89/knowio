/**
 * Authentication configuration validation and utilities
 */

export interface AuthConfig {
  nextAuthUrl: string
  nextAuthSecret: string
  googleClientId?: string
  googleClientSecret?: string
  githubClientId?: string
  githubClientSecret?: string
}

/**
 * Validates that required authentication environment variables are present
 */
export function validateAuthConfig(): AuthConfig {
  const config: AuthConfig = {
    nextAuthUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    nextAuthSecret: process.env.NEXTAUTH_SECRET || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  }

  // Validate required variables
  if (!config.nextAuthSecret) {
    throw new Error('NEXTAUTH_SECRET environment variable is required')
  }

  // Warn about missing OAuth providers
  const missingProviders: string[] = []
  
  if (!config.googleClientId || !config.googleClientSecret) {
    missingProviders.push('Google')
  }
  
  if (!config.githubClientId || !config.githubClientSecret) {
    missingProviders.push('GitHub')
  }

  if (missingProviders.length > 0) {
    console.warn(
      `Warning: OAuth providers not configured: ${missingProviders.join(', ')}. ` +
      'Only email/password authentication will be available.'
    )
  }

  return config
}

/**
 * Checks if a specific OAuth provider is configured
 */
export function isProviderConfigured(provider: 'google' | 'github'): boolean {
  switch (provider) {
    case 'google':
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    case 'github':
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET)
    default:
      return false
  }
}

/**
 * Gets the list of available OAuth providers based on configuration
 */
export function getAvailableProviders(): string[] {
  const providers: string[] = ['credentials'] // Always available
  
  if (isProviderConfigured('google')) {
    providers.push('google')
  }
  
  if (isProviderConfigured('github')) {
    providers.push('github')
  }
  
  return providers
}