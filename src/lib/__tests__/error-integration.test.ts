// Integration test for comprehensive error handling system

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ErrorHandler } from '../error-handler'
import { Logger } from '../logger'
import {
  ValidationError,
  ScrapingError,
  EmbeddingError,
  StorageError,
  NetworkError,
  RateLimitError,
  ErrorContext,
  ErrorSeverity
} from '../errors'

// Mock the Logger
vi.mock('../logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

describe('Error Handling Integration', () => {
  let errorHandler: ErrorHandler
  let mockLogger: any

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
    
    // Mock Logger constructor to return our mock
    vi.mocked(Logger).mockImplementation(() => mockLogger)
    
    errorHandler = new ErrorHandler({
      retryConfig: {
        maxRetries: 2,
        baseDelay: 10, // Fast for testing
        maxDelay: 100,
        backoffMultiplier: 2,
        jitter: false
      },
      circuitBreakerConfig: {
        failureThreshold: 3,
        resetTimeout: 100,
        monitoringPeriod: 1000
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should handle complete ingestion pipeline error scenarios', async () => {
    const context: ErrorContext = {
      component: 'IngestionPipeline',
      operation: 'processDocument',
      url: 'https://example.com/docs',
      jobId: 'test-job-123',
      timestamp: new Date()
    }

    // Test validation error (non-retryable)
    const validationError = new ValidationError('Invalid URL format', context)
    const validationResponse = await errorHandler.handleError(validationError, context)
    
    expect(validationResponse.canRetry).toBe(false)
    expect(validationResponse.category).toBe('VALIDATION')
    expect(validationResponse.severity).toBe('LOW')
    expect(validationResponse.userMessage).toContain('invalid')

    // Test scraping error with retry
    let scrapingAttempts = 0
    const scrapingOperation = vi.fn().mockImplementation(async () => {
      scrapingAttempts++
      if (scrapingAttempts < 3) {
        throw new ScrapingError('Network timeout', true, ErrorSeverity.MEDIUM, context)
      }
      return 'scraped content'
    })

    const scrapingResult = await errorHandler.executeWithRetry(scrapingOperation, context)
    expect(scrapingResult).toBe('scraped content')
    expect(scrapingAttempts).toBe(3)

    // Test embedding error with rate limiting
    const rateLimitError = new Error('Rate limit exceeded (429)')
    const rateLimitResponse = await errorHandler.handleEmbeddingError(rateLimitError, context)
    
    expect(rateLimitResponse.canRetry).toBe(true)
    expect(rateLimitResponse.category).toBe('RATE_LIMIT')
    expect(rateLimitResponse.retryAfter).toBeGreaterThan(0)

    // Test storage error with high severity
    const storageError = new StorageError('Database connection failed', true, ErrorSeverity.HIGH, context)
    const storageResponse = await errorHandler.handleStorageError(storageError, context)
    
    expect(storageResponse.canRetry).toBe(true)
    expect(storageResponse.severity).toBe('HIGH')
    expect(storageResponse.suggestedAction).toContain('database connectivity')
  })

  it('should implement circuit breaker pattern correctly', async () => {
    const context: ErrorContext = {
      component: 'TestService',
      operation: 'testOperation',
      timestamp: new Date()
    }

    const failingOperation = vi.fn().mockRejectedValue(new NetworkError('Service unavailable', true, context))

    // Trigger failures to open circuit breaker
    for (let i = 0; i < 3; i++) {
      try {
        await errorHandler.executeWithRetry(failingOperation, context, { maxRetries: 0 })
      } catch (error) {
        // Expected to fail
      }
    }

    // Next call should fail immediately with circuit breaker error
    await expect(errorHandler.executeWithRetry(failingOperation, context))
      .rejects.toThrow('Circuit breaker is open')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Circuit breaker opened due to consecutive failures',
      expect.objectContaining({
        component: 'TestService',
        consecutiveFailures: 3,
        threshold: 3
      })
    )
  })

  it('should handle graceful degradation scenarios', async () => {
    const context: ErrorContext = {
      component: 'TestService',
      operation: 'testOperation',
      timestamp: new Date()
    }

    const primaryOperation = vi.fn().mockRejectedValue(new Error('Primary service failed'))
    const fallbackOperation = vi.fn().mockResolvedValue('fallback result')

    const result = await errorHandler.handleWithGracefulDegradation(
      primaryOperation,
      fallbackOperation,
      context
    )

    expect(result).toBe('fallback result')
    expect(primaryOperation).toHaveBeenCalledTimes(1)
    expect(fallbackOperation).toHaveBeenCalledTimes(1)
    
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Primary operation failed, attempting graceful degradation',
      expect.objectContaining({
        error: 'Primary service failed',
        context
      })
    )
    
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Graceful degradation successful',
      expect.objectContaining({
        context,
        fallbackUsed: true
      })
    )
  })

  it('should preserve error context throughout the pipeline', async () => {
    const context: ErrorContext = {
      jobId: 'test-job-456',
      url: 'https://example.com/api',
      chunkId: 'chunk-789',
      batchNumber: 2,
      attempt: 1,
      component: 'EmbeddingService',
      operation: 'generateEmbeddings',
      timestamp: new Date(),
      metadata: {
        modelName: 'amazon.titan-embed-text-v1',
        batchSize: 10,
        contentLength: 1500
      }
    }

    const embeddingError = new EmbeddingError(
      'Embedding generation failed',
      true,
      ErrorSeverity.MEDIUM,
      context
    )

    const response = await errorHandler.handleError(embeddingError, context)

    expect(response.errorCode).toBe('EMBEDDING_ERROR')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Medium severity error',
      expect.objectContaining({
        error: expect.objectContaining({
          context: expect.objectContaining({
            jobId: 'test-job-456',
            url: 'https://example.com/api',
            chunkId: 'chunk-789',
            batchNumber: 2,
            metadata: expect.objectContaining({
              modelName: 'amazon.titan-embed-text-v1',
              batchSize: 10,
              contentLength: 1500
            })
          })
        }),
        context
      })
    )
  })

  it('should handle mixed error scenarios in batch processing', async () => {
    const context: ErrorContext = {
      component: 'BatchProcessor',
      operation: 'processBatch',
      timestamp: new Date()
    }

    const operations = [
      // Success
      vi.fn().mockResolvedValue('success-1'),
      // Retryable error that succeeds on retry
      vi.fn()
        .mockRejectedValueOnce(new NetworkError('Temporary network error', true, context))
        .mockResolvedValue('success-2'),
      // Non-retryable error
      vi.fn().mockRejectedValue(new ValidationError('Invalid input', context)),
      // Success
      vi.fn().mockResolvedValue('success-3')
    ]

    const results = []
    const errors = []

    for (let i = 0; i < operations.length; i++) {
      const operationContext = { ...context, metadata: { operationIndex: i } }
      
      try {
        const result = await errorHandler.executeWithRetry(operations[i], operationContext)
        results.push(result)
      } catch (error) {
        const errorResponse = await errorHandler.handleError(error, operationContext)
        errors.push(errorResponse)
      }
    }

    expect(results).toEqual(['success-1', 'success-2', 'success-3'])
    expect(errors).toHaveLength(1)
    expect(errors[0].category).toBe('JOB') // The error gets wrapped in a JobError after retries
    expect(errors[0].canRetry).toBe(false)
  })

  it('should log performance metrics and error recovery', async () => {
    const context: ErrorContext = {
      component: 'PerformanceTest',
      operation: 'timedOperation',
      timestamp: new Date()
    }

    let attempts = 0
    const operation = vi.fn().mockImplementation(async () => {
      attempts++
      if (attempts < 2) {
        throw new NetworkError('Temporary failure', true, context)
      }
      return 'success after retry'
    })

    const result = await errorHandler.executeWithRetry(operation, context)

    expect(result).toBe('success after retry')
    expect(attempts).toBe(2)
    
    // Verify retry logging
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Operation attempt failed',
      expect.objectContaining({
        error: 'Temporary failure',
        context: expect.objectContaining({
          component: 'PerformanceTest',
          operation: 'timedOperation',
          attempt: 1
        }),
        isRetryable: true,
        remainingAttempts: 2
      })
    )

    // Verify success after retry logging
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Operation succeeded after retry',
      expect.objectContaining({
        component: 'PerformanceTest',
        operation: 'timedOperation',
        attempt: 1,
        totalAttempts: 2
      })
    )
  })
})