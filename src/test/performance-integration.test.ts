import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as ingestPost } from '../app/api/ingest-url/route'
import { GET as statusGet } from '../app/api/ingest-status/[jobId]/route'
import { JobProcessor } from '../lib/jobs/processor'
import { WebScraper } from '../lib/ingest/scraper'
import { ContentChunker } from '../lib/ingest/chunker'
import { URLValidator } from '../lib/ingest/validator'
import { EmbeddingService } from '../lib/embed/service'
import { VectorStore } from '../lib/vector/store'
import { JobQueue } from '../lib/jobs/queue'
import { prisma } from '../lib/db'

// Performance test utilities
class PerformanceTestUtils {
  static async measureExecutionTime<T>(operation: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = performance.now()
    const result = await operation()
    const endTime = performance.now()
    return {
      result,
      duration: endTime - startTime
    }
  }

  static generateLargeContent(sections: number = 50, wordsPerSection: number = 500): string {
    const words = [
      'API', 'documentation', 'endpoint', 'authentication', 'request', 'response', 'parameter',
      'header', 'body', 'method', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'status', 'code',
      'error', 'success', 'data', 'format', 'JSON', 'XML', 'schema', 'validation', 'security',
      'token', 'key', 'authorization', 'bearer', 'OAuth', 'rate', 'limit', 'throttling',
      'pagination', 'filtering', 'sorting', 'search', 'query', 'database', 'model', 'field',
      'relationship', 'foreign', 'primary', 'index', 'constraint', 'migration', 'seed'
    ]

    return Array.from({ length: sections }, (_, sectionIndex) => {
      const sectionTitle = `Section ${sectionIndex + 1}: Advanced API Concepts`
      const sectionContent = Array.from({ length: wordsPerSection }, () => 
        words[Math.floor(Math.random() * words.length)]
      ).join(' ')
      
      return `## ${sectionTitle}\n\n${sectionContent}\n\n`
    }).join('')
  }

  static generateManyChunks(sourceUrl: string, count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `perf-chunk-${i + 1}`,
      content: `Performance test chunk ${i + 1}: ${this.generateLargeContent(1, 100)}`,
      metadata: {
        sourceUrl,
        title: 'Performance Test Documentation',
        section: `Section ${Math.floor(i / 10) + 1}`,
        chunkIndex: i
      },
      tokenCount: 150 + Math.floor(Math.random() * 100)
    }))
  }

  static async cleanupPerformanceTestData() {
    await prisma.documentChunk.deleteMany({
      where: {
        sourceUrl: {
          contains: 'performance-test'
        }
      }
    })

    await prisma.ingestionJob.deleteMany({
      where: {
        url: {
          contains: 'performance-test'
        }
      }
    })
  }

  static async measureMemoryUsage(): Promise<{ heapUsed: number; heapTotal: number; external: number }> {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage()
      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      }
    }
    return { heapUsed: 0, heapTotal: 0, external: 0 }
  }
}

