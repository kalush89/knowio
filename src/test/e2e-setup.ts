import { beforeAll, afterAll, vi } from 'vitest'
import { prisma } from '../lib/db'

// Global test environment setup for E2E tests
export class E2ETestEnvironment {
  private static isSetup = false

  static async setup() {
    if (this.isSetup) return

    // Ensure we're using a test database
    if (!process.env.DATABASE_URL?.includes('test')) {
      throw new Error('E2E tests must use a test database. Set DATABASE_URL to a test database.')
    }

    // Setup test database schema if needed
    try {
      await prisma.$connect()
      
      // Try to verify required tables exist, but don't fail if they don't
      try {
        await prisma.documentChunk.findFirst()
        await prisma.ingestionJob.findFirst()
      } catch (tableError) {
        console.warn('Database tables may not exist. This is normal for test environments.')
        console.warn('To create tables, run: npm run db:push')
      }
    } catch (error) {
      console.warn('Database connection issue:', error.message)
      // Don't throw here - let individual tests handle database issues
    }

    // Mock external services that shouldn't be called in tests
    this.mockExternalServices()

    this.isSetup = true
  }

  static async teardown() {
    if (!this.isSetup) return

    try {
      // Clean up any remaining test data
      await prisma.documentChunk.deleteMany({
        where: {
          OR: [
            { sourceUrl: { contains: 'test-e2e' } },
            { sourceUrl: { contains: 'example.com' } }
          ]
        }
      })

      await prisma.ingestionJob.deleteMany({
        where: {
          OR: [
            { url: { contains: 'test-e2e' } },
            { url: { contains: 'example.com' } }
          ]
        }
      })

      await prisma.$disconnect()
    } catch (error) {
      console.warn('Error during E2E test teardown:', error)
    }

    this.isSetup = false
  }

  private static mockExternalServices() {
    // Mock Inngest to prevent actual event sending
    vi.mock('../lib/inngest', () => ({
      inngest: {
        send: vi.fn().mockResolvedValue(undefined),
        createFunction: vi.fn()
      }
    }))

    // Mock AWS SDK to prevent actual AWS calls
    vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
      BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          body: {
            transformToString: vi.fn().mockResolvedValue(JSON.stringify({
              embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1)
            }))
          }
        })
      })),
      InvokeModelCommand: vi.fn()
    }))

    // Mock Playwright to prevent actual browser launches
    vi.mock('playwright', () => ({
      chromium: {
        launch: vi.fn().mockResolvedValue({
          newContext: vi.fn().mockResolvedValue({
            newPage: vi.fn().mockResolvedValue({
              goto: vi.fn(),
              content: vi.fn().mockResolvedValue('<html><body>Mock content</body></html>'),
              title: vi.fn().mockResolvedValue('Mock Title'),
              close: vi.fn()
            }),
            close: vi.fn()
          }),
          close: vi.fn()
        })
      }
    }))
  }
}

// Global setup and teardown
beforeAll(async () => {
  await E2ETestEnvironment.setup()
})

afterAll(async () => {
  await E2ETestEnvironment.teardown()
})