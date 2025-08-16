import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('Auth Integration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Set up minimal required environment
    process.env = {
      ...originalEnv,
      NEXTAUTH_SECRET: 'test-secret-for-integration',
      NEXTAUTH_URL: 'http://localhost:3000'
    }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should be able to import auth configuration without errors', async () => {
    // This test ensures the auth configuration can be imported
    // without throwing any errors during module initialization
    expect(async () => {
      await import('../config')
    }).not.toThrow()
  })

  it('should validate auth configuration on import', async () => {
    const { validateAuthConfig } = await import('../config')
    
    const config = validateAuthConfig()
    
    expect(config.nextAuthSecret).toBe('test-secret-for-integration')
    expect(config.nextAuthUrl).toBe('http://localhost:3000')
  })
})