import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JobQueue } from '../queue'
import { JobProcessor } from '../processor'
import { WebScraper } from '../../ingest/scraper'
import { ContentChunker } from '../../ingest/chunker'
import { URLValidator } from '../../ingest/validator'
import { EmbeddingService } from '../../embed/service'
import { VectorStore } from '../../vector/store'
import { prisma } from '../../db'
import { inngest } from '../../inngest'

// Mock external dependencies
vi.mock('../../db', () => ({
  prisma: {
    ingestionJob: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn()
    }
  }
}))

vi.mock('../../inngest', () => ({
  inngest: {
    send: vi.fn()
  }
}))

// Mock service classes
vi.mock('../../ingest/scraper')
vi.mock('../../ingest/chunker')
vi.mock('../../ingest/validator')
vi.mock('../../embed/service')
vi.mock('../../vector/store')

describe('Job Processing Integration', () => {
  let jobQueue: JobQueue
  let processor: JobProcessor
  let mockWebScraper: vi.Mocked<WebScraper>
  let mockContentChunker: vi.Mocked<ContentChunker>
  let mockUrlValidator: vi.Mocked<URLValidator>
  let mockEmbeddingService: vi.Mocked<EmbeddingService>
  let mockVectorStore: vi.Mocked<VectorStore>

  beforeEach(() => {
    // Create service instances
    mockWebScraper = vi.mocked(new WebScraper())
    mockContentChunker = vi.mocked(new ContentChunker())
    mockUrlValidator = vi.mocked(new URLValidator())
    mockEmbeddingService = vi.mocked(new EmbeddingService())
    mockVectorStore = vi.mocked(new VectorStore())

    jobQueue = new JobQueue({
      maxRetries: 3,
      retryDelay: 1000,
      maxConcurrentJobs: 2,
      jobTimeout: 60000
    })

    processor = new JobProcessor(
      mockWebScraper,
      mockContentChunker,
      mockUrlValidator,
      mockEmbeddingService,
      mockVectorStore,
      jobQueue,
      {
        maxProcessingTime: 60000,
        enableProgressUpdates: true,
        batchSize: 5,
        maxRetries: 2
      }
    )

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Complete Job Workflow', () => {
    it('should handle complete successful ingestion workflow', async () => {
      const testUrl = 'https://api.example.com/docs'
      const testOptions = { maxDepth: 2, followLinks: true }

      // Mock database responses
      const mockJob = {
        id: 'job-123',
        url: testUrl,
        status: 'QUEUED',
        options: JSON.stringify(testOptions),
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        })
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue({
        ...mockJob,
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      } as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock service responses
      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      mockWebScraper.scrape.mockResolvedValue({
        url: testUrl,
        title: 'API Documentation',
        content: 'This is comprehensive API documentation with multiple sections covering authentication, endpoints, and examples.',
        metadata: {
          title: 'API Documentation',
          description: 'Complete API reference',
          section: 'Overview'
        },
        links: []
      })

      const mockChunks = [
        {
          id: 'chunk-1',
          content: 'This is comprehensive API documentation',
          metadata: {
            sourceUrl: testUrl,
            title: 'API Documentation',
            section: 'Overview',
            chunkIndex: 0
          },
          tokenCount: 45
        },
        {
          id: 'chunk-2',
          content: 'with multiple sections covering authentication',
          metadata: {
            sourceUrl: testUrl,
            title: 'API Documentation',
            section: 'Overview',
            chunkIndex: 1
          },
          tokenCount: 42
        },
        {
          id: 'chunk-3',
          content: 'endpoints, and examples.',
          metadata: {
            sourceUrl: testUrl,
            title: 'API Documentation',
            section: 'Overview',
            chunkIndex: 2
          },
          tokenCount: 25
        }
      ]

      mockContentChunker.chunk.mockResolvedValue(mockChunks)

      const mockEmbeddedChunks = mockChunks.map(chunk => ({
        ...chunk,
        embedding: new Array(1536).fill(0.1),
        embeddedAt: new Date('2024-01-01T10:00:00')
      }))

      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)

      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 3,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Step 1: Enqueue job
      const jobId = await jobQueue.enqueue(testUrl, testOptions)
      expect(jobId).toBe('job-123')
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.started',
        data: {
          jobId: 'job-123',
          url: testUrl,
          options: testOptions
        }
      })

      // Step 2: Process job
      const result = await processor.processJob(jobId)

      // Verify successful completion
      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(3)
      expect(result.errors).toHaveLength(0)
      expect(result.processingTime).toBeGreaterThan(0)

      // Verify all services were called correctly
      expect(mockUrlValidator.validate).toHaveBeenCalledWith(testUrl)
      expect(mockWebScraper.scrape).toHaveBeenCalledWith(testUrl, {
        respectRobots: true,
        timeout: 30000
      })
      expect(mockContentChunker.chunk).toHaveBeenCalled()
      expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledWith(mockChunks)
      expect(mockVectorStore.storeBatch).toHaveBeenCalledWith(mockEmbeddedChunks)

      // Verify job status updates
      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: jobId },
        data: {
          status: 'PROCESSING',
          startedAt: expect.any(Date)
        }
      })

      // Verify completion event
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.completed',
        data: {
          jobId,
          success: true,
          totalChunks: 3,
          errors: []
        }
      })
    })

    it('should handle workflow with partial failures', async () => {
      const testUrl = 'https://api.example.com/docs'
      
      const mockJob = {
        id: 'job-456',
        url: testUrl,
        status: 'QUEUED',
        options: '{}',
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        })
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue({
        ...mockJob,
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      } as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock successful validation and scraping
      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      mockWebScraper.scrape.mockResolvedValue({
        url: testUrl,
        title: 'API Documentation',
        content: 'API documentation content',
        metadata: {
          title: 'API Documentation',
          section: 'Overview'
        },
        links: []
      })

      const mockChunks = [
        {
          id: 'chunk-1',
          content: 'API documentation content',
          metadata: {
            sourceUrl: testUrl,
            title: 'API Documentation',
            section: 'Overview',
            chunkIndex: 0
          },
          tokenCount: 30
        }
      ]

      mockContentChunker.chunk.mockResolvedValue(mockChunks)

      // Mock embedding service with partial success
      const mockEmbeddedChunks = mockChunks.map(chunk => ({
        ...chunk,
        embedding: new Array(1536).fill(0.1),
        embeddedAt: new Date('2024-01-01T10:00:00')
      }))

      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)

      // Mock storage with partial failure
      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 0,
        updated: 1,
        failed: 0,
        errors: []
      })

      const jobId = await jobQueue.enqueue(testUrl)
      const result = await processor.processJob(jobId)

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(1) // 0 stored + 1 updated
      expect(result.errors).toHaveLength(0)
    })

    it('should handle complete workflow failure', async () => {
      const testUrl = 'https://invalid-url'
      
      const mockJob = {
        id: 'job-789',
        url: testUrl,
        status: 'QUEUED',
        options: '{}',
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        })
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue({
        ...mockJob,
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      } as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock validation failure
      mockUrlValidator.validate.mockResolvedValue({
        isValid: false,
        errors: ['Invalid URL format', 'URL not accessible'],
        sanitizedUrl: undefined
      })

      const jobId = await jobQueue.enqueue(testUrl)
      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.totalChunks).toBe(0)
      expect(result.errors).toContain('URL validation failed: Invalid URL format, URL not accessible')

      // Verify failure event
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.completed',
        data: {
          jobId,
          success: false,
          totalChunks: 0,
          errors: result.errors
        }
      })
    })

    it('should handle concurrent job processing', async () => {
      const testUrls = [
        'https://api1.example.com/docs',
        'https://api2.example.com/docs',
        'https://api3.example.com/docs'
      ]

      // Mock database responses for multiple jobs
      const mockJobs = testUrls.map((url, index) => ({
        id: `job-${index + 1}`,
        url,
        status: 'QUEUED',
        options: '{}',
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        }),
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }))

      vi.mocked(prisma.ingestionJob.create)
        .mockResolvedValueOnce(mockJobs[0] as any)
        .mockResolvedValueOnce(mockJobs[1] as any)
        .mockResolvedValueOnce(mockJobs[2] as any)

      vi.mocked(prisma.ingestionJob.findUnique)
        .mockImplementation(async ({ where }) => {
          const job = mockJobs.find(j => j.id === where.id)
          return job as any
        })

      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock successful processing for all jobs
      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue({
        url: 'https://example.com/docs',
        title: 'API Documentation',
        content: 'API documentation content',
        metadata: { title: 'API Documentation' },
        links: []
      })

      mockContentChunker.chunk.mockResolvedValue([{
        id: 'chunk-1',
        content: 'API documentation content',
        metadata: {
          sourceUrl: 'https://example.com/docs',
          title: 'API Documentation',
          chunkIndex: 0
        },
        tokenCount: 30
      }])

      mockEmbeddingService.generateEmbeddings.mockResolvedValue([{
        id: 'chunk-1',
        content: 'API documentation content',
        metadata: {
          sourceUrl: 'https://example.com/docs',
          title: 'API Documentation',
          chunkIndex: 0
        },
        tokenCount: 30,
        embedding: new Array(1536).fill(0.1),
        embeddedAt: new Date()
      }])

      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 1,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Enqueue all jobs
      const jobIds = await Promise.all(
        testUrls.map(url => jobQueue.enqueue(url))
      )

      expect(jobIds).toHaveLength(3)

      // Process all jobs concurrently
      const results = await Promise.all(
        jobIds.map(jobId => processor.processJob(jobId))
      )

      // Verify all jobs completed successfully
      results.forEach(result => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBe(1)
        expect(result.errors).toHaveLength(0)
      })

      // Verify all completion events were sent (start + progress + complete events)
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ingestion/job.started'
        })
      )
      expect(inngest.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ingestion/job.completed'
        })
      )
    })
  })

  describe('Error Recovery and Retry Logic', () => {
    it('should retry failed operations and eventually succeed', async () => {
      const testUrl = 'https://api.example.com/docs'
      
      const mockJob = {
        id: 'job-retry',
        url: testUrl,
        status: 'QUEUED',
        options: '{}',
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        }),
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock validation success
      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      // Mock scraper to fail first attempt, succeed on second
      mockWebScraper.scrape
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce({
          url: testUrl,
          title: 'API Documentation',
          content: 'API documentation content',
          metadata: { title: 'API Documentation' },
          links: []
        })

      mockContentChunker.chunk.mockResolvedValue([{
        id: 'chunk-1',
        content: 'API documentation content',
        metadata: {
          sourceUrl: testUrl,
          title: 'API Documentation',
          chunkIndex: 0
        },
        tokenCount: 30
      }])

      mockEmbeddingService.generateEmbeddings.mockResolvedValue([{
        id: 'chunk-1',
        content: 'API documentation content',
        metadata: {
          sourceUrl: testUrl,
          title: 'API Documentation',
          chunkIndex: 0
        },
        tokenCount: 30,
        embedding: new Array(1536).fill(0.1),
        embeddedAt: new Date()
      }])

      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 1,
        updated: 0,
        failed: 0,
        errors: []
      })

      const jobId = await jobQueue.enqueue(testUrl)
      const result = await processor.processJob(jobId)

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(1)
      expect(mockWebScraper.scrape).toHaveBeenCalledTimes(2) // First failed, second succeeded
    })

    it('should fail after exhausting all retries', async () => {
      const testUrl = 'https://api.example.com/docs'
      
      const mockJob = {
        id: 'job-fail',
        url: testUrl,
        status: 'QUEUED',
        options: '{}',
        progress: JSON.stringify({
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        }),
        createdAt: new Date('2024-01-01'),
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      // Mock validation success
      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      // Mock scraper to always fail
      mockWebScraper.scrape.mockRejectedValue(new Error('Persistent network error'))

      const jobId = await jobQueue.enqueue(testUrl)
      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.errors.some(error => 
        error.includes('Content scraping failed after all retries') || 
        error.includes('Persistent network error')
      )).toBe(true)
      expect(mockWebScraper.scrape).toHaveBeenCalledTimes(2) // maxRetries = 2
    })
  })
})