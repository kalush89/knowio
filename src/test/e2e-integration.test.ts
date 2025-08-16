import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as ingestPost } from '../app/api/ingest-url/route'
import { GET as statusGet } from '../app/api/ingest-status/[jobId]/route'
import { prisma } from '../lib/db'
import { JobQueue } from '../lib/jobs/queue'
import { JobProcessor } from '../lib/jobs/processor'
import { WebScraper } from '../lib/ingest/scraper'
import { ContentChunker } from '../lib/ingest/chunker'
import { URLValidator } from '../lib/ingest/validator'
import { EmbeddingService } from '../lib/embed/service'
import { VectorStore } from '../lib/vector/store'
import { inngest } from '../lib/inngest'
import { IngestionJob, DocumentChunk, EmbeddedChunk } from '../lib/types'

// Test utilities for database cleanup and mock data generation
class E2ETestUtils {
  static async cleanupDatabase() {
    try {
      // Clean up test data in reverse dependency order
      await prisma.documentChunk.deleteMany({
        where: {
          sourceUrl: {
            contains: 'test-e2e'
          }
        }
      })
      
      await prisma.ingestionJob.deleteMany({
        where: {
          url: {
            contains: 'test-e2e'
          }
        }
      })
    } catch (error) {
      // Ignore errors if tables don't exist (e.g., in test environment setup)
      console.warn('Database cleanup warning (this is normal for test setup):', error.message)
    }
  }

  static generateTestDocumentationUrl(id: string): string {
    return `https://test-e2e-${id}.example.com/docs`
  }

  static generateMockScrapedContent(url: string, sections: number = 3): {
    url: string
    title: string
    content: string
    metadata: any
    links: string[]
  } {
    const content = Array.from({ length: sections }, (_, i) => 
      `Section ${i + 1}: This is comprehensive documentation content for section ${i + 1}. ` +
      `It includes detailed explanations, code examples, and best practices. ` +
      `The content is structured to provide clear guidance for developers. ` +
      `Each section builds upon the previous one to create a complete understanding.`
    ).join('\n\n')

    return {
      url,
      title: `Test API Documentation - ${url}`,
      content,
      metadata: {
        title: `Test API Documentation - ${url}`,
        description: 'Comprehensive test API documentation',
        section: 'Overview'
      },
      links: []
    }
  }

  static generateMockChunks(sourceUrl: string, content: string): DocumentChunk[] {
    const sentences = content.split('. ').filter(s => s.trim().length > 0)
    const chunksPerSection = Math.ceil(sentences.length / 3)
    
    return Array.from({ length: 3 }, (_, i) => {
      const startIdx = i * chunksPerSection
      const endIdx = Math.min((i + 1) * chunksPerSection, sentences.length)
      const chunkContent = sentences.slice(startIdx, endIdx).join('. ') + '.'
      
      return {
        id: `test-chunk-${i + 1}`,
        content: chunkContent,
        metadata: {
          sourceUrl,
          title: `Test API Documentation - ${sourceUrl}`,
          section: `Section ${i + 1}`,
          chunkIndex: i
        },
        tokenCount: Math.floor(chunkContent.length / 4) // Rough token estimate
      }
    })
  }

  static generateMockEmbeddings(chunks: DocumentChunk[]): EmbeddedChunk[] {
    return chunks.map(chunk => ({
      ...chunk,
      embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
      embeddedAt: new Date()
    }))
  }

  static async waitForJobCompletion(jobId: string, maxWaitTime: number = 30000): Promise<IngestionJob> {
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })
      
      if (job && (job.status === 'COMPLETED' || job.status === 'FAILED')) {
        return {
          id: job.id,
          url: job.url,
          status: job.status,
          options: JSON.parse(job.options as string),
          progress: JSON.parse(job.progress as string),
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          errorMessage: job.errorMessage
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    
    throw new Error(`Job ${jobId} did not complete within ${maxWaitTime}ms`)
  }
}

