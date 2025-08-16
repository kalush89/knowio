import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as ingestPost } from '../ingest-url/route'
import { GET as statusGet } from '../ingest-status/[jobId]/route'
import { jobQueue } from '../../../lib/jobs/queue'
import { IngestionJob } from '../../../lib/types'

// Mock the job queue
vi.mock('../../../lib/jobs/queue', () => ({
  jobQueue: {
    enqueue: vi.fn(),
    getStatus: vi.fn()
  }
}))

describe('API Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('Complete ingestion workflow', () => {
    it('should handle complete ingestion workflow from request to completion', async () => {
      const mockJobId = 'job-integration-test'
      const testUrl = 'https://api.example.com/docs'
      
      // Mock job creation
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)
      
      // Step 1: Submit ingestion request
      const ingestRequest = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: testUrl,
          options: {
            maxDepth: 3,
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
      expect(ingestData.jobId).toBe(mockJobId)
      expect(ingestData.status).toBe('queued')
      expect(jobQueue.enqueue).toHaveBeenCalledWith(testUrl, {
        maxDepth: 3,
        followLinks: true,
        respectRobots: true
      })

      // Step 2: Check initial status (queued)
      const queuedJob: IngestionJob = {
        id: mockJobId,
        url: testUrl,
        status: 'QUEUED',
        options: { maxDepth: 3, followLinks: true, respectRobots: true },
        progress: {
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z')
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(queuedJob)

      const statusRequest1 = new NextRequest(`http://localhost:3000/api/ingest-status/${mockJobId}`)
      const statusResponse1 = await statusGet(statusRequest1, { params: { jobId: mockJobId } })
      const statusData1 = await statusResponse1.json()

      expect(statusResponse1.status).toBe(200)
      expect(statusData1.status).toBe('queued')
      expect(statusData1.progress.pagesProcessed).toBe(0)

      // Step 3: Check processing status
      const processingJob: IngestionJob = {
        ...queuedJob,
        status: 'PROCESSING',
        startedAt: new Date('2024-01-01T10:01:00Z'),
        progress: {
          pagesProcessed: 2,
          chunksCreated: 8,
          chunksEmbedded: 5,
          errors: []
        }
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(processingJob)

      const statusRequest2 = new NextRequest(`http://localhost:3000/api/ingest-status/${mockJobId}`)
      const statusResponse2 = await statusGet(statusRequest2, { params: { jobId: mockJobId } })
      const statusData2 = await statusResponse2.json()

      expect(statusResponse2.status).toBe(200)
      expect(statusData2.status).toBe('processing')
      expect(statusData2.progress.pagesProcessed).toBe(2)
      expect(statusData2.progress.chunksCreated).toBe(8)
      expect(statusData2.progress.chunksEmbedded).toBe(5)
      expect(statusResponse2.headers.get('Cache-Control')).toBe('no-cache')

      // Step 4: Check completed status
      const completedJob: IngestionJob = {
        ...processingJob,
        status: 'COMPLETED',
        completedAt: new Date('2024-01-01T10:05:00Z'),
        progress: {
          pagesProcessed: 5,
          chunksCreated: 20,
          chunksEmbedded: 20,
          errors: []
        }
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(completedJob)

      const statusRequest3 = new NextRequest(`http://localhost:3000/api/ingest-status/${mockJobId}`)
      const statusResponse3 = await statusGet(statusRequest3, { params: { jobId: mockJobId } })
      const statusData3 = await statusResponse3.json()

      expect(statusResponse3.status).toBe(200)
      expect(statusData3.status).toBe('completed')
      expect(statusData3.progress.pagesProcessed).toBe(5)
      expect(statusData3.progress.chunksCreated).toBe(20)
      expect(statusData3.progress.chunksEmbedded).toBe(20)
      expect(statusData3.progress.completionRate).toBe(100)
      expect(statusData3.timestamps.processingDuration).toBe(240000) // 4 minutes
      expect(statusResponse3.headers.get('Cache-Control')).toBe('public, max-age=3600')
    })

    it('should handle failed ingestion workflow', async () => {
      const mockJobId = 'job-failed-test'
      const testUrl = 'https://invalid-site.example.com/docs'
      
      // Mock job creation
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)
      
      // Step 1: Submit ingestion request
      const ingestRequest = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: testUrl
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const ingestResponse = await ingestPost(ingestRequest)
      const ingestData = await ingestResponse.json()

      expect(ingestResponse.status).toBe(202)
      expect(ingestData.jobId).toBe(mockJobId)

      // Step 2: Check failed status
      const failedJob: IngestionJob = {
        id: mockJobId,
        url: testUrl,
        status: 'FAILED',
        options: {},
        progress: {
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: ['Network timeout', 'Site unreachable']
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z'),
        completedAt: new Date('2024-01-01T10:01:30Z'),
        errorMessage: 'Failed to scrape content: Network timeout'
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(failedJob)

      const statusRequest = new NextRequest(`http://localhost:3000/api/ingest-status/${mockJobId}`)
      const statusResponse = await statusGet(statusRequest, { params: { jobId: mockJobId } })
      const statusData = await statusResponse.json()

      expect(statusResponse.status).toBe(200)
      expect(statusData.status).toBe('failed')
      expect(statusData.errorMessage).toBe('Failed to scrape content: Network timeout')
      expect(statusData.progress.errors).toEqual(['Network timeout', 'Site unreachable'])
      expect(statusData.timestamps.processingDuration).toBe(30000) // 30 seconds
      expect(statusResponse.headers.get('Cache-Control')).toBe('public, max-age=3600')
    })

    it('should handle rate limiting across multiple requests', async () => {
      const mockJobIds = Array.from({ length: 15 }, (_, i) => `job-rate-${i}`)
      
      // Mock successful job creation for first 10 requests
      mockJobIds.slice(0, 10).forEach((jobId, index) => {
        vi.mocked(jobQueue.enqueue).mockResolvedValueOnce(jobId)
      })

      const requests = mockJobIds.map((_, i) => 
        new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({
            url: `https://api.example.com/docs${i}`
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '192.168.1.100' // Same IP for rate limiting
          }
        })
      )

      const responses = await Promise.all(requests.map(req => ingestPost(req)))
      
      // First 10 should succeed
      for (let i = 0; i < 10; i++) {
        expect(responses[i].status).toBe(202)
        const data = await responses[i].json()
        expect(data.jobId).toBe(mockJobIds[i])
      }
      
      // Remaining should be rate limited
      for (let i = 10; i < 15; i++) {
        expect(responses[i].status).toBe(429)
        const data = await responses[i].json()
        expect(data.error).toBe('Rate limit exceeded')
        expect(data.retryAfter).toBeGreaterThan(0)
      }
    })

    it('should validate request data and provide detailed error responses', async () => {
      const invalidRequests = [
        {
          name: 'missing URL',
          body: {},
          expectedError: 'Invalid request data',
          expectedDetails: expect.arrayContaining([
            expect.objectContaining({
              field: 'url',
              message: expect.stringContaining('expected string, received undefined')
            })
          ])
        },
        {
          name: 'invalid URL format',
          body: { url: 'not-a-url' },
          expectedError: 'Invalid request data',
          expectedDetails: expect.arrayContaining([
            expect.objectContaining({
              field: 'url',
              message: 'Invalid URL format'
            })
          ])
        },
        {
          name: 'invalid options',
          body: { 
            url: 'https://example.com',
            options: { maxDepth: 0 } // Below minimum
          },
          expectedError: 'Invalid request data',
          expectedDetails: expect.arrayContaining([
            expect.objectContaining({
              field: 'options.maxDepth',
              message: expect.stringContaining('>=1')
            })
          ])
        }
      ]

      for (const testCase of invalidRequests) {
        const request = new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify(testCase.body),
          headers: {
            'Content-Type': 'application/json'
          }
        })

        const response = await ingestPost(request)
        const data = await response.json()

        expect(response.status).toBe(400)
        expect(data.error).toBe(testCase.expectedError)
        expect(data.details).toEqual(testCase.expectedDetails)
      }
    })

    it('should handle various job ID validation scenarios', async () => {
      const testCases = [
        {
          name: 'empty job ID',
          jobId: '',
          expectedStatus: 400,
          expectedError: 'Invalid job ID'
        },
        {
          name: 'whitespace job ID',
          jobId: '   ',
          expectedStatus: 400,
          expectedError: 'Invalid job ID'
        },
        {
          name: 'invalid characters',
          jobId: 'job@123!',
          expectedStatus: 400,
          expectedError: 'Invalid job ID format'
        },
        {
          name: 'too short',
          jobId: 'ab',
          expectedStatus: 400,
          expectedError: 'Invalid job ID format'
        },
        {
          name: 'too long',
          jobId: 'a'.repeat(51),
          expectedStatus: 400,
          expectedError: 'Invalid job ID format'
        },
        {
          name: 'valid but non-existent',
          jobId: 'valid-job-id-123',
          expectedStatus: 404,
          expectedError: 'Job not found'
        }
      ]

      // Mock getStatus to return null for all calls (job not found)
      vi.mocked(jobQueue.getStatus).mockResolvedValue(null)

      for (const testCase of testCases) {
        const request = new NextRequest(`http://localhost:3000/api/ingest-status/${testCase.jobId}`)
        const response = await statusGet(request, { params: { jobId: testCase.jobId } })
        const data = await response.json()

        expect(response.status).toBe(testCase.expectedStatus)
        expect(data.error).toBe(testCase.expectedError)
      }
    })
  })
})