describe('Performance and Load Integration Tests', () => {
  let jobQueue: JobQueue
  let processor: JobProcessor
  let webScraper: WebScraper
  let contentChunker: ContentChunker
  let urlValidator: URLValidator
  let embeddingService: EmbeddingService
  let vectorStore: VectorStore

  beforeEach(async () => {
    await PerformanceTestUtils.cleanupPerformanceTestData()

    // Initialize services with performance-optimized settings
    jobQueue = new JobQueue({
      maxRetries: 1, // Reduce retries for faster testing
      retryDelay: 50,
      maxConcurrentJobs: 5, // Higher concurrency for load testing
      jobTimeout: 30000
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
        maxProcessingTime: 30000,
        enableProgressUpdates: true,
        batchSize: 10, // Larger batch size for performance
        maxRetries: 1
      }
    )

    vi.clearAllMocks()
  })

  afterEach(async () => {
    await PerformanceTestUtils.cleanupPerformanceTestData()
    vi.resetAllMocks()
  })

  describe('Large Document Processing Performance', () => {
    it('should process large documentation within acceptable time limits', async () => {
      const testUrl = 'https://performance-test-large-doc.example.com/docs'
      const largeContent = PerformanceTestUtils.generateLargeContent(100, 1000) // Very large document

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: testUrl,
        title: 'Large Performance Test Documentation',
        content: largeContent,
        metadata: {
          title: 'Large Performance Test Documentation',
          description: 'Performance testing with large content',
          section: 'Performance Test'
        },
        links: []
      })

      // Generate many chunks for large content
      const manyChunks = PerformanceTestUtils.generateManyChunks(testUrl, 200)
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(manyChunks)

      const embeddedChunks = manyChunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: manyChunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
        headers: { 'Content-Type': 'application/json' }
      })

      // Measure total processing time
      const { result: response, duration: requestDuration } = await PerformanceTestUtils.measureExecutionTime(
        () => ingestPost(request)
      )

      const data = await response.json()
      const jobId = data.jobId

      expect(response.status).toBe(202)
      expect(requestDuration).toBeLessThan(1000) // API response should be fast

      // Measure job processing time
      const { result: processingResult, duration: processingDuration } = await PerformanceTestUtils.measureExecutionTime(
        () => processor.processJob(jobId)
      )

      expect(processingResult.success).toBe(true)
      expect(processingResult.totalChunks).toBe(manyChunks.length)
      expect(processingDuration).toBeLessThan(25000) // Should complete within 25 seconds

      // Verify performance metrics
      console.log(`Large document processing metrics:`)
      console.log(`- Content size: ${largeContent.length} characters`)
      console.log(`- Chunks created: ${manyChunks.length}`)
      console.log(`- Processing time: ${processingDuration.toFixed(2)}ms`)
      console.log(`- Chunks per second: ${(manyChunks.length / (processingDuration / 1000)).toFixed(2)}`)

      // Performance assertions
      expect(processingDuration / manyChunks.length).toBeLessThan(125) // Less than 125ms per chunk on average
    })

    it('should handle memory efficiently during large document processing', async () => {
      const testUrl = 'https://performance-test-memory.example.com/docs'
      const largeContent = PerformanceTestUtils.generateLargeContent(50, 800)

      const initialMemory = await PerformanceTestUtils.measureMemoryUsage()

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: testUrl,
        title: 'Memory Test Documentation',
        content: largeContent,
        metadata: {
          title: 'Memory Test Documentation',
          section: 'Memory Test'
        },
        links: []
      })

      const chunks = PerformanceTestUtils.generateManyChunks(testUrl, 100)
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(chunks)

      const embeddedChunks = chunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: chunks.length,
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

      await processor.processJob(jobId)

      const finalMemory = await PerformanceTestUtils.measureMemoryUsage()

      // Memory usage should not increase dramatically
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed
      const memoryIncreasePerChunk = memoryIncrease / chunks.length

      console.log(`Memory usage metrics:`)
      console.log(`- Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- Memory per chunk: ${(memoryIncreasePerChunk / 1024).toFixed(2)} KB`)

      // Memory increase should be reasonable (less than 1MB per chunk)
      expect(memoryIncreasePerChunk).toBeLessThan(1024 * 1024) // 1MB per chunk
    })
  })

  describe('High Concurrency Load Testing', () => {
    it('should handle high concurrent load without degradation', async () => {
      const concurrentJobs = 10
      const testUrls = Array.from({ length: concurrentJobs }, (_, i) => 
        `https://performance-test-concurrent-${i}.example.com/docs`
      )

      // Mock services for all URLs
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => ({
        url,
        title: `Concurrent Test Documentation ${url}`,
        content: PerformanceTestUtils.generateLargeContent(10, 200),
        metadata: {
          title: `Concurrent Test Documentation ${url}`,
          section: 'Concurrent Test'
        },
        links: []
      }))

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        PerformanceTestUtils.generateManyChunks(metadata.sourceUrl || 'test-url', 20)
      )

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        chunks.map(chunk => ({
          ...chunk,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
          embeddedAt: new Date()
        }))
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 20,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Submit all requests concurrently and measure time
      const { result: responses, duration: submissionDuration } = await PerformanceTestUtils.measureExecutionTime(
        () => Promise.all(testUrls.map(url => {
          const request = new NextRequest('http://localhost:3000/api/ingest-url', {
            method: 'POST',
            body: JSON.stringify({ url }),
            headers: { 'Content-Type': 'application/json' }
          })
          return ingestPost(request)
        }))
      )

      const jobIds = await Promise.all(
        responses.map(response => response.json().then(data => data.jobId))
      )

      expect(responses.every(response => response.status === 202)).toBe(true)
      expect(submissionDuration).toBeLessThan(5000) // All submissions should complete quickly

      // Process all jobs concurrently and measure time
      const { result: results, duration: processingDuration } = await PerformanceTestUtils.measureExecutionTime(
        () => Promise.all(jobIds.map(jobId => processor.processJob(jobId)))
      )

      // All jobs should complete successfully
      results.forEach((result, index) => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBe(20)
        expect(result.errors).toHaveLength(0)
      })

      console.log(`Concurrent processing metrics:`)
      console.log(`- Concurrent jobs: ${concurrentJobs}`)
      console.log(`- Submission time: ${submissionDuration.toFixed(2)}ms`)
      console.log(`- Processing time: ${processingDuration.toFixed(2)}ms`)
      console.log(`- Average time per job: ${(processingDuration / concurrentJobs).toFixed(2)}ms`)

      // Performance assertions
      expect(processingDuration).toBeLessThan(30000) // All jobs should complete within 30 seconds
      expect(processingDuration / concurrentJobs).toBeLessThan(5000) // Average time per job should be reasonable
    })

    it('should maintain throughput under sustained load', async () => {
      const batchSize = 5
      const numberOfBatches = 3
      const totalJobs = batchSize * numberOfBatches

      const allJobIds: string[] = []
      const batchTimes: number[] = []

      // Mock services
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => ({
        url,
        title: 'Sustained Load Test Documentation',
        content: PerformanceTestUtils.generateLargeContent(5, 100),
        metadata: {
          title: 'Sustained Load Test Documentation',
          section: 'Load Test'
        },
        links: []
      }))

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        PerformanceTestUtils.generateManyChunks(metadata.sourceUrl || 'test-url', 10)
      )

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        chunks.map(chunk => ({
          ...chunk,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
          embeddedAt: new Date()
        }))
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 10,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Process batches sequentially to test sustained load
      for (let batch = 0; batch < numberOfBatches; batch++) {
        const batchUrls = Array.from({ length: batchSize }, (_, i) => 
          `https://performance-test-sustained-${batch}-${i}.example.com/docs`
        )

        const { result: batchResponses, duration: batchDuration } = await PerformanceTestUtils.measureExecutionTime(
          async () => {
            // Submit batch
            const responses = await Promise.all(batchUrls.map(url => {
              const request = new NextRequest('http://localhost:3000/api/ingest-url', {
                method: 'POST',
                body: JSON.stringify({ url }),
                headers: { 'Content-Type': 'application/json' }
              })
              return ingestPost(request)
            }))

            const jobIds = await Promise.all(
              responses.map(response => response.json().then(data => data.jobId))
            )

            // Process batch
            await Promise.all(jobIds.map(jobId => processor.processJob(jobId)))

            return jobIds
          }
        )

        allJobIds.push(...batchResponses)
        batchTimes.push(batchDuration)

        console.log(`Batch ${batch + 1} completed in ${batchDuration.toFixed(2)}ms`)
      }

      // Verify throughput consistency
      const averageBatchTime = batchTimes.reduce((sum, time) => sum + time, 0) / batchTimes.length
      const maxBatchTime = Math.max(...batchTimes)
      const minBatchTime = Math.min(...batchTimes)

      console.log(`Sustained load metrics:`)
      console.log(`- Total jobs: ${totalJobs}`)
      console.log(`- Average batch time: ${averageBatchTime.toFixed(2)}ms`)
      console.log(`- Min batch time: ${minBatchTime.toFixed(2)}ms`)
      console.log(`- Max batch time: ${maxBatchTime.toFixed(2)}ms`)
      console.log(`- Throughput variation: ${((maxBatchTime - minBatchTime) / averageBatchTime * 100).toFixed(2)}%`)

      // Performance assertions
      expect(allJobIds).toHaveLength(totalJobs)
      expect(maxBatchTime - minBatchTime).toBeLessThan(averageBatchTime * 0.5) // Variation should be less than 50%
      expect(averageBatchTime).toBeLessThan(15000) // Average batch should complete within 15 seconds
    })
  })

  describe('Resource Management and Cleanup', () => {
    it('should properly clean up resources after processing', async () => {
      const testUrl = 'https://performance-test-cleanup.example.com/docs'

      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: testUrl
      })

      vi.spyOn(webScraper, 'scrape').mockResolvedValue({
        url: testUrl,
        title: 'Cleanup Test Documentation',
        content: PerformanceTestUtils.generateLargeContent(20, 300),
        metadata: {
          title: 'Cleanup Test Documentation',
          section: 'Cleanup Test'
        },
        links: []
      })

      const chunks = PerformanceTestUtils.generateManyChunks(testUrl, 50)
      vi.spyOn(contentChunker, 'chunk').mockResolvedValue(chunks)

      const embeddedChunks = chunks.map(chunk => ({
        ...chunk,
        embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
        embeddedAt: new Date()
      }))

      vi.spyOn(embeddingService, 'generateEmbeddings').mockResolvedValue(embeddedChunks)

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: chunks.length,
        updated: 0,
        failed: 0,
        errors: []
      })

      const initialMemory = await PerformanceTestUtils.measureMemoryUsage()

      // Process multiple jobs to test resource cleanup
      const jobIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({ url: `${testUrl}-${i}` }),
          headers: { 'Content-Type': 'application/json' }
        })

        const response = await ingestPost(request)
        const data = await response.json()
        jobIds.push(data.jobId)

        await processor.processJob(data.jobId)
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc()
      }

      const finalMemory = await PerformanceTestUtils.measureMemoryUsage()

      // Verify all jobs completed
      const completedJobs = await prisma.ingestionJob.findMany({
        where: {
          id: {
            in: jobIds
          }
        }
      })

      expect(completedJobs).toHaveLength(3)
      completedJobs.forEach(job => {
        expect(job.status).toBe('COMPLETED')
      })

      // Memory should not grow excessively
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed
      const memoryGrowthPerJob = memoryGrowth / jobIds.length

      console.log(`Resource cleanup metrics:`)
      console.log(`- Jobs processed: ${jobIds.length}`)
      console.log(`- Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)} MB`)
      console.log(`- Memory growth per job: ${(memoryGrowthPerJob / 1024 / 1024).toFixed(2)} MB`)

      // Memory growth should be reasonable
      expect(memoryGrowthPerJob).toBeLessThan(50 * 1024 * 1024) // Less than 50MB per job
    })

    it('should handle database connection pooling efficiently', async () => {
      const concurrentConnections = 8
      const testUrls = Array.from({ length: concurrentConnections }, (_, i) => 
        `https://performance-test-db-${i}.example.com/docs`
      )

      // Mock services
      vi.spyOn(urlValidator, 'validate').mockResolvedValue({
        isValid: true,
        errors: [],
        sanitizedUrl: 'test-url'
      })

      vi.spyOn(webScraper, 'scrape').mockImplementation(async (url) => ({
        url,
        title: 'DB Connection Test Documentation',
        content: PerformanceTestUtils.generateLargeContent(5, 100),
        metadata: {
          title: 'DB Connection Test Documentation',
          section: 'DB Test'
        },
        links: []
      }))

      vi.spyOn(contentChunker, 'chunk').mockImplementation(async (content, metadata) => 
        PerformanceTestUtils.generateManyChunks(metadata.sourceUrl || 'test-url', 15)
      )

      vi.spyOn(embeddingService, 'generateEmbeddings').mockImplementation(async (chunks) => 
        chunks.map(chunk => ({
          ...chunk,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 0.1),
          embeddedAt: new Date()
        }))
      )

      vi.spyOn(vectorStore, 'storeBatch').mockResolvedValue({
        stored: 15,
        updated: 0,
        failed: 0,
        errors: []
      })

      // Process all URLs concurrently to stress database connections
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

      const { result: results, duration: totalDuration } = await PerformanceTestUtils.measureExecutionTime(
        () => Promise.all(processingPromises)
      )

      // All jobs should complete successfully despite concurrent database access
      results.forEach(result => {
        expect(result.success).toBe(true)
        expect(result.totalChunks).toBe(15)
      })

      console.log(`Database connection metrics:`)
      console.log(`- Concurrent connections: ${concurrentConnections}`)
      console.log(`- Total processing time: ${totalDuration.toFixed(2)}ms`)
      console.log(`- Average time per connection: ${(totalDuration / concurrentConnections).toFixed(2)}ms`)

      // Should handle concurrent connections efficiently
      expect(totalDuration).toBeLessThan(25000) // Should complete within 25 seconds
      expect(results.every(result => result.success)).toBe(true)
    })
  })
})