// Unit tests for structured logging system

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Logger, LogLevel, LogEntry, createLogger, loggers } from '../logger'

// Mock console methods
const mockConsole = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn()
}

// Mock process.memoryUsage
const mockMemoryUsage = vi.fn().mockReturnValue({
  rss: 1000000,
  heapUsed: 500000,
  heapTotal: 800000,
  external: 100000,
  arrayBuffers: 50000
})

describe('Logger', () => {
  let logger: Logger

  beforeEach(() => {
    // Replace console methods
    Object.assign(console, mockConsole)
    
    // Mock process.memoryUsage
    vi.stubGlobal('process', {
      ...process,
      memoryUsage: mockMemoryUsage
    })

    logger = new Logger('TestComponent', 'debug')
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  describe('Basic Logging', () => {
    it('should log debug messages when level is debug', () => {
      logger.debug('Debug message', { key: 'value' })

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] [TestComponent] Debug message'),
        { key: 'value' }
      )
    })

    it('should log info messages', () => {
      logger.info('Info message', { data: 'test' })

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [TestComponent] Info message'),
        { data: 'test' }
      )
    })

    it('should log warning messages', () => {
      logger.warn('Warning message', { warning: true })

      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [TestComponent] Warning message'),
        { warning: true }
      )
    })

    it('should log error messages with stack trace', () => {
      const error = new Error('Test error')
      logger.error('Error occurred', { context: 'test' }, undefined, error)

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [TestComponent] Error occurred'),
        expect.objectContaining({
          context: 'test',
          error: expect.objectContaining({
            name: 'Error',
            message: 'Test error',
            stack: expect.any(String)
          })
        })
      )
    })

    it('should respect log level filtering', () => {
      const infoLogger = new Logger('TestComponent', 'info')
      
      infoLogger.debug('Debug message')
      infoLogger.info('Info message')

      expect(mockConsole.debug).not.toHaveBeenCalled()
      expect(mockConsole.info).toHaveBeenCalled()
    })
  })

  describe('Context Logging', () => {
    it('should include context in log messages', () => {
      const context = {
        jobId: 'job-123',
        url: 'https://example.com',
        operation: 'scrape',
        attempt: 2
      }

      logger.info('Operation started', { data: 'test' }, context)

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('(job:job-123, url:https://example.com, op:scrape, attempt:2)'),
        { data: 'test' }
      )
    })

    it('should handle partial context', () => {
      const context = {
        jobId: 'job-123',
        operation: 'validate'
      }

      logger.warn('Validation warning', undefined, context)

      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('(job:job-123, op:validate)'),
        ''
      )
    })
  })

  describe('Performance Timing', () => {
    it('should measure operation timing with startTimer and endTimer', async () => {
      logger.startTimer('test-operation')
      
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10))
      
      logger.endTimer('test-operation', 'Operation completed', { result: 'success' })

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [TestComponent] Operation completed'),
        expect.objectContaining({
          result: 'success',
          performance: expect.objectContaining({
            operation: 'test-operation',
            duration: expect.any(Number),
            memoryUsage: expect.any(Object),
            timestamp: expect.any(Number)
          })
        })
      )
    })

    it('should measure async operations with withPerformance', async () => {
      const asyncOperation = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'result'
      })

      const result = await logger.withPerformance('async-test', asyncOperation)

      expect(result).toBe('result')
      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining('Starting operation: async-test'),
        ''
      )
      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('Operation completed: async-test'),
        expect.objectContaining({
          performance: expect.objectContaining({
            operation: 'async-test',
            duration: expect.any(Number),
            startMemory: expect.any(Object),
            endMemory: expect.any(Object),
            memoryDelta: expect.any(Object)
          })
        })
      )
    })

    it('should log performance metrics on operation failure', async () => {
      const failingOperation = vi.fn().mockRejectedValue(new Error('Operation failed'))

      await expect(logger.withPerformance('failing-test', failingOperation)).rejects.toThrow('Operation failed')

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('Operation failed: failing-test'),
        expect.objectContaining({
          performance: expect.objectContaining({
            operation: 'failing-test',
            duration: expect.any(Number),
            failed: true
          })
        })
      )
    })

    it('should calculate memory delta correctly', async () => {
      let memoryCallCount = 0
      mockMemoryUsage.mockImplementation(() => {
        memoryCallCount++
        return {
          rss: 1000000 + (memoryCallCount * 100000),
          heapUsed: 500000 + (memoryCallCount * 50000),
          heapTotal: 800000 + (memoryCallCount * 80000),
          external: 100000,
          arrayBuffers: 50000
        }
      })

      const operation = vi.fn().mockResolvedValue('success')
      await logger.measureAsync('memory-test', operation)

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('Operation completed: memory-test'),
        expect.objectContaining({
          performance: expect.objectContaining({
            memoryDelta: {
              rss: 100000,
              heapUsed: 50000,
              heapTotal: 80000
            }
          })
        })
      )
    })
  })

  describe('Child Logger', () => {
    it('should create child logger with additional context', () => {
      const childLogger = logger.child({ jobId: 'job-456', batchNumber: 3 })
      
      childLogger.info('Child logger message')

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('(job:job-456, batch:3)'),
        ''
      )
    })

    it('should merge child context with provided context', () => {
      const childLogger = logger.child({ jobId: 'job-456' })
      
      childLogger.warn('Warning message', undefined, { operation: 'test', attempt: 1 })

      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('(job:job-456, op:test, attempt:1)'),
        ''
      )
    })
  })

  describe('Structured Logging', () => {
    it('should output structured JSON in production mode', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      logger.info('Test message', { data: 'test' })

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\{.*"level":"INFO".*"component":"TestComponent".*"message":"Test message".*\}$/)
      )

      process.env.NODE_ENV = originalEnv
    })

    it('should output structured JSON when explicitly enabled', () => {
      const originalEnv = process.env.ENABLE_STRUCTURED_LOGS
      process.env.ENABLE_STRUCTURED_LOGS = 'true'

      logger.info('Test message', { data: 'test' })

      expect(mockConsole.log).toHaveBeenCalledWith(
        expect.stringMatching(/^\{.*"level":"INFO".*"component":"TestComponent".*"message":"Test message".*\}$/)
      )

      process.env.ENABLE_STRUCTURED_LOGS = originalEnv
    })

    it('should include trace ID in structured logs', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      logger.info('Test message')

      const logCall = mockConsole.log.mock.calls[0][0]
      const logEntry = JSON.parse(logCall)
      
      expect(logEntry.traceId).toMatch(/^[a-z0-9]+$/) // Alphanumeric trace ID

      process.env.NODE_ENV = originalEnv
    })
  })

  describe('Error Serialization', () => {
    it('should serialize error objects with all properties', () => {
      const customError = new Error('Custom error')
      ;(customError as any).code = 'CUSTOM_ERROR'
      ;(customError as any).category = 'VALIDATION'
      ;(customError as any).severity = 'HIGH'

      logger.error('Error occurred', undefined, undefined, customError)

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [TestComponent] Error occurred'),
        expect.objectContaining({
          error: {
            name: 'Error',
            message: 'Custom error',
            stack: expect.any(String),
            code: 'CUSTOM_ERROR',
            category: 'VALIDATION',
            severity: 'HIGH'
          }
        })
      )
    })

    it('should handle errors without stack traces when disabled', () => {
      const noStackLogger = new Logger('TestComponent', 'error', { includeStackTrace: false })
      const error = new Error('Test error')

      noStackLogger.error('Error occurred', undefined, undefined, error)

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] [TestComponent] Error occurred'),
        expect.objectContaining({
          error: expect.objectContaining({
            name: 'Error',
            message: 'Test error',
            stack: undefined
          })
        })
      )
    })
  })

  describe('Logger Factory Functions', () => {
    it('should create logger with createLogger function', () => {
      const customLogger = createLogger('CustomComponent', 'warn')
      
      customLogger.debug('Debug message') // Should not log
      customLogger.warn('Warning message')

      expect(mockConsole.debug).not.toHaveBeenCalled()
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [CustomComponent] Warning message'),
        ''
      )
    })

    it('should use environment LOG_LEVEL when not specified', () => {
      const originalLogLevel = process.env.LOG_LEVEL
      process.env.LOG_LEVEL = 'error'

      const envLogger = createLogger('EnvComponent')
      
      envLogger.info('Info message') // Should not log
      envLogger.error('Error message')

      expect(mockConsole.info).not.toHaveBeenCalled()
      expect(mockConsole.error).toHaveBeenCalled()

      process.env.LOG_LEVEL = originalLogLevel
    })

    it('should provide pre-configured component loggers', () => {
      loggers.scraper.info('Scraper message')
      loggers.embedder.warn('Embedder warning')

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] [WebScraper] Scraper message'),
        ''
      )
      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN] [EmbeddingService] Embedder warning'),
        ''
      )
    })
  })

  describe('Configuration Options', () => {
    it('should disable console logging when configured', () => {
      const noConsoleLogger = new Logger('TestComponent', 'info', { enableConsole: false })
      
      noConsoleLogger.info('Test message')

      expect(mockConsole.info).not.toHaveBeenCalled()
    })

    it('should disable performance metrics when configured', () => {
      const noPerfLogger = new Logger('TestComponent', 'info', { includePerformanceMetrics: false })
      
      noPerfLogger.startTimer('test-op')
      noPerfLogger.endTimer('test-op')

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining('Operation test-op completed'),
        expect.objectContaining({
          performance: expect.objectContaining({
            memoryUsage: undefined
          })
        })
      )
    })
  })
})