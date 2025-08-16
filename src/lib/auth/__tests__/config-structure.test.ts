import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAvailableProviders, isProviderConfigured, validateAuthConfig } from '../config'

describe('NextAuth Configuration Structure', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // Set required environment variable for tests
    process.env.NEXTAUTH_SECRET = 'test-secret-key-for-testing'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should validate auth configuration without errors', () => {
    expect(() => validateAuthConfig()).not.toThrow()
  })

  it('should have credentials provider always available', () => {
    const providers = getAvailableProviders()
    expect(providers).toContain('credentials')
  })

  it('should correctly detect provider configuration', () => {
    // Test with environment variables not set (default test environment)
    expect(typeof isProviderConfigured('google')).toBe('boolean')
    expect(typeof isProviderConfigured('github')).toBe('boolean')
  })

  it('should return valid configuration object', () => {
    const config = validateAuthConfig()
    expect(config).toHaveProperty('nextAuthUrl')
    expect(config).toHaveProperty('nextAuthSecret')
    expect(config.nextAuthUrl).toBeTruthy()
    expect(config.nextAuthSecret).toBeTruthy()
  })

  it('should handle OAuth provider configuration gracefully', () => {
    const providers = getAvailableProviders()
    expect(Array.isArray(providers)).toBe(true)
    expect(providers.length).toBeGreaterThan(0)
  })

  it('should throw error when NEXTAUTH_SECRET is missing', () => {
    delete process.env.NEXTAUTH_SECRET
    expect(() => validateAuthConfig()).toThrow('NEXTAUTH_SECRET environment variable is required')
  })

  it('should detect OAuth providers when configured', () => {
    // Test Google provider detection
    process.env.GOOGLE_CLIENT_ID = 'test-google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
    expect(isProviderConfigured('google')).toBe(true)

    // Test GitHub provider detection
    process.env.GITHUB_CLIENT_ID = 'test-github-id'
    process.env.GITHUB_CLIENT_SECRET = 'test-github-secret'
    expect(isProviderConfigured('github')).toBe(true)

    // Test available providers includes OAuth when configured
    const providers = getAvailableProviders()
    expect(providers).toContain('credentials')
    expect(providers).toContain('google')
    expect(providers).toContain('github')
  })
})