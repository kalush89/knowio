import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JobProcessor } from '../processor'
import { JobQueue } from '../queue'
import { WebScraper } from '../../ingest/scraper'
import { ContentChunker } from '../../ingest/chunker'
import { URLValidator } from '../../ingest/validator'
import { EmbeddingService } from '../../embed/service'
import { VectorStore } from '../../vector/store'
import { IngestionJob, ScrapedContent, DocumentChunk, EmbeddedChunk } from '../../types'

// Mock all dependencies
vi.mock('../../ingest/scraper')
vi.mock('../../ingest/chunker')
vi.mock('../../ingest/validator')
vi.mock('../../embed/service')
vi.mock('../../vector/store')
vi.mock('../queue')

describe('JobProcessor', () => {
  let processor: JobProcessor
  let mockWebScraper: vi.Mocked<WebScraper>
  let mockContentChunker: vi.Mocked<ContentChunker>
  let mockUrlValidator: vi.Mocked<URLValidator>
  let mockEmbeddingService: vi.Mocked<EmbeddingService>
  let mockVectorStore: vi.Mocked<VectorStore>
  let mockJobQueue: vi.Mocked<JobQueue>

  const mockJob: IngestionJob = {
    id: 'job-123',
    url: 'https://example.com/docs',
    status: 'QUEUED',
    options: { maxDepth: 2, followLinks: true },
    progress: {
      pagesProcessed: 0,
      chunksCreated: 0,
      chunksEmbedded: 0,
      errors: []
    },
    createdAt: new Date('2024-01-01')
  }

  const mockScrapedContent: ScrapedContent = {
    url: 'https://example.com/docs',
    title: 'API Documentation',
    content: 'This is the API documentation content with detailed information about endpoints.',
    metadata: {
      title: 'API Documentation',
      description: 'Complete API reference',
      section: 'Getting Started'
    },
    links: []
  }

  const mockChunks: DocumentChunk[] = [
    {
      id: 'chunk-1',
      content: 'This is the API documentation content',
      metadata: {
        sourceUrl: 'https://example.com/docs',
        title: 'API Documentation',
        section: 'Getting Started',
        chunkIndex: 0
      },
      tokenCount: 50
    },
    {
      id: 'chunk-2',
      content: 'with detailed information about endpoints.',
      metadata: {
        sourceUrl: 'https://example.com/docs',
        title: 'API Documentation',
        section: 'Getting Started',
        chunkIndex: 1
      },
      tokenCount: 45
    }
  ]

  const mockEmbeddedChunks: EmbeddedChunk[] = mockChunks.map(chunk => ({
    ...chunk,
    embedding: new Array(1536).fill(0.1),
    embeddedAt: new Date('2024-01-01T10:00:00')
  }))

  beforeEach(() => {
    // Create mocked instances
    mockWebScraper = vi.mocked(new WebScraper())
    mockContentChunker = vi.mocked(new ContentChunker())
    mockUrlValidator = vi.mocked(new URLValidator())
    mockEmbeddingService = vi.mocked(new EmbeddingService())
    mockVectorStore = vi.mocked(new VectorStore())
    mockJobQueue = vi.mocked(new JobQueue())

    processor = new JobProcessor(
      mockWebScraper,
      mockContentChunker,
      mockUrlValidator,
      mockEmbeddingService,
      mockVectorStore,
      mockJobQueue,
      {
        maxProcessingTime: 60000,
        enableProgressUpdates: true,
        batchSize: 2,
        maxRetries: 2
      }
    )

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('processJob', () => {
    it('should successfully process a complete job', async () => {
      // Setup mocks
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)
      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 2,
        updated: 0,
        failed: 0,
        errors: []
      })

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(2)
      expect(result.errors).toHaveLength(0)
      expect(result.processingTime).toBeGreaterThan(0)

      // Verify all steps were called
      expect(mockJobQueue.updateStatus).toHaveBeenCalledWith('job-123', 'PROCESSING')
      expect(mockUrlValidator.validate).toHaveBeenCalledWith('https://example.com/docs')
      expect(mockWebScraper.scrape).toHaveBeenCalledWith('https://example.com/docs', {
        respectRobots: true,
        timeout: 30000
      })
      expect(mockContentChunker.chunk).toHaveBeenCalledWith(mockScrapedContent.content, mockScrapedContent.metadata)
      expect(mockEmbeddingService.generateEmbeddings).toHaveBeenCalledWith(mockChunks)
      expect(mockVectorStore.storeBatch).toHaveBeenCalledWith(mockEmbeddedChunks)
      expect(mockJobQueue.completeJob).toHaveBeenCalledWith('job-123', result)
    })

    it('should handle URL validation failure', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: false,
        errors: ['Invalid URL format'],
        sanitizedUrl: undefined
      })

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(false)
      expect(result.errors).toContain('URL validation failed: Invalid URL format')
      expect(mockWebScraper.scrape).not.toHaveBeenCalled()
    })

    it('should handle scraping failure with retries', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      // First attempt fails with retryable error, second succeeds
      mockWebScraper.scrape
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockResolvedValueOnce(mockScrapedContent)

      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)
      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 2,
        updated: 0,
        failed: 0,
        errors: []
      })

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(true)
      expect(mockWebScraper.scrape).toHaveBeenCalledTimes(2)
    })

    it('should handle embedding failure gracefully', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      mockEmbeddingService.generateEmbeddings.mockRejectedValue(new Error('Embedding service unavailable'))

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(false)
      expect(result.errors[0]).toContain('All embedding batches failed')
      expect(result.errors[0]).toContain('Embedding service unavailable')
      expect(mockVectorStore.storeBatch).not.toHaveBeenCalled()
    })

    it('should handle partial embedding success', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      
      // Only one chunk gets embedded successfully
      const partialEmbeddedChunks = [mockEmbeddedChunks[0]]
      mockEmbeddingService.generateEmbeddings.mockResolvedValue(partialEmbeddedChunks)
      
      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 1,
        updated: 0,
        failed: 0,
        errors: []
      })

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(1)
    })

    it('should handle storage failure', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)
      mockVectorStore.storeBatch.mockRejectedValue(new Error('Database connection failed'))

      const result = await processor.processJob('job-123')

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Vector storage failed: Database connection failed')
    })

    it('should handle job timeout', async () => {
      // Create processor with very short timeout
      const shortTimeoutProcessor = new JobProcessor(
        mockWebScraper,
        mockContentChunker,
        mockUrlValidator,
        mockEmbeddingService,
        mockVectorStore,
        mockJobQueue,
        {
          maxProcessingTime: 100, // 100ms timeout
          enableProgressUpdates: false
        }
      )

      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          isValid: true,
          errors: [],
          sanitizedUrl: 'https://example.com/docs'
        }), 200)) // Takes longer than timeout
      )

      const result = await shortTimeoutProcessor.processJob('job-123')

      expect(result.success).toBe(false)
      expect(result.errors[0]).toContain('Job processing timeout after 100ms')
    })

    it('should handle nonexistent job', async () => {
      mockJobQueue.getStatus.mockResolvedValue(null)

      const result = await processor.processJob('nonexistent-job')

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Job nonexistent-job not found')
    })

    it('should update progress during processing', async () => {
      mockJobQueue.getStatus.mockResolvedValue(mockJob)
      mockJobQueue.updateStatus.mockResolvedValue()
      mockJobQueue.updateProgress.mockResolvedValue()
      mockJobQueue.completeJob.mockResolvedValue()

      mockUrlValidator.validate.mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'https://example.com/docs'
      })

      mockWebScraper.scrape.mockResolvedValue(mockScrapedContent)
      mockContentChunker.chunk.mockResolvedValue(mockChunks)
      mockEmbeddingService.generateEmbeddings.mockResolvedValue(mockEmbeddedChunks)
      mockVectorStore.storeBatch.mockResolvedValue({
        stored: 2,
        updated: 0,
        failed: 0,
        errors: []
      })

      await processor.processJob('job-123')

      // Verify progress updates were called
      expect(mockJobQueue.updateProgress).toHaveBeenCalledWith('job-123', {
        pagesProcessed: 1
      })
      expect(mockJobQueue.updateProgress).toHaveBeenCalledWith('job-123', {
        chunksCreated: 2
      })
      expect(mockJobQueue.updateProgress).toHaveBeenCalledWith('job-123', {
        chunksEmbedded: 2
      })
    })
  })

  describe('getConfiguration', () => {
    it('should return processor configuration', () => {
      const config = processor.getConfiguration()

      expect(config).toEqual({
        maxProcessingTime: 60000,
        enableProgressUpdates: true,
        batchSize: 2,
        maxRetries: 2
      })
    })
  })
})