describe('End-to-End Integration Tests', () => {
  let jobQueue: JobQueue
  let processor: JobProcessor
  let webScraper: WebScraper
  let contentChunker: ContentChunker
  let urlValidator: URLValidator
  let embeddingService: EmbeddingService
  let vectorStore: VectorStore

  beforeAll(async () => {
    // Initialize services with test configuration
    jobQueue = new JobQueue({
      maxRetries: 2,
      retryDelay: 100, // Faster retries for testing
      maxConcurrentJobs: 3,
      jobTimeout: 10000 // Shorter timeout for testing
    })

    webScraper = new WebScraper()
    contentChunker = new ContentChunker()
    urlValidator = new URLValidator()
    embeddingService = new EmbeddingService()
    vectorStore = new VectorStore()

    processor = new JobProcessor(
      webScraper,
      contentChunker,
      urlValidator,
      embeddingService,
      vectorStore,
      jobQueue,
      {
        maxProcessingTime: 10000,
        enableProgressUpdates: true,
        batchSize: 3,
        maxRetries: 2
      }
    )
  })

  beforeEach(async () => {
    // Clean up before each test
    await E2ETestUtils.cleanupDatabase()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up after each test
    await E2ETestUtils.cleanupDatabase()
    vi.resetAllMocks()
  })

  afterAll(async () => {
    // Final cleanup
    await E2ETestUtils.cleanupDatabase()
    await prisma.$disconnect()
  })

  describe('Complete Ingestion Workflow with Real Documentation URLs', () => {
    it('should successfully ingest and process documentation from a valid URL', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('valid-docs')
      
      // Mock the services for this test
      const mockScrapedContent = E2ETestUtils.generateMockScrapedContent(testUrl)
      const mockChunks = E2ETestUtils.generateMockChunks(testUrl, mockScrapedContent.content)
      const mockEmbeddedChunks = E2ETestUtils.generateMockEmbeddings(mockChunks)

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue(mockScrapedContent)
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(mockChunks)
      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(mockEmbeddedChunks)
      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: mockEmbeddedChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Step 1: Submit ingestion request
      const ingestRequest = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: testUrl,
          options: {
            maxDepth: 2,
            followLinks: true,
            respectRobots: true
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const ingestResponse = await ingestPost(ingestRequest)
      const ingestData = await ingestResponse.json()

      expect(ingestResponse.status).toBe(202)
      expect(ingestData.jobId).toBeDefined()
      expect(ingestData.status).toBe('queued')
      expect(ingestData.message).toContain('Ingestion job queued')

      const jobId = ingestData.jobId

      // Step 2: Process the job
      const processingResult = await processor.processJob(jobId)

      expect(processingResult.success).toBe(true)
      expect(processingResult.totalChunks).toBe(mockChunks.length)
      expect(processingResult.errors).toHaveLength(0)

      // Step 3: Verify job completion status
      const completedJob = await E2ETestUtils.waitForJobCompletion(jobId)

      expect(completedJob.status).toBe('COMPLETED')
      expect(completedJob.progress.pagesProcessed).toBe(1)
      expect(completedJob.progress.chunksCreated).toBe(mockChunks.length)
      expect(completedJob.progress.chunksEmbedded).toBe(mockChunks.length)
      expect(completedJob.progress.errors).toHaveLength(0)

      // Step 4: Verify status API response
      const statusRequest = new NextRequest(`http://localhost:3000/api/ingest-status/${jobId}`)
      const statusResponse = await statusGet(statusRequest, { params: { jobId } })
      const statusData = await statusResponse.json()

      expect(statusResponse.status).toBe(200)
      expect(statusData.status).toBe('completed')
      expect(statusData.progress.pagesProcessed).toBe(1)
      expect(statusData.progress.chunksCreated).toBe(mockChunks.length)
      expect(statusData.progress.chunksEmbedded).toBe(mockChunks.length)
      expect(statusData.progress.completionRate).toBe(100)

      // Step 5: Verify data was stored in database
      const storedChunks = await prisma.documentChunk.findMany({
        where: { sourceUrl: testUrl }
      })

      expect(storedChunks).toHaveLength(mockChunks.length)
      storedChunks.forEach((chunk, index) => {
        expect(chunk.sourceUrl).toBe(testUrl)
        expect(chunk.content).toBe(mockChunks[index].content)
        expect(chunk.chunkIndex).toBe(index)
      })

      // Verify all services were called correctly
      expect(urlValidator.validate).toHaveBeenCalledWith(testUrl)
      expect(webScraper.scrape).toHaveBeenCalledWith(testUrl, expect.any(Object))
      expect(contentChunker.chunk).toHaveBeenCalledWith(
        mockScrapedContent.content,
        mockScrapedContent.metadata
      )
      expect(embeddingService.generateEmbeddings).toHaveBeenCalledWith(mockChunks)
      expect(vectorStore.storeBatch).toHaveBeenCalledWith(mockEmbeddedChunks)
    })

    it('should handle multiple documentation pages with link following', async () => {
      const baseUrl = E2ETestUtils.generateTestDocumentationUrl('multi-page')
      const linkedUrls = [
        `${baseUrl}/getting-started`,
        `${baseUrl}/api-reference`,
        `${baseUrl}/examples`
      ]

      // Mock URL validation for all URLs
      vi.spyOn(urlValidator, 'validate').mockImplementation(async (url) => ({
        isValid: true,
        errors: [],
        sanitizedUrl: url
      }))

      // Mock scraping for main page with links
      const mainPageContent = E2ETestUtils.generateMockScrapedContent(baseUrl)
      mainPageContent.links = linkedUrls

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => {
        if (url === baseUrl) {
          return mainPageContent
        }
        return E2ETestUtils.generateMockScrapedContent(url)
      })

      // Mock chunking and embedding for all pages
      const allChunks: DocumentChunk[] = []
      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => {
        const chunks = E2ETestUtils.generateMockChunks(metadata.sourceUrl || baseUrl, content)
        allChunks.push(...chunks)
        return chunks
      })

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => {
        return E2ETestUtils.generateMockEmbeddings(chunks)
      })

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 12, // 3 chunks per page * 4 pages
        updated: 0,
        failed: 0,
        errors: []
      })

      // Submit ingestion request with link following enabled
      const ingestRequest = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: baseUrl,
          options: {
            maxDepth: 2,
            followLinks: true,
            respectRobots: true
          }
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const ingestResponse = await ingestPost(ingestRequest)
      const ingestData = await ingestResponse.json()
      const jobId = ingestData.jobId

      // Process the job
      const processingResult = await processor.processJob(jobId)

      expect(processingResult.success).toBe(true)
      expect(processingResult.totalChunks).toBeGreaterThan(3) // Should have processed multiple pages

      // Verify multiple pages were processed
      const completedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(completedJob.progress.pagesProcessed).toBeGreaterThan(1)
      expect(completedJob.progress.chunksCreated).toBeGreaterThan(3)

      // Verify scraper was called for main page and linked pages
      expect(webScraper.scrape).toHaveBeenCalledWith(baseUrl, expect.any(Object))
      linkedUrls.forEach(linkedUrl => {
        expect(webScraper.scrape).toHaveBeenCalledWith(linkedUrl, expect.any(Object))
      })
    })
  })

  describe('Concurrent Processing Scenarios and Resource Management', () => {
    it('should handle multiple concurrent ingestion requests efficiently', async () => {
      const testUrls = Array.from({ length: 5 }, (_, i) => 
        E2ETestUtils.generateTestDocumentationUrl(`concurrent-${i}`)
      )

      // Mock services for all URLs
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => 
        E2ETestUtils.generateMockScrapedContent(url)
      )

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        E2ETestUtils.generateMockChunks(metadata.sourceUrl || 'test-url', content)
      )

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        E2ETestUtils.generateMockEmbeddings(chunks)
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 3,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Submit all ingestion requests concurrently
      const ingestPromises = testUrls.map(url => {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({ url }),
          headers: { 'Content-Type': 'application/json' }
        })
        return ingestPost(request)
      })

      const ingestResponses = await Promise.all(ingestPromises)
      const jobIds = await Promise.all(
        ingestResponses.map(response => response.json().then(data => data.jobId))
      )

      // Verify all jobs were queued successfully
      expect(jobIds).toHaveLength(5)
      jobIds.forEach(jobId => expect(jobId).toBeDefined())

      // Process all jobs concurrently
      const processingPromises = jobIds.map(jobId => processor.processJob(jobId))
      const processingResults = await Promise.all(processingPromises)

      // Verify all jobs completed successfully
      processingResults.forEach(result => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBe(3)
        expect(result.errors).toHaveLength(0)
      })

      // Verify all jobs reached completion
      const completionPromises = jobIds.map(jobId => E2ETestUtils.waitForJobCompletion(jobId))
      const completedJobs = await Promise.all(completionPromises)

      completedJobs.forEach(job => {
        expect(job.status).toBe('COMPLETED')
        expect(job.progress.pagesProcessed).toBe(1)
        expect(job.progress.chunksCreated).toBe(3)
      })

      // Verify database contains all chunks
      const allStoredChunks = await prisma.documentChunk.findMany({
        where: {
          sourceUrl: {
            in: testUrls
          }
        }
      })

      expect(allStoredChunks).toHaveLength(15) // 5 URLs * 3 chunks each
    })

    it('should respect resource limits and queue management', async () => {
      // Create more jobs than the concurrent limit
      const testUrls = Array.from({ length: 8 }, (_, i) => 
        E2ETestUtils.generateTestDocumentationUrl(`resource-limit-${i}`)
      )

      // Mock services with artificial delays to test queuing
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => {
        // Add delay to simulate real processing time
        await new Promise(resolve => setTimeout(resolve, 100))
        return E2ETestUtils.generateMockScrapedContent(url)
      })

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return E2ETestUtils.generateMockChunks(metadata.sourceUrl || 'test-url', content)
      })

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return E2ETestUtils.generateMockEmbeddings(chunks)
      })

      vi.spyOn(vectorStore, 'storeBatch').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        return {
          stored: 3,
          updated: 0,
          failed: 0,
          errors: []
        }
      })

      // Submit all jobs
      const jobIds: string[] = []
      for (const url of testUrls) {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({ url }),
          headers: { 'Content-Type': 'application/json' }
        })
        const response = await ingestPost(request)
        const data = await response.json()
        jobIds.push(data.jobId)
      }

      // Track processing start times
      const processingStartTimes: Record<string, number> = {}
      const processingPromises = jobIds.map(async (jobId) => {
        processingStartTimes[jobId] = Date.now()
        return processor.processJob(jobId)
      })

      const results = await Promise.all(processingPromises)

      // Verify all jobs completed successfully
      results.forEach(result => {
        expect(result.success).toBe(true)
      })

      // Verify that not all jobs started simultaneously (respecting concurrency limits)
      const startTimes = Object.values(processingStartTimes)
      const timeSpread = Math.max(...startTimes) - Math.min(...startTimes)
      expect(timeSpread).toBeGreaterThan(0) // Some jobs should have started later than others
    })
  })

  describe('Error Handling Across the Entire Pipeline', () => {
    it('should handle URL validation failures gracefully', async () => {
      const invalidUrl = 'invalid-url-format'

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: false,
        errors: ['Invalid URL format', 'URL not accessible'],
        sanitizedUrl: undefined
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: invalidUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.errors.some(error => 
        error.includes('URL validation failed')
      )).toBe(true)

      const failedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(failedJob.status).toBe('FAILED')
      expect(failedJob.errorMessage).toContain('URL validation failed')
    })

    it('should handle web scraping failures with retries', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('scraping-failure')

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      // Mock scraper to fail on first attempt, succeed on second
      let attemptCount = 0
      vi.spyOn(webScraper, 'scrape').mockImplementation(async () => {
        attemptCount++
        if (attemptCount === 1) {
          throw new Error('Network timeout')
        }
        return E2ETestUtils.generateMockScrapedContent(testUrl)
      })

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        E2ETestUtils.generateMockChunks(metadata.sourceUrl || testUrl, content)
      )

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        E2ETestUtils.generateMockEmbeddings(chunks)
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 3,
        updated: 0,
        failed: 0,
        errors: []
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      // Should succeed after retry
      expect(result.success).toBe(true)
      expect(webScraper.scrape).toHaveBeenCalledTimes(2) // First failed, second succeeded

      const completedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(completedJob.status).toBe('COMPLETED')
    })

    it('should handle embedding service failures', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('embedding-failure')

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue(
        E2ETestUtils.generateMockScrapedContent(testUrl)
      )

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        E2ETestUtils.generateMockChunks(metadata.sourceUrl || testUrl, content)
      )

      // Mock embedding service to fail
      vi.spyOn(embeddingService, 'generateEmbeddings').mockRejectedValue(
        new Error('AWS Bedrock rate limit exceeded')
      )

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.errors.some(error => 
        error.includes('Embedding generation failed') || 
        error.includes('AWS Bedrock rate limit exceeded')
      )).toBe(true)

      const failedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(failedJob.status).toBe('FAILED')
    })

    it('should handle vector storage failures', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('storage-failure')

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue(
        E2ETestUtils.generateMockScrapedContent(testUrl)
      )

      const mockChunks = E2ETestUtils.generateMockChunks(testUrl, 'test content')
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(mockChunks)

      const mockEmbeddedChunks = E2ETestUtils.generateMockEmbeddings(mockChunks)
      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(mockEmbeddedChunks)

      // Mock vector store to fail
      vi.spyOn(vectorStore, 'storeBatch').mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      expect(result.success).toBe(false)
      expect(result.errors.some(error => 
        error.includes('Vector storage failed') || 
        error.includes('Database connection failed')
      )).toBe(true)

      const failedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(failedJob.status).toBe('FAILED')
    })

    it('should handle partial failures and continue processing', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('partial-failure')

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue(
        E2ETestUtils.generateMockScrapedContent(testUrl)
      )

      const mockChunks = E2ETestUtils.generateMockChunks(testUrl, 'test content')
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(mockChunks)

      const mockEmbeddedChunks = E2ETestUtils.generateMockEmbeddings(mockChunks)
      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(mockEmbeddedChunks)

      // Mock vector store with partial failure
      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 2,
        updated: 0,
        failed: 1,
        errors: ['Failed to store chunk-3: Vector dimension mismatch']
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)

      // Should still succeed with partial results
      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(2) // Only successfully stored chunks
      expect(result.errors).toHaveLength(0) // Partial failures don't count as errors

      const completedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(completedJob.status).toBe('COMPLETED')
      expect(completedJob.progress.chunksEmbedded).toBe(2)
    })
  })

  describe('Performance and Scalability Validation', () => {
    it('should handle large document processing within time limits', async () => {
      const testUrl = E2ETestUtils.generateTestDocumentationUrl('large-document')
      
      // Generate large content (simulate a comprehensive API documentation)
      const largeContent = Array.from({ length: 50 }, (_, i) => 
        `Section ${i + 1}: ${'This is a detailed section with comprehensive information. '.repeat(20)}`
      ).join('\n\n')

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: testUrl,
        title: 'Large API Documentation',
        content: largeContent,
        metadata: {
          title: 'Large API Documentation',
          description: 'Comprehensive API documentation',
          section: 'Overview'
        },
        links: []
      })

      // Generate many chunks for large content
      const manyChunks = Array.from({ length: 25 }, (_, i) => ({
        id: `large-chunk-${i + 1}`,
        content: `Chunk ${i + 1}: ${'Detailed content for this chunk. '.repeat(15)}`,
        metadata: {
          sourceUrl: testUrl,
          title: 'Large API Documentation',
          section: `Section ${Math.floor(i / 5) + 1}`,
          chunkIndex: i
        },
        tokenCount: 200
      }))

      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(manyChunks)

      const mockEmbeddedChunks = E2ETestUtils.generateMockEmbeddings(manyChunks)
      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(mockEmbeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: manyChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const startTime = Date.now()

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await ingestPost(request)
      const data = await response.json()
      const jobId = data.jobId

      const result = await processor.processJob(jobId)
      const processingTime = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(result.totalChunks).toBe(manyChunks.length)
      expect(processingTime).toBeLessThan(10000) // Should complete within 10 seconds

      const completedJob = await E2ETestUtils.waitForJobCompletion(jobId)
      expect(completedJob.status).toBe('COMPLETED')
      expect(completedJob.progress.chunksCreated).toBe(manyChunks.length)
    })

    it('should maintain performance under memory pressure', async () => {
      const testUrls = Array.from({ length: 3 }, (_, i) => 
        E2ETestUtils.generateTestDocumentationUrl(`memory-test-${i}`)
      )

      // Mock services to simulate memory-intensive operations
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => {
        // Simulate large content
        const largeContent = 'Large content section. '.repeat(1000)
        return E2ETestUtils.generateMockScrapedContent(url, 10) // 10 sections
      })

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => {
        // Generate many chunks
        return Array.from({ length: 20 }, (_, i) => ({
          id: `memory-chunk-${i}`,
          content: `Chunk ${i}: ${'Content '.repeat(100)}`,
          metadata: {
            sourceUrl: metadata.sourceUrl || 'test-url',
            title: 'Memory Test Documentation',
            section: `Section ${Math.floor(i / 4) + 1}`,
            chunkIndex: i
          },
          tokenCount: 400
        }))
      })

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        E2ETestUtils.generateMockEmbeddings(chunks)
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 20,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Process all URLs concurrently to create memory pressure
      const processingPromises = testUrls.map(async (url) => {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({ url }),
          headers: { 'Content-Type': 'application/json' }
        })

        const response = await ingestPost(request)
        const data = await response.json()
        return processor.processJob(data.jobId)
      })

      const results = await Promise.all(processingPromises)

      // All jobs should complete successfully despite memory pressure
      results.forEach(result => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBe(20)
      })

      // Verify memory cleanup - check that we don't have excessive chunks in memory
      const totalStoredChunks = await prisma.documentChunk.count({
        where: {
          sourceUrl: {
            in: testUrls
          }
        }
      })

      expect(totalStoredChunks).toBe(60) // 3 URLs * 20 chunks each
    })
  })
})