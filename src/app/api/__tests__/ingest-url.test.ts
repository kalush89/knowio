import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../ingest-url/route'
import { jobQueue } from '../../../lib/jobs/queue'

// Mock the job queue
vi.mock('../../../lib/jobs/queue', () => ({
  jobQueue: {
    enqueue: vi.fn()
  }
}))

describe('/api/ingest-url', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('POST', () => {
    it('should enqueue a valid ingestion job', async () => {
      const mockJobId = 'job-123'
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://api.example.com/docs',
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

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(202)
      expect(data).toEqual({
        jobId: mockJobId,
        status: 'queued',
        message: 'Document ingestion job has been queued successfully'
      })

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'https://api.example.com/docs',
        {
          maxDepth: 2,
          followLinks: true,
          respectRobots: true
        }
      )
    })

    it('should handle invalid URL', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: 'invalid-url'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.message).toBe('Request validation failed')
      expect(data.details).toBeDefined()
      expect(jobQueue.enqueue).not.toHaveBeenCalled()
    })

    it('should handle missing URL', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid request data')
      expect(data.message).toBe('Request validation failed')
      expect(data.details).toBeDefined()
      expect(jobQueue.enqueue).not.toHaveBeenCalled()
    })

    it('should handle job queue errors', async () => {
      vi.mocked(jobQueue.enqueue).mockRejectedValue(new Error('Database connection failed'))

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://api.example.com/docs'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
      expect(data.message).toBe('Failed to enqueue ingestion job')
    })

    it('should use default options when not provided', async () => {
      const mockJobId = 'job-456'
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://api.example.com/docs'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(202)
      expect(data.jobId).toBe(mockJobId)

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'https://api.example.com/docs',
        {}
      )
    })

    it('should handle invalid JSON body', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: 'invalid json',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid JSON')
      expect(data.message).toBe('Request body must be valid JSON')
      expect(jobQueue.enqueue).not.toHaveBeenCalled()
    })

    it('should reject non-HTTP/HTTPS URLs', async () => {
      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: 'ftp://example.com/docs'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invalid URL protocol')
      expect(data.message).toBe('URL must use HTTP or HTTPS protocol')
      expect(jobQueue.enqueue).not.toHaveBeenCalled()
    })

    it('should sanitize URL by trimming whitespace', async () => {
      const mockJobId = 'job-789'
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)

      const request = new NextRequest('http://localhost:3000/api/ingest-url', {
        method: 'POST',
        body: JSON.stringify({
          url: '  https://api.example.com/docs  '
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(202)
      expect(data.jobId).toBe(mockJobId)

      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'https://api.example.com/docs',
        {}
      )
    })

    it('should enforce rate limiting', async () => {
      const mockJobId = 'job-rate-limit'
      vi.mocked(jobQueue.enqueue).mockResolvedValue(mockJobId)

      // Make multiple requests quickly to trigger rate limit
      const requests = Array.from({ length: 12 }, (_, i) => 
        new NextRequest('http://localhost:3000/api/ingest-url', {
          method: 'POST',
          body: JSON.stringify({
            url: `https://api.example.com/docs${i}`
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '192.168.1.1'
          }
        })
      )

      const responses = await Promise.all(requests.map(req => POST(req)))
      
      // First 10 should succeed
      for (let i = 0; i < 10; i++) {
        expect(responses[i].status).toBe(202)
      }
      
      // 11th and 12th should be rate limited
      expect(responses[10].status).toBe(429)
      expect(responses[11].status).toBe(429)
      
      const rateLimitData = await responses[10].json()
      expect(rateLimitData.error).toBe('Rate limit exceeded')
      expect(rateLimitData.retryAfter).toBeGreaterThan(0)
    })
  })
})