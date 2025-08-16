import { NextRequest, NextResponse } from 'next/server'
import { jobQueue } from '../../../../lib/jobs/queue'
import { JobError, ValidationError, ErrorContext } from '../../../../lib/errors'
import { defaultErrorHandler } from '../../../../lib/error-handler'
import { loggers } from '../../../../lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const logger = loggers.api
  const { jobId } = params
  const context: ErrorContext = {
    component: 'StatusAPI',
    operation: 'getJobStatus',
    jobId,
    timestamp: new Date()
  }

  try {
    logger.debug('Processing job status request', { jobId }, context)
    
    // Validate job ID format
    if (!jobId || typeof jobId !== 'string' || jobId.trim().length === 0) {
      const errorResponse = await defaultErrorHandler.handleError(
        new ValidationError('Job ID must be a non-empty string', context),
        context
      )

      return NextResponse.json({
        error: 'Invalid job ID',
        message: errorResponse.userMessage,
        code: errorResponse.errorCode
      }, { status: 400 })
    }
    
    const sanitizedJobId = jobId.trim()
    
    // Basic job ID format validation (allow alphanumeric with hyphens)
    if (!/^[a-z0-9-]{3,50}$/i.test(sanitizedJobId)) {
      const errorResponse = await defaultErrorHandler.handleError(
        new ValidationError('Job ID must be a valid identifier', { ...context, jobId: sanitizedJobId }),
        context
      )

      return NextResponse.json({
        error: 'Invalid job ID format',
        message: errorResponse.userMessage,
        code: errorResponse.errorCode
      }, { status: 400 })
    }
    
    // Get job status with error handling and retry
    const job = await defaultErrorHandler.executeWithRetry(
      () => jobQueue.getStatus(sanitizedJobId),
      { ...context, jobId: sanitizedJobId }
    )
    
    if (!job) {
      logger.warn('Job not found', { jobId: sanitizedJobId }, context)
      
      return NextResponse.json({
        error: 'Job not found',
        message: `No job found with ID: ${sanitizedJobId}`,
        code: 'JOB_NOT_FOUND'
      }, { status: 404 })
    }
    
    // Format response with proper status information
    const response = {
      jobId: job.id,
      url: job.url,
      status: job.status.toLowerCase(), // Normalize to lowercase for consistency
      progress: {
        pagesProcessed: job.progress.pagesProcessed,
        chunksCreated: job.progress.chunksCreated,
        chunksEmbedded: job.progress.chunksEmbedded,
        errors: job.progress.errors,
        ...(job.status === 'COMPLETED' && {
          completionRate: job.progress.chunksCreated > 0 
            ? Math.round((job.progress.chunksEmbedded / job.progress.chunksCreated) * 100)
            : 0
        })
      },
      options: job.options,
      timestamps: {
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        ...(job.startedAt && job.completedAt && {
          processingDuration: job.completedAt.getTime() - job.startedAt.getTime()
        })
      },
      ...(job.errorMessage && { errorMessage: job.errorMessage })
    }
    
    logger.info('Job status retrieved successfully', { 
      jobId: sanitizedJobId, 
      status: job.status 
    }, context)
    
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': job.status === 'COMPLETED' || job.status === 'FAILED' 
          ? 'public, max-age=3600' // Cache completed/failed jobs for 1 hour
          : 'no-cache' // Don't cache in-progress jobs
      }
    })
    
  } catch (error) {
    const errorResponse = await defaultErrorHandler.handleError(error, context)

    logger.error('Failed to get job status', {
      error: errorResponse.logMessage,
      errorCode: errorResponse.errorCode,
      jobId
    }, context)
    
    const statusCode = errorResponse.severity === 'CRITICAL' ? 500 :
                      errorResponse.severity === 'HIGH' ? 500 :
                      errorResponse.canRetry ? 503 : 400

    return NextResponse.json({
      error: errorResponse.category.toLowerCase().replace('_', ' '),
      message: errorResponse.userMessage,
      code: errorResponse.errorCode,
      retryable: errorResponse.canRetry,
      ...(errorResponse.retryAfter && { retryAfter: Math.ceil(errorResponse.retryAfter / 1000) })
    }, { 
      status: statusCode,
      ...(errorResponse.retryAfter && {
        headers: { 'Retry-After': Math.ceil(errorResponse.retryAfter / 1000).toString() }
      })
    })
  }
}