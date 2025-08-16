import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { jobQueue } from '../../../lib/jobs/queue'
import { ValidationError, ErrorContext } from '../../../lib/errors'
import { defaultErrorHandler } from '../../../lib/error-handler'
import { loggers } from '../../../lib/logger'

// Request validation schema
const IngestRequestSchema = z.object({
  url: z.string().url({ message: 'Invalid URL format' }),
  options: z.object({
    maxDepth: z.number().min(1).max(10).optional(),
    followLinks: z.boolean().optional(),
    respectRobots: z.boolean().optional()
  }).optional()
})

// Rate limiting - simple in-memory store (for production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10 // 10 requests per minute

function getRateLimitKey(request: NextRequest): string {
  // Use IP address or user ID for rate limiting
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwarded ? forwarded.split(',')[0].trim() : realIp || 'unknown'
  return `rate_limit:${ip}`
}

function checkRateLimit(key: string): { allowed: boolean; resetTime?: number } {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    // Reset or create new record
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true }
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, resetTime: record.resetTime }
  }

  record.count++
  return { allowed: true }
}

export async function POST(request: NextRequest) {
  const logger = loggers.api
  const context: ErrorContext = {
    component: 'IngestAPI',
    operation: 'enqueueJob',
    timestamp: new Date()
  }

  try {
    logger.info('Processing ingestion request', {}, context)

    // Check rate limiting
    const rateLimitKey = getRateLimitKey(request)
    const rateLimitResult = checkRateLimit(rateLimitKey)

    if (!rateLimitResult.allowed) {
      const resetTime = rateLimitResult.resetTime!
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000)

      logger.warn('Rate limit exceeded', { 
        rateLimitKey, 
        retryAfter 
      }, context)

      return NextResponse.json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
        retryAfter
      }, {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': RATE_LIMIT_MAX_REQUESTS.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.ceil(resetTime / 1000).toString()
        }
      })
    }

    // Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch (parseError) {
      const errorResponse = await defaultErrorHandler.handleError(
        new ValidationError('Invalid JSON in request body', context, parseError as Error),
        context
      )

      return NextResponse.json({
        error: 'Invalid JSON',
        message: errorResponse.userMessage,
        code: errorResponse.errorCode
      }, { status: 400 })
    }

    // Validate request data
    const validatedData = IngestRequestSchema.parse(body)

    // Additional URL sanitization and validation
    const url = validatedData.url.trim()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const errorResponse = await defaultErrorHandler.handleError(
        new ValidationError('Invalid URL protocol', { ...context, url }),
        context
      )

      return NextResponse.json({
        error: 'Invalid URL protocol',
        message: errorResponse.userMessage,
        code: errorResponse.errorCode
      }, { status: 400 })
    }

    // Enqueue the job with error handling
    const jobId = await defaultErrorHandler.executeWithRetry(
      () => jobQueue.enqueue(url, validatedData.options || {}),
      { ...context, url }
    )

    logger.info('Job enqueued successfully', { jobId, url }, context)

    return NextResponse.json({
      jobId,
      status: 'queued',
      message: 'Document ingestion job has been queued successfully'
    }, { status: 202 })

  } catch (error) {
    const errorResponse = await defaultErrorHandler.handleError(error, context)

    logger.error('Failed to process ingestion request', {
      error: errorResponse.logMessage,
      errorCode: errorResponse.errorCode
    }, context)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Invalid request data',
        message: 'Request validation failed',
        code: 'VALIDATION_ERROR',
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, { status: 400 })
    }

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