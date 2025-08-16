import { prisma } from '../db'
import { inngest } from '../inngest'
import { 
  IngestionJob, 
  JobStatus, 
  JobProgress, 
  IngestionOptions 
} from '../types'
import { JobError } from '../errors'

export interface JobQueueOptions {
  maxRetries?: number
  retryDelay?: number
  maxConcurrentJobs?: number
  jobTimeout?: number
}

export interface JobResult {
  success: boolean
  totalChunks?: number
  errors: string[]
  processingTime?: number
}

export class JobQueue {
  private readonly maxRetries: number
  private readonly retryDelay: number
  private readonly maxConcurrentJobs: number
  private readonly jobTimeout: number

  constructor(options: JobQueueOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3
    this.retryDelay = options.retryDelay ?? 5000 // 5 seconds
    this.maxConcurrentJobs = options.maxConcurrentJobs ?? 5
    this.jobTimeout = options.jobTimeout ?? 300000 // 5 minutes
  }

  /**
   * Enqueue a new ingestion job
   */
  async enqueue(
    url: string, 
    options: IngestionOptions = {},
    userId?: string
  ): Promise<string> {
    try {
      // Create job record in database
      const job = await prisma.ingestionJob.create({
        data: {
          url,
          status: 'QUEUED',
          options: JSON.stringify(options),
          progress: JSON.stringify({
            pagesProcessed: 0,
            chunksCreated: 0,
            chunksEmbedded: 0,
            errors: []
          } as JobProgress)
        }
      })

      // Send event to Inngest for background processing
      await inngest.send({
        name: 'ingestion/job.started',
        data: {
          jobId: job.id,
          url,
          options
        }
      })

      return job.id
    } catch (error) {
      throw new JobError(
        `Failed to enqueue job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get job status and progress
   */
  async getStatus(jobId: string): Promise<IngestionJob | null> {
    try {
      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        return null
      }

      return {
        id: job.id,
        url: job.url,
        status: job.status,
        options: JSON.parse(job.options as string) as IngestionOptions,
        progress: JSON.parse(job.progress as string) as JobProgress,
        createdAt: job.createdAt,
        startedAt: job.startedAt || undefined,
        completedAt: job.completedAt || undefined,
        errorMessage: job.errorMessage || undefined
      }
    } catch (error) {
      throw new JobError(
        `Failed to get job status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Update job progress
   */
  async updateProgress(jobId: string, progress: Partial<JobProgress>): Promise<void> {
    try {
      const currentJob = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      if (!currentJob) {
        throw new Error(`Job ${jobId} not found`)
      }

      const currentProgress = JSON.parse(currentJob.progress as string) as JobProgress
      const updatedProgress: JobProgress = {
        ...currentProgress,
        ...progress
      }

      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          progress: JSON.stringify(updatedProgress)
        }
      })

      // Send progress event
      await inngest.send({
        name: 'ingestion/job.progress',
        data: {
          jobId,
          ...updatedProgress
        }
      })
    } catch (error) {
      throw new JobError(
        `Failed to update job progress: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Update job status
   */
  async updateStatus(
    jobId: string, 
    status: JobStatus, 
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        ...(errorMessage && { errorMessage })
      }

      if (status === 'PROCESSING') {
        updateData.startedAt = new Date()
      } else if (status === 'COMPLETED' || status === 'FAILED') {
        updateData.completedAt = new Date()
      }

      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: updateData
      })
    } catch (error) {
      throw new JobError(
        `Failed to update job status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Mark job as completed with results
   */
  async completeJob(
    jobId: string, 
    result: JobResult
  ): Promise<void> {
    try {
      const currentJob = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      if (!currentJob) {
        throw new Error(`Job ${jobId} not found`)
      }

      const currentProgress = JSON.parse(currentJob.progress as string) as JobProgress
      
      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
          progress: JSON.stringify({
            ...currentProgress,
            errors: [...currentProgress.errors, ...result.errors]
          })
        }
      })

      // Send completion event
      await inngest.send({
        name: 'ingestion/job.completed',
        data: {
          jobId,
          success: result.success,
          totalChunks: result.totalChunks || 0,
          errors: result.errors
        }
      })
    } catch (error) {
      throw new JobError(
        `Failed to complete job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get all jobs with optional filtering
   */
  async getJobs(options: {
    status?: JobStatus
    limit?: number
    offset?: number
    orderBy?: 'createdAt' | 'startedAt' | 'completedAt'
    orderDirection?: 'asc' | 'desc'
  } = {}): Promise<{
    jobs: IngestionJob[]
    total: number
  }> {
    try {
      const {
        status,
        limit = 50,
        offset = 0,
        orderBy = 'createdAt',
        orderDirection = 'desc'
      } = options

      const where = status ? { status } : {}
      
      const [jobs, total] = await Promise.all([
        prisma.ingestionJob.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: { [orderBy]: orderDirection }
        }),
        prisma.ingestionJob.count({ where })
      ])

      return {
        jobs: jobs.map(job => ({
          id: job.id,
          url: job.url,
          status: job.status,
          options: JSON.parse(job.options as string) as IngestionOptions,
          progress: JSON.parse(job.progress as string) as JobProgress,
          createdAt: job.createdAt,
          startedAt: job.startedAt || undefined,
          completedAt: job.completedAt || undefined,
          errorMessage: job.errorMessage || undefined
        })),
        total
      }
    } catch (error) {
      throw new JobError(
        `Failed to get jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Cancel a queued job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        return false
      }

      if (job.status !== 'QUEUED') {
        throw new Error(`Cannot cancel job in ${job.status} status`)
      }

      await prisma.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: 'Job cancelled by user'
        }
      })

      return true
    } catch (error) {
      throw new JobError(
        `Failed to cancel job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Retry a failed job
   */
  async retryJob(jobId: string): Promise<string> {
    try {
      const job = await prisma.ingestionJob.findUnique({
        where: { id: jobId }
      })

      if (!job) {
        throw new Error(`Job ${jobId} not found`)
      }

      if (job.status !== 'FAILED') {
        throw new Error(`Cannot retry job in ${job.status} status`)
      }

      // Create a new job with the same parameters
      const options = JSON.parse(job.options as string) as IngestionOptions
      return await this.enqueue(job.url, options)
    } catch (error) {
      throw new JobError(
        `Failed to retry job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

      const result = await prisma.ingestionJob.deleteMany({
        where: {
          status: { in: ['COMPLETED', 'FAILED'] },
          completedAt: { lt: cutoffDate }
        }
      })

      return result.count
    } catch (error) {
      throw new JobError(
        `Failed to cleanup old jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    queued: number
    processing: number
    completed: number
    failed: number
    totalJobs: number
  }> {
    try {
      const [queued, processing, completed, failed, totalJobs] = await Promise.all([
        prisma.ingestionJob.count({ where: { status: 'QUEUED' } }),
        prisma.ingestionJob.count({ where: { status: 'PROCESSING' } }),
        prisma.ingestionJob.count({ where: { status: 'COMPLETED' } }),
        prisma.ingestionJob.count({ where: { status: 'FAILED' } }),
        prisma.ingestionJob.count()
      ])

      return {
        queued,
        processing,
        completed,
        failed,
        totalJobs
      }
    } catch (error) {
      throw new JobError(
        `Failed to get queue stats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        true,
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const jobQueue = new JobQueue()