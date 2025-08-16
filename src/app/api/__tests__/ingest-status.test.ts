import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../ingest-status/[jobId]/route'
import { jobQueue } from '../../../lib/jobs/queue'
import { IngestionJob } from '../../../lib/types'

// Mock the job queue
vi.mock('../../../lib/jobs/queue', () => ({
  jobQueue: {
    getStatus: vi.fn()
  }
}))

describe('/api/ingest-status/[jobId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('GET', () => {
    it('should return job status when job exists', async () => {
      const mockJob: IngestionJob = {
        id: 'job-123',
        url: 'https://api.example.com/docs',
        status: 'PROCESSING',
        options: { maxDepth: 2, followLinks: true },
        progress: {
          pagesProcessed: 1,
          chunksCreated: 5,
          chunksEmbedded: 3,
          errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z')
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(mockJob)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-123')
      const response = await GET(request, { params: { jobId: 'job-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        jobId: 'job-123',
        url: 'https://api.example.com/docs',
        status: 'processing',
        options: { maxDepth: 2, followLinks: true },
        progress: {
          pagesProcessed: 1,
          chunksCreated: 5,
          chunksEmbedded: 3,
          errors: []
        },
        timestamps: {
          createdAt: '2024-01-01T10:00:00.000Z',
          startedAt: '2024-01-01T10:01:00.000Z'
        }
      })

      expect(jobQueue.getStatus).toHaveBeenCalledWith('job-123')
    })

    it('should return 404 when job does not exist', async () => {
      vi.mocked(jobQueue.getStatus).mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/clabcd1234567890123456789')
      const response = await GET(request, { params: { jobId: 'clabcd1234567890123456789' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Job not found')
      expect(data.message).toBe('No job found with ID: clabcd1234567890123456789')
    })

    it('should return 400 when jobId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-status/')
      const response = await GET(request, { params: { jobId: '' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid job ID')
      expect(data.message).toBe('Job ID must be a non-empty string')
      expect(jobQueue.getStatus).not.toHaveBeenCalled()
    })

    it('should handle database errors', async () => {
      vi.mocked(jobQueue.getStatus).mockRejectedValue(new Error('Database connection failed'))

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-123')
      const response = await GET(request, { params: { jobId: 'job-123' } })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
      expect(data.message).toBe('Failed to get job status')
    })

    it('should return completed job with results', async () => {
      const mockJob: IngestionJob = {
        id: 'job-456',
        url: 'https://api.example.com/docs',
        status: 'COMPLETED',
        options: { respectRobots: true },
        progress: {
          pagesProcessed: 3,
          chunksCreated: 15,
          chunksEmbedded: 15,
          errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z')
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(mockJob)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-456')
      const response = await GET(request, { params: { jobId: 'job-456' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('completed')
      expect(data.timestamps.completedAt).toBe('2024-01-01T10:05:00.000Z')
      expect(data.progress.chunksEmbedded).toBe(15)
      expect(data.progress.completionRate).toBe(100)
      expect(data.timestamps.processingDuration).toBe(240000) // 4 minutes
    })

    it('should return failed job with error message', async () => {
      const mockJob: IngestionJob = {
        id: 'job-789',
        url: 'https://invalid-url.com',
        status: 'FAILED',
        options: {},
        progress: {
          pagesProcessed: 0,
          chunksCreated: 0,
          chunksEmbedded: 0,
          errors: ['URL validation failed']
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z'),
        completedAt: new Date('2024-01-01T10:01:30Z'),
        errorMessage: 'URL validation failed: Invalid URL format'
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(mockJob)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-789')
      const response = await GET(request, { params: { jobId: 'job-789' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.status).toBe('failed')
      expect(data.errorMessage).toBe('URL validation failed: Invalid URL format')
      expect(data.progress.errors).toContain('URL validation failed')
      expect(data.timestamps.processingDuration).toBe(30000) // 30 seconds
    })

    it('should validate job ID format', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-status/invalid@id!')
      const response = await GET(request, { params: { jobId: 'invalid@id!' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid job ID format')
      expect(data.message).toBe('Job ID must be a valid identifier')
      expect(jobQueue.getStatus).not.toHaveBeenCalled()
    })

    it('should handle whitespace in job ID', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-status/  ')
      const response = await GET(request, { params: { jobId: '  ' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid job ID')
      expect(data.message).toBe('Job ID must be a non-empty string')
      expect(jobQueue.getStatus).not.toHaveBeenCalled()
    })

    it('should set appropriate cache headers for completed jobs', async () => {
      const mockJob: IngestionJob = {
        id: 'job-completed',
        url: 'https://api.example.com/docs',
        status: 'COMPLETED',
        options: {},
        progress: {
          pagesProcessed: 1,
          chunksCreated: 5,
          chunksEmbedded: 5,
          errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z'),
        completedAt: new Date('2024-01-01T10:05:00Z')
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(mockJob)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-completed')
      const response = await GET(request, { params: { jobId: 'job-completed' } })

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    })

    it('should not cache in-progress jobs', async () => {
      const mockJob: IngestionJob = {
        id: 'job-processing',
        url: 'https://api.example.com/docs',
        status: 'PROCESSING',
        options: {},
        progress: {
          pagesProcessed: 1,
          chunksCreated: 3,
          chunksEmbedded: 1,
          errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z')
      }

      vi.mocked(jobQueue.getStatus).mockResolvedValue(mockJob)

      const request = new NextRequest('http://localhost:3000/api/ingest-status/job-processing')
      const response = await GET(request, { params: { jobId: 'job-processing' } })

      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-cache')
    })
  })
})