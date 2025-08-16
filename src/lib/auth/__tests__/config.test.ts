import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateAuthConfig, isProviderConfigured, getAvailableProviders } from '../config'

describe('Auth Configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('validateAuthConfig', () => {
    it('should throw error when NEXTAUTH_SECRET is missing', () => {
      delete process.env.NEXTAUTH_SECRET
      
      expect(() => validateAuthConfig()).toThrow('NEXTAUTH_SECRET environment variable is required')
    })

    it('should return config with default NEXTAUTH_URL when not provided', () => {
      process.env.NEXTAUTH_SECRET = 'test-secret'
      delete process.env.NEXTAUTH_URL
      
      const config = validateAuthConfig()
      
      expect(config.nextAuthUrl).toBe('http://localhost:3000')
      expect(config.nextAuthSecret).toBe('test-secret')
    })

    it('should return config with all OAuth providers when configured', () => {
      process.env.NEXTAUTH_SECRET = 'test-secret'
      process.env.NEXTAUTH_URL = 'https://example.com'
      process.env.GOOGLE_CLIENT_ID = 'google-id'
      process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
      process.env.GITHUB_CLIENT_ID = 'github-id'
      process.env.GITHUB_CLIENT_SECRET = 'github-secret'
      
      const config = validateAuthConfig()
      
      expect(config).toEqual({
        nextAuthUrl: 'https://example.com',
        nextAuthSecret: 'test-secret',
        googleClientId: 'google-id',
        googleClientSecret: 'google-secret',
        githubClientId: 'github-id',
        githubClientSecret: 'github-secret'
      })
    })
  })

  describe('isProviderConfigured', () => {
    it('should return true when Google provider is fully configured', () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id'
      process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
      
      expect(isProviderConfigured('google')).toBe(true)
    })

    it('should return false when Google provider is partially configured', () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id'
      delete process.env.GOOGLE_CLIENT_SECRET
      
      expect(isProviderConfigured('google')).toBe(false)
    })

    it('should return true when GitHub provider is fully configured', () => {
      process.env.GITHUB_CLIENT_ID = 'github-id'
      process.env.GITHUB_CLIENT_SECRET = 'github-secret'
      
      expect(isProviderConfigured('github')).toBe(true)
    })

    it('should return false when GitHub provider is not configured', () => {
      delete process.env.GITHUB_CLIENT_ID
      delete process.env.GITHUB_CLIENT_SECRET
      
      expect(isProviderConfigured('github')).toBe(false)
    })
  })

  describe('getAvailableProviders', () => {
    it('should always include credentials provider', () => {
      const providers = getAvailableProviders()
      
      expect(providers).toContain('credentials')
    })

    it('should include all providers when configured', () => {
      process.env.GOOGLE_CLIENT_ID = 'google-id'
      process.env.GOOGLE_CLIENT_SECRET = 'google-secret'
      process.env.GITHUB_CLIENT_ID = 'github-id'
      process.env.GITHUB_CLIENT_SECRET = 'github-secret'
      
      const providers = getAvailableProviders()
      
      expect(providers).toEqual(['credentials', 'google', 'github'])
    })

    it('should only include credentials when no OAuth providers configured', () => {
      delete process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_SECRET
      delete process.env.GITHUB_CLIENT_ID
      delete process.env.GITHUB_CLIENT_SECRET
      
      const providers = getAvailableProviders()
      
      expect(providers).toEqual(['credentials'])
    })
  })
})