// Unit tests for comprehensive error handling and logging

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ErrorHandler,
  ErrorHandlerConfig,
  RetryConfig
} from '../error-handler'
import {
  IngestionError,
  ValidationError,
  ScrapingError,
  EmbeddingError,
  StorageError,
  JobError,
  NetworkError,
  RateLimitError,
  CircuitBreakerError,
  ErrorCategory,
  ErrorSeverity,
  ErrorContext
} from '../errors'
import { Logger } from '../logger'

// Mock the Logger
vi.mock('../logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}))

describe('ErrorHandler', () => {
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
    
    errorHandler = new ErrorHandler()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Error Categorization and Response Generation', () => {
    it('should handle validation errors correctly', async () => {
      const context: ErrorContext = {
        jobId: 'test-job',
        url: 'invalid-url',
        component: 'URLValidator',
        operation: 'validate',
        timestamp: new Date()
      }

      const validationError = new ValidationError('Invalid URL format', context)
      const response = await errorHandler.handleError(validationError, context)

      expect(response.canRetry).toBe(false)
      expect(response.category).toBe(ErrorCategory.VALIDATION)
      expect(response.severity).toBe(ErrorSeverity.LOW)
      expect(response.userMessage).toContain('invalid')
      expect(response.suggestedAction).toContain('Verify the URL format')
    })

    it('should handle scraping errors with retry logic', async () => {
      const context: ErrorContext = {
        jobId: 'test-job',
        url: 'https://example.com',
        component: 'WebScraper',
        operation: 'scrape',
        timestamp: new Date()
      }

      const scrapingError = new ScrapingError('Network timeout', true, ErrorSeverity.MEDIUM, context)
      const response = await errorHandler.handleScrapingError(scrapingError, context)

      expect(response.canRetry).toBe(true)
      expect(response.retryAfter).toBeGreaterThan(0)
      expect(response.category).toBe(ErrorCategory.SCRAPING)
      expect(response.userMessage).toContain('Unable to access')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Scraping error occurred',
        expect.objectContaining({
          error: expect.any(Object),
          context
        })
      )
    })

    it('should handle embedding errors with rate limit detection', async () => {
      const context: ErrorContext = {
        jobId: 'test-job',
        component: 'EmbeddingService',
        operation: 'generateEmbeddings',
        timestamp: new Date()
      }

      const rateLimitError = new Error('Rate limit exceeded (429)')
      const response = await errorHandler.handleEmbeddingError(rateLimitError, context)

      expect(response.canRetry).toBe(true)
      expect(response.category).toBe(ErrorCategory.RATE_LIMIT)
      expect(response.userMessage).toContain('rate limited')
    })

    it('should handle storage errors with high severity', async () => {
      const context: ErrorContext = {
        jobId: 'test-job',
        component: 'VectorStore',
        operation: 'store',
        timestamp: new Date()
      }

      const storageError = new StorageError('Database connection failed', true, ErrorSeverity.HIGH, context)
      const response = await errorHandler.handleStorageError(storageError, context)

      expect(response.canRetry).toBe(true)
      expect(response.severity).toBe(ErrorSeverity.HIGH)
      expect(response.category).toBe(ErrorCategory.STORAGE)
      expect(response.suggestedAction).toContain('database connectivity')
      expect(mockLogger.error).toHaveBeenCalled()
    })
  })

  describe('Retry Logic with Exponential Backoff', () => {
    it('should retry operations with exponential backoff', async () => {
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      let attemptCount = 0
      const operation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          throw new NetworkError('Network timeout', true, context)
        }
        return 'success'
      })

      const result = await errorHandler.executeWithRetry(operation, context)

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
      expect(mockLogger.warn).toHaveBeenCalledTimes(2) // Two failed attempts
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Operation succeeded after retry',
        expect.objectContaining({
          component: 'TestComponent',
          operation: 'testOperation',
          attempt: 2,
          totalAttempts: 3
        })
      )
    })

    it('should fail after max retries are exhausted', async () => {
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const operation = vi.fn().mockRejectedValue(new NetworkError('Persistent network error', true, context))

      await expect(errorHandler.executeWithRetry(operation, context)).rejects.toThrow(JobError)
      expect(operation).toHaveBeenCalledTimes(4) // Initial + 3 retries
    }, 10000) // Increase timeout

    it('should not retry non-retryable errors', async () => {
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const operation = vi.fn().mockRejectedValue(new ValidationError('Invalid input', context))

      await expect(errorHandler.executeWithRetry(operation, context)).rejects.toThrow(JobError)
      expect(operation).toHaveBeenCalledTimes(1) // No retries for validation errors
    })

    it('should calculate retry delays with exponential backoff and jitter', async () => {
      const config: Partial<ErrorHandlerConfig> = {
        retryConfig: {
          maxRetries: 2,
          baseDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
          jitter: true
        }
      }

      const customErrorHandler = new ErrorHandler(config)
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      let attemptCount = 0
      const delays: number[] = []
      const originalDelay = (customErrorHandler as any).delay
      
      ;(customErrorHandler as any).delay = vi.fn().mockImplementation(async (ms: number) => {
        delays.push(ms)
        return originalDelay.call(customErrorHandler, 1) // Speed up test
      })

      const operation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount <= 2) {
          throw new NetworkError('Network timeout', true, context)
        }
        return 'success'
      })

      await customErrorHandler.executeWithRetry(operation, context)

      expect(delays).toHaveLength(2)
      expect(delays[0]).toBeGreaterThanOrEqual(500) // Base delay with jitter
      expect(delays[0]).toBeLessThanOrEqual(1500)
      expect(delays[1]).toBeGreaterThanOrEqual(1000) // 2x base delay with jitter
      expect(delays[1]).toBeLessThanOrEqual(3000)
    })
  })

  describe('Circuit Breaker Pattern', () => {
    it('should open circuit breaker after consecutive failures', async () => {
      const context: ErrorContext = {
        component: 'TestService',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const config: Partial<ErrorHandlerConfig> = {
        circuitBreakerConfig: {
          failureThreshold: 3,
          resetTimeout: 60000,
          monitoringPeriod: 300000
        }
      }

      const customErrorHandler = new ErrorHandler(config)
      const operation = vi.fn().mockRejectedValue(new NetworkError('Service unavailable', true, context))

      // Trigger failures to open circuit breaker
      for (let i = 0; i < 3; i++) {
        try {
          await customErrorHandler.executeWithRetry(operation, context, { maxRetries: 0 })
        } catch (error) {
          // Expected to fail
        }
      }

      // Next call should fail immediately with circuit breaker error
      await expect(customErrorHandler.executeWithRetry(operation, context)).rejects.toThrow(CircuitBreakerError)
      
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Circuit breaker opened due to consecutive failures',
        expect.objectContaining({
          component: 'TestService',
          consecutiveFailures: 3,
          threshold: 3
        })
      )
    })

    it('should transition circuit breaker from half-open to closed on success', async () => {
      const context: ErrorContext = {
        component: 'TestService',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const config: Partial<ErrorHandlerConfig> = {
        circuitBreakerConfig: {
          failureThreshold: 2,
          resetTimeout: 100, // Short timeout for testing
          monitoringPeriod: 300000
        }
      }

      const customErrorHandler = new ErrorHandler(config)
      
      // First, open the circuit breaker
      const failingOperation = vi.fn().mockRejectedValue(new NetworkError('Service unavailable', true, context))
      
      for (let i = 0; i < 2; i++) {
        try {
          await customErrorHandler.executeWithRetry(failingOperation, context, { maxRetries: 0 })
        } catch (error) {
          // Expected to fail
        }
      }

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150))

      // Now succeed to close the circuit breaker
      const successOperation = vi.fn().mockResolvedValue('success')
      const result = await customErrorHandler.executeWithRetry(successOperation, context)

      expect(result).toBe('success')
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Circuit breaker closed after successful operation',
        expect.objectContaining({ component: 'TestService' })
      )
    })
  })

  describe('Graceful Degradation', () => {
    it('should use fallback operation when primary fails', async () => {
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

    it('should throw original error when both primary and fallback fail', async () => {
      const context: ErrorContext = {
        component: 'TestService',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const primaryError = new Error('Primary service failed')
      const fallbackError = new Error('Fallback service failed')
      
      const primaryOperation = vi.fn().mockRejectedValue(primaryError)
      const fallbackOperation = vi.fn().mockRejectedValue(fallbackError)

      await expect(
        errorHandler.handleWithGracefulDegradation(primaryOperation, fallbackOperation, context)
      ).rejects.toThrow('Primary service failed')

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Both primary and fallback operations failed',
        expect.objectContaining({
          primaryError: 'Primary service failed',
          fallbackError: 'Fallback service failed',
          context
        })
      )
    })

    it('should skip graceful degradation when disabled', async () => {
      const config: Partial<ErrorHandlerConfig> = {
        enableGracefulDegradation: false
      }

      const customErrorHandler = new ErrorHandler(config)
      const context: ErrorContext = {
        component: 'TestService',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const primaryOperation = vi.fn().mockResolvedValue('primary result')
      const fallbackOperation = vi.fn().mockResolvedValue('fallback result')

      const result = await customErrorHandler.handleWithGracefulDegradation(
        primaryOperation,
        fallbackOperation,
        context
      )

      expect(result).toBe('primary result')
      expect(primaryOperation).toHaveBeenCalledTimes(1)
      expect(fallbackOperation).not.toHaveBeenCalled()
    })
  })

  describe('Error Context and Metadata', () => {
    it('should preserve error context through the handling pipeline', async () => {
      const context: ErrorContext = {
        jobId: 'test-job-123',
        url: 'https://example.com/docs',
        chunkId: 'chunk-456',
        batchNumber: 2,
        attempt: 1,
        component: 'EmbeddingService',
        operation: 'generateEmbeddings',
        timestamp: new Date(),
        metadata: {
          modelName: 'amazon.titan-embed-text-v1',
          batchSize: 10
        }
      }

      const embeddingError = new EmbeddingError('Embedding generation failed', true, ErrorSeverity.MEDIUM, context)
      const response = await errorHandler.handleError(embeddingError, context)

      expect(response.errorCode).toBe('EMBEDDING_ERROR')
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Medium severity error',
        expect.objectContaining({
          error: expect.objectContaining({
            context: expect.objectContaining({
              jobId: 'test-job-123',
              url: 'https://example.com/docs',
              chunkId: 'chunk-456',
              batchNumber: 2,
              metadata: expect.objectContaining({
                modelName: 'amazon.titan-embed-text-v1',
                batchSize: 10
              })
            })
          }),
          context
        })
      )
    })

    it('should extract retry-after from rate limit error messages', async () => {
      const context: ErrorContext = {
        component: 'EmbeddingService',
        operation: 'generateEmbeddings',
        timestamp: new Date()
      }

      const rateLimitError = new Error('Rate limit exceeded, retry after 30 seconds')
      const response = await errorHandler.handleEmbeddingError(rateLimitError, context)

      expect(response.retryAfter).toBeGreaterThan(0) // Should have some retry delay
    })
  })

  describe('Error Recovery Mechanisms', () => {
    it('should implement progressive delay for retries', async () => {
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const config: Partial<ErrorHandlerConfig> = {
        retryConfig: {
          maxRetries: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffMultiplier: 2,
          jitter: false // Disable jitter for predictable testing
        }
      }

      const customErrorHandler = new ErrorHandler(config)
      const delays: number[] = []
      
      ;(customErrorHandler as any).delay = vi.fn().mockImplementation(async (ms: number) => {
        delays.push(ms)
        return Promise.resolve()
      })

      let attemptCount = 0
      const operation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount <= 3) {
          throw new NetworkError('Network timeout', true, context)
        }
        return 'success'
      })

      await customErrorHandler.executeWithRetry(operation, context)

      expect(delays).toEqual([100, 200, 400]) // Progressive backoff without jitter
    })

    it('should respect maximum delay limit', async () => {
      const context: ErrorContext = {
        component: 'TestComponent',
        operation: 'testOperation',
        timestamp: new Date()
      }

      const config: Partial<ErrorHandlerConfig> = {
        retryConfig: {
          maxRetries: 5,
          baseDelay: 1000,
          maxDelay: 3000, // Cap at 3 seconds
          backoffMultiplier: 3,
          jitter: false
        }
      }

      const customErrorHandler = new ErrorHandler(config)
      const delays: number[] = []
      
      ;(customErrorHandler as any).delay = vi.fn().mockImplementation(async (ms: number) => {
        delays.push(ms)
        return Promise.resolve()
      })

      let attemptCount = 0
      const operation = vi.fn().mockImplementation(async () => {
        attemptCount++
        if (attemptCount <= 5) {
          throw new NetworkError('Network timeout', true, context)
        }
        return 'success'
      })

      await customErrorHandler.executeWithRetry(operation, context)

      // Delays should be: 1000, 3000 (capped), 3000 (capped), 3000 (capped), 3000 (capped)
      expect(delays.every(delay => delay <= 3000)).toBe(true)
      expect(delays.slice(1).every(delay => delay === 3000)).toBe(true) // All subsequent delays should be capped
    })
  })
})