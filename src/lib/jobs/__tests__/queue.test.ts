import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JobQueue } from '../queue'
import { prisma } from '../../db'
import { inngest } from '../../inngest'

// Mock Inngest
vi.mock('../../inngest', () => ({
  inngest: {
    send: vi.fn()
  }
}))

// Mock Prisma
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

describe('JobQueue', () => {
  let jobQueue: JobQueue

  beforeEach(() => {
    jobQueue = new JobQueue({
      maxRetries: 3,
      retryDelay: 1000,
      maxConcurrentJobs: 5,
      jobTimeout: 60000
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('enqueue', () => {
    it('should create a new job and send Inngest event', async () => {
      const mockJob = {
        id: 'job-123',
        url: 'https://example.com/docs',
        status: 'QUEUED',
        options: '{}',
        progress: '{"pagesProcessed":0,"chunksCreated":0,"chunksEmbedded":0,"errors":[]}'
      }

      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockJob as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      const jobId = await jobQueue.enqueue('https://example.com/docs', {
        maxDepth: 2,
        followLinks: true
      })

      expect(jobId).toBe('job-123')
      expect(prisma.ingestionJob.create).toHaveBeenCalledWith({
        data: {
          url: 'https://example.com/docs',
          status: 'QUEUED',
          options: JSON.stringify({ maxDepth: 2, followLinks: true }),
          progress: JSON.stringify({
            pagesProcessed: 0,
            chunksCreated: 0,
            chunksEmbedded: 0,
            errors: []
          })
        }
      })
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.started',
        data: {
          jobId: 'job-123',
          url: 'https://example.com/docs',
          options: { maxDepth: 2, followLinks: true }
        }
      })
    })

    it('should handle database errors', async () => {
      vi.mocked(prisma.ingestionJob.create).mockRejectedValue(new Error('Database error'))

      await expect(jobQueue.enqueue('https://example.com/docs')).rejects.toThrow('Failed to enqueue job: Database error')
    })
  })

  describe('getStatus', () => {
    it('should return job status when job exists', async () => {
      const mockJob = {
        id: 'job-123',
        url: 'https://example.com/docs',
        status: 'PROCESSING',
        options: '{"maxDepth":2}',
        progress: '{"pagesProcessed":1,"chunksCreated":5,"chunksEmbedded":3,"errors":[]}',
        createdAt: new Date('2024-01-01'),
        startedAt: new Date('2024-01-01T10:00:00'),
        completedAt: null,
        errorMessage: null
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)

      const result = await jobQueue.getStatus('job-123')

      expect(result).toEqual({
        id: 'job-123',
        url: 'https://example.com/docs',
        status: 'PROCESSING',
        options: { maxDepth: 2 },
        progress: {
          pagesProcessed: 1,
          chunksCreated: 5,
          chunksEmbedded: 3,
          errors: []
        },
        createdAt: new Date('2024-01-01'),
        startedAt: new Date('2024-01-01T10:00:00'),
        completedAt: undefined,
        errorMessage: undefined
      })
    })

    it('should return null when job does not exist', async () => {
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(null)

      const result = await jobQueue.getStatus('nonexistent-job')

      expect(result).toBeNull()
    })
  })

  describe('updateProgress', () => {
    it('should update job progress and send event', async () => {
      const mockJob = {
        id: 'job-123',
        progress: '{"pagesProcessed":0,"chunksCreated":0,"chunksEmbedded":0,"errors":[]}'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      await jobQueue.updateProgress('job-123', {
        pagesProcessed: 2,
        chunksCreated: 10
      })

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          progress: JSON.stringify({
            pagesProcessed: 2,
            chunksCreated: 10,
            chunksEmbedded: 0,
            errors: []
          })
        }
      })
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.progress',
        data: {
          jobId: 'job-123',
          pagesProcessed: 2,
          chunksCreated: 10,
          chunksEmbedded: 0,
          errors: []
        }
      })
    })

    it('should throw error when job not found', async () => {
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(null)

      await expect(jobQueue.updateProgress('nonexistent-job', { pagesProcessed: 1 }))
        .rejects.toThrow('Job nonexistent-job not found')
    })
  })

  describe('updateStatus', () => {
    it('should update job status with timestamps', async () => {
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)

      await jobQueue.updateStatus('job-123', 'PROCESSING')

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'PROCESSING',
          startedAt: expect.any(Date)
        }
      })
    })

    it('should set completedAt for terminal statuses', async () => {
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)

      await jobQueue.updateStatus('job-123', 'COMPLETED')

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date)
        }
      })
    })

    it('should include error message for failed status', async () => {
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)

      await jobQueue.updateStatus('job-123', 'FAILED', 'Network timeout')

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'FAILED',
          errorMessage: 'Network timeout',
          completedAt: expect.any(Date)
        }
      })
    })
  })

  describe('completeJob', () => {
    it('should complete successful job and send event', async () => {
      const mockJob = {
        id: 'job-123',
        progress: '{"pagesProcessed":1,"chunksCreated":5,"chunksEmbedded":5,"errors":[]}'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      await jobQueue.completeJob('job-123', {
        success: true,
        totalChunks: 5,
        errors: [],
        processingTime: 30000
      })

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date),
          errorMessage: null,
          progress: JSON.stringify({
            pagesProcessed: 1,
            chunksCreated: 5,
            chunksEmbedded: 5,
            errors: []
          })
        }
      })
      expect(inngest.send).toHaveBeenCalledWith({
        name: 'ingestion/job.completed',
        data: {
          jobId: 'job-123',
          success: true,
          totalChunks: 5,
          errors: []
        }
      })
    })

    it('should complete failed job with errors', async () => {
      const mockJob = {
        id: 'job-123',
        progress: '{"pagesProcessed":0,"chunksCreated":0,"chunksEmbedded":0,"errors":["Network error"]}'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      await jobQueue.completeJob('job-123', {
        success: false,
        totalChunks: 0,
        errors: ['Scraping failed', 'Embedding failed'],
        processingTime: 5000
      })

      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'FAILED',
          completedAt: expect.any(Date),
          errorMessage: 'Scraping failed; Embedding failed',
          progress: JSON.stringify({
            pagesProcessed: 0,
            chunksCreated: 0,
            chunksEmbedded: 0,
            errors: ['Network error', 'Scraping failed', 'Embedding failed']
          })
        }
      })
    })
  })

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      vi.mocked(prisma.ingestionJob.count)
        .mockResolvedValueOnce(2) // queued
        .mockResolvedValueOnce(1) // processing
        .mockResolvedValueOnce(10) // completed
        .mockResolvedValueOnce(3) // failed
        .mockResolvedValueOnce(16) // total

      const stats = await jobQueue.getQueueStats()

      expect(stats).toEqual({
        queued: 2,
        processing: 1,
        completed: 10,
        failed: 3,
        totalJobs: 16
      })
    })
  })

  describe('cancelJob', () => {
    it('should cancel queued job', async () => {
      const mockJob = {
        id: 'job-123',
        status: 'QUEUED'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.update).mockResolvedValue({} as any)

      const result = await jobQueue.cancelJob('job-123')

      expect(result).toBe(true)
      expect(prisma.ingestionJob.update).toHaveBeenCalledWith({
        where: { id: 'job-123' },
        data: {
          status: 'FAILED',
          completedAt: expect.any(Date),
          errorMessage: 'Job cancelled by user'
        }
      })
    })

    it('should not cancel processing job', async () => {
      const mockJob = {
        id: 'job-123',
        status: 'PROCESSING'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)

      await expect(jobQueue.cancelJob('job-123'))
        .rejects.toThrow('Cannot cancel job in PROCESSING status')
    })

    it('should return false for nonexistent job', async () => {
      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(null)

      const result = await jobQueue.cancelJob('nonexistent-job')

      expect(result).toBe(false)
    })
  })

  describe('retryJob', () => {
    it('should create new job for failed job', async () => {
      const mockJob = {
        id: 'job-123',
        url: 'https://example.com/docs',
        status: 'FAILED',
        options: '{"maxDepth":2}'
      }

      const mockNewJob = {
        id: 'job-456',
        url: 'https://example.com/docs',
        status: 'QUEUED',
        options: '{"maxDepth":2}',
        progress: '{"pagesProcessed":0,"chunksCreated":0,"chunksEmbedded":0,"errors":[]}'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)
      vi.mocked(prisma.ingestionJob.create).mockResolvedValue(mockNewJob as any)
      vi.mocked(inngest.send).mockResolvedValue(undefined as any)

      const newJobId = await jobQueue.retryJob('job-123')

      expect(newJobId).toBe('job-456')
      expect(prisma.ingestionJob.create).toHaveBeenCalledWith({
        data: {
          url: 'https://example.com/docs',
          status: 'QUEUED',
          options: JSON.stringify({ maxDepth: 2 }),
          progress: JSON.stringify({
            pagesProcessed: 0,
            chunksCreated: 0,
            chunksEmbedded: 0,
            errors: []
          })
        }
      })
    })

    it('should not retry non-failed job', async () => {
      const mockJob = {
        id: 'job-123',
        status: 'COMPLETED'
      }

      vi.mocked(prisma.ingestionJob.findUnique).mockResolvedValue(mockJob as any)

      await expect(jobQueue.retryJob('job-123'))
        .rejects.toThrow('Cannot retry job in COMPLETED status')
    })
  })

  describe('cleanupOldJobs', () => {
    it('should delete old completed and failed jobs', async () => {
      vi.mocked(prisma.ingestionJob.deleteMany).mockResolvedValue({ count: 5 })

      const deletedCount = await jobQueue.cleanupOldJobs(30)

      expect(deletedCount).toBe(5)
      expect(prisma.ingestionJob.deleteMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['COMPLETED', 'FAILED'] },
          completedAt: { lt: expect.any(Date) }
        }
      })
    })
  })